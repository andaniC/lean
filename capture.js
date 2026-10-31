// Camera screen (Scan Food / Barcode / Food Label) and the AI analysis pipeline.
import { $, $$, toast } from "./ui.js";
import {
  startCamera,
  stopCamera,
  drawScaled,
  squareThumb,
  toDataUrl,
  toBase64,
  fileToImage,
  setTorch,
  dataUrlToImage,
} from "./camera.js";
import { getDecoder } from "./barcode.js";
import { analyzeFood, lookupBarcode } from "./ai.js";
import { state, saveEntry, emit } from "./store.js";
import { uid, haptic, todayKey, dateOf } from "./util.js";
import { openAmountSheet } from "./flows.js";

const cam = { stream: null, mode: "scan", torch: false, scanning: false, timer: 0, busy: false };

const HINTS = {
  scan: "",
  barcode: "Point the camera at a barcode",
  label: "Fit the nutrition label in the frame",
};

export function initCamera() {
  $$(".mode", $("#camera")).forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  $("#cam-close").addEventListener("click", closeCamera);
  $("#cam-shutter").addEventListener("click", onShutter);
  $("#cam-torch").addEventListener("click", toggleTorch);
  $("#cam-gallery").addEventListener("click", () => $("#file-gallery").click());
  $("#cam-fallback-btn").addEventListener("click", () => $("#file-camera").click());
  for (const id of ["#file-gallery", "#file-camera"]) {
    $(id).addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      try {
        const img = await fileToImage(file);
        const full = drawScaled(img, 1280);
        const thumb = squareThumb(img, 640);
        const mode = cam.mode;
        closeCamera();
        await handleCapture(full, thumb, mode);
      } catch {
        toast("That photo couldn't be opened.");
      }
    });
  }
}

export async function openCamera(mode = "scan") {
  const el = $("#camera");
  setMode(mode, false);
  $("#cam-fallback").hidden = true;
  el.hidden = false;
  el.getBoundingClientRect();
  el.classList.add("open");
  try {
    cam.stream = await startCamera($("#cam-video"));
    if (el.hidden) {
      // Closed while the permission prompt was up.
      stopCamera(cam.stream, $("#cam-video"));
      cam.stream = null;
      return;
    }
    if (cam.mode === "barcode") startBarcodeLoop();
  } catch (err) {
    showFallback(err);
  }
}

export function closeCamera() {
  stopBarcodeLoop();
  stopCamera(cam.stream, $("#cam-video"));
  cam.stream = null;
  cam.torch = false;
  $("#cam-torch").classList.remove("on");
  const el = $("#camera");
  el.classList.remove("open");
  setTimeout(() => {
    if (!el.classList.contains("open")) el.hidden = true;
  }, 300);
}

function showFallback(err) {
  const text =
    err?.name === "NotAllowedError"
      ? "Camera access is turned off for Lean. Allow it in your phone's settings, or use a photo instead."
      : err?.name === "NotFoundError"
        ? "No camera was found on this device. You can still pick a photo."
        : "The live camera isn't available here. You can still take or pick a photo.";
  $("#cam-fallback-text").textContent = text;
  $("#cam-fallback").hidden = false;
}

function setMode(mode, restartLoop = true) {
  cam.mode = mode;
  const el = $("#camera");
  el.dataset.mode = mode;
  $$(".mode", el).forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  const hint = $("#cam-hint");
  hint.textContent = HINTS[mode];
  hint.hidden = !HINTS[mode];
  if (!restartLoop) return;
  if (mode === "barcode" && cam.stream) startBarcodeLoop();
  else stopBarcodeLoop();
}

function flash() {
  const f = $("#cam-flash");
  f.classList.remove("go");
  f.getBoundingClientRect();
  f.classList.add("go");
}

async function onShutter() {
  if (cam.busy) return;
  const video = $("#cam-video");
  if (!cam.stream || !video.videoWidth) {
    $("#file-camera").click();
    return;
  }
  cam.busy = true;
  flash();
  haptic(15);
  const full = drawScaled(video, 1280);
  const thumb = squareThumb(video, 640);
  const mode = cam.mode;
  setTimeout(closeCamera, 120);
  try {
    await handleCapture(full, thumb, mode);
  } finally {
    cam.busy = false;
  }
}

async function toggleTorch() {
  if (!cam.stream) return;
  const ok = await setTorch(cam.stream, !cam.torch).catch(() => false);
  if (!ok) {
    toast("Flash isn't available on this camera");
    return;
  }
  cam.torch = !cam.torch;
  $("#cam-torch").classList.toggle("on", cam.torch);
}

// ------------------------------------------------------------------ barcode

function startBarcodeLoop() {
  stopBarcodeLoop();
  cam.scanning = true;
  $("#camera").classList.add("live");
  const tick = async () => {
    if (!cam.scanning) return;
    const video = $("#cam-video");
    if (video.videoWidth) {
      const decode = await getDecoder();
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const band = drawScaled(video, 960, { x: vw * 0.04, y: vh * 0.28, w: vw * 0.92, h: vh * 0.44 });
      const code = await decode(band);
      if (code && cam.scanning && /^\d{6,14}$/.test(code)) {
        cam.scanning = false;
        haptic(30);
        flash();
        const full = drawScaled(video, 1280);
        const thumb = squareThumb(video, 640);
        setTimeout(closeCamera, 120);
        handleBarcode(code, full, thumb);
        return;
      }
    }
    if (cam.scanning) cam.timer = setTimeout(tick, 300);
  };
  tick();
}

function stopBarcodeLoop() {
  cam.scanning = false;
  clearTimeout(cam.timer);
  $("#camera").classList.remove("live");
}

async function handleBarcode(code, full, thumb) {
  if (!state.settings.accessCode) {
    toast("Enter your access code in Settings first.");
    return;
  }
  toast("Looking up product…", 8000);
  try {
    const food = await lookupBarcode(state.settings.accessCode, code);
    if (food) {
      openAmountSheet(food, { photo: toDataUrl(thumb, 0.8), source: "barcode", barcode: code });
      return;
    }
    toast("Not in the food database yet. Estimating with AI…", 3000);
  } catch (err) {
    toast(err.message);
    return;
  }
  await startPhotoAnalysis(full, thumb, "barcode", code);
}

// ------------------------------------------------------------------ analysis

async function handleCapture(full, thumb, mode) {
  if (mode === "barcode") {
    const decode = await getDecoder();
    const code = await decode(drawScaled(full, 1000));
    if (code && /^\d{6,14}$/.test(code)) return handleBarcode(code, full, thumb);
  }
  return startPhotoAnalysis(full, thumb, mode);
}

export function newEntry(fields) {
  const now = new Date();
  let time = now.getTime();
  if (state.selected !== todayKey()) {
    const d = dateOf(state.selected);
    d.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
    time = d.getTime();
  }
  return {
    id: uid(),
    date: state.selected,
    time,
    name: "",
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    servings: 1,
    items: [],
    healthScore: null,
    photo: null,
    source: "scan",
    status: "pending",
    error: "",
    ...fields,
  };
}

function goHome() {
  if (state.tab !== "home") {
    state.tab = "home";
    emit();
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function startPhotoAnalysis(full, thumb, mode, barcode = "") {
  const entry = newEntry({
    source: mode,
    barcode,
    photo: toDataUrl(thumb, 0.8),
    retryImage: toBase64(full, 0.85),
  });
  goHome();
  await saveEntry(entry);
  runAnalysis(entry);
}

export async function startTextAnalysis(text) {
  const entry = newEntry({ source: "text", query: text });
  goHome();
  await saveEntry(entry);
  runAnalysis(entry);
}

function payloadFor(entry) {
  if (entry.source === "text") return { mode: "text", text: entry.query };
  return { mode: entry.source, image: entry.retryImage, barcodeDigits: entry.barcode || undefined };
}

/** Sends an entry to the AI and stores the result. `override` replaces the default payload (used by Fix). */
export async function runAnalysis(entry, override) {
  const payload = override ?? payloadFor(entry);
  if (!payload.image && payload.mode !== "text" && payload.mode !== "fix" && entry.photo) {
    payload.image = entry.photo.split(",")[1];
  }
  Object.assign(entry, { status: "pending", error: "", startedAt: Date.now() });
  await saveEntry({ ...entry });
  try {
    const r = await analyzeFood({ accessCode: state.settings.accessCode, ...payload });
    if (!r.is_food) throw new Error(r.message || "We couldn't spot any food here. Try another photo.");
    Object.assign(entry, {
      name: r.name || "Food",
      calories: Math.max(0, Math.round(r.calories)),
      protein: Math.max(0, Math.round(r.protein)),
      carbs: Math.max(0, Math.round(r.carbs)),
      fat: Math.max(0, Math.round(r.fat)),
      items: Array.isArray(r.items) ? r.items : [],
      healthScore: r.health_score || null,
      servings: 1,
      status: "done",
      error: "",
    });
    delete entry.retryImage;
    delete entry.startedAt;
    haptic(20);
  } catch (err) {
    entry.status = "error";
    entry.error = err.message || "Something went wrong.";
  }
  // The user may have deleted it while it was analyzing.
  if (state.entries.some((e) => e.id === entry.id)) await saveEntry({ ...entry });
  return entry;
}

export async function photoBase64(entry) {
  if (entry.retryImage) return entry.retryImage;
  if (!entry.photo) return null;
  const img = await dataUrlToImage(entry.photo);
  return toBase64(drawScaled(img, 1024));
}
