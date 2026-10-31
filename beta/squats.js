// AI squat counter, opened from a squat exercise: on-device pose tracking (MediaPipe) counts reps and checks depth.
// Nothing leaves the phone; the model and runtime are fetched once from public CDNs.
import { $, toast } from "./ui.js";
import { icons } from "./icons.js";
import { startCamera, stopCamera } from "./camera.js";
import { haptic, clamp } from "./util.js";

const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1";
const MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

// Knee angle (hip-knee-ankle) thresholds in degrees.
const STANDING = 158;
const DEPTH = 105; // about thighs parallel
const GREAT = 92;

let landmarkerPromise;
function getLandmarker() {
  landmarkerPromise ??= (async () => {
    const { FilesetResolver, PoseLandmarker } = await import(`${MP}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
    const make = (delegate) =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    try {
      return await make("GPU");
    } catch {
      return await make("CPU");
    }
  })();
  landmarkerPromise.catch(() => (landmarkerPromise = null));
  return landmarkerPromise;
}

/** Starts downloading the tracker in the background (skipped when the phone asks to save data). */
export function preloadTracker() {
  if (navigator.connection?.saveData) return Promise.resolve();
  return getLandmarker().catch(() => {});
}

/** Rep state machine fed with knee angles. Returns "rep", "shallow" or null per update. */
export function createSquatCounter() {
  let phase = "up";
  let bottom = 180;
  return {
    reps: 0,
    shallow: 0,
    get bottom() {
      return bottom;
    },
    update(angle) {
      if (phase === "up") {
        if (angle < STANDING - 18) {
          phase = "down";
          bottom = angle;
        }
        return null;
      }
      bottom = Math.min(bottom, angle);
      if (angle < STANDING) return null;
      phase = "up";
      if (bottom <= DEPTH) {
        this.reps++;
        return "rep";
      }
      this.shallow++;
      return "shallow";
    },
  };
}

function angleAt(a, b, c, w, h) {
  const v1 = [(a.x - b.x) * w, (a.y - b.y) * h];
  const v2 = [(c.x - b.x) * w, (c.y - b.y) * h];
  const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1);
  return (Math.acos(clamp(cos, -1, 1)) * 180) / Math.PI;
}

const SIDES = {
  left: { shoulder: 11, hip: 23, knee: 25, ankle: 27 },
  right: { shoulder: 12, hip: 24, knee: 26, ankle: 28 },
};

/** Picks the better-visible leg and returns its knee angle, or null when the legs aren't in view. */
function readKnee(lm, w, h) {
  const score = (s) => (lm[s.hip].visibility + lm[s.knee].visibility + lm[s.ankle].visibility) / 3;
  const side = score(SIDES.left) >= score(SIDES.right) ? SIDES.left : SIDES.right;
  const inFrame = (p) => p.x > -0.02 && p.x < 1.02 && p.y > -0.02 && p.y < 1.02;
  if (score(side) < 0.55 || ![side.hip, side.knee, side.ankle].every((i) => inFrame(lm[i]))) return null;
  return angleAt(lm[side.hip], lm[side.knee], lm[side.ankle], w, h);
}

const BONES = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [11, 13], [13, 15], [12, 14], [14, 16],
];

function draw(ctx, lm, w, h, good) {
  ctx.clearRect(0, 0, w, h);
  if (!lm) return;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(4, w / 120);
  ctx.strokeStyle = good ? "#3bb56b" : "rgba(255,255,255,0.9)";
  for (const [a, b] of BONES) {
    if (lm[a].visibility < 0.4 || lm[b].visibility < 0.4) continue;
    ctx.beginPath();
    ctx.moveTo(lm[a].x * w, lm[a].y * h);
    ctx.lineTo(lm[b].x * w, lm[b].y * h);
    ctx.stroke();
  }
  ctx.fillStyle = good ? "#3bb56b" : "#ff7a1a";
  for (const i of [11, 12, 23, 24, 25, 26, 27, 28]) {
    if (lm[i].visibility < 0.4) continue;
    ctx.beginPath();
    ctx.arc(lm[i].x * w, lm[i].y * h, Math.max(6, w / 90), 0, Math.PI * 2);
    ctx.fill();
  }
}

function say(text) {
  try {
    if (!run.voice || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.1;
    speechSynthesis.speak(u);
  } catch {}
}

const run = { stream: null, raf: 0, counter: null, facing: "user", voice: true, startedAt: 0, smooth: null, lastVideoTime: -1, wakeLock: null, onFinish: null, feedbackUntil: 0 };

function setFeedback(text, tone = "", holdMs = 0) {
  if (Date.now() < run.feedbackUntil && !holdMs) return;
  const el = $("#counter-feedback");
  el.textContent = text;
  el.dataset.tone = tone;
  run.feedbackUntil = holdMs ? Date.now() + holdMs : 0;
}

function setReps(n) {
  const el = $("#counter-reps");
  el.textContent = n;
  el.classList.remove("bump");
  el.getBoundingClientRect();
  el.classList.add("bump");
}

async function startStream() {
  const video = $("#counter-video");
  stopCamera(run.stream, video);
  run.stream = await startCamera(video, run.facing);
  $("#counter").classList.toggle("mirror", run.facing === "user");
}

/** Opens the counter. `onFinish({ reps, seconds })` is called when she taps Finish. */
export async function openSquatCounter(onFinish) {
  run.onFinish = onFinish;
  run.counter = createSquatCounter();
  run.smooth = null;
  run.startedAt = 0;
  run.lastVideoTime = -1;
  $("#counter-reps").textContent = "0";
  $("#depth-fill").style.height = "0%";
  const el = $("#counter");
  el.hidden = false;
  el.getBoundingClientRect();
  el.classList.add("open");
  setFeedback("Getting the movement tracker ready (the first time takes a moment)…");
  say("Let's squat");
  try {
    run.wakeLock = await navigator.wakeLock?.request("screen");
  } catch {}
  try {
    await startStream();
  } catch (err) {
    setFeedback(err?.name === "NotAllowedError" ? "Camera access is off for Lean. Allow it in Settings." : "The camera couldn't start.", "bad", 60000);
    return;
  }
  let landmarker;
  try {
    landmarker = await getLandmarker();
  } catch {
    setFeedback("Couldn't load the tracker. Check your internet and try again.", "bad", 60000);
    return;
  }
  if (!el.classList.contains("open")) return;
  setFeedback("Prop your phone up and step back until your whole body is in view");
  loop(landmarker);
}

function loop(landmarker) {
  const video = $("#counter-video");
  const canvas = $("#counter-canvas");
  const ctx = canvas.getContext("2d");
  const tick = () => {
    if (!$("#counter").classList.contains("open")) return;
    run.raf = requestAnimationFrame(tick);
    if (!video.videoWidth || video.currentTime === run.lastVideoTime) return;
    run.lastVideoTime = video.currentTime;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    let result;
    try {
      result = landmarker.detectForVideo(video, performance.now());
    } catch {
      return;
    }
    const lm = result.landmarks?.[0];
    const angle = lm ? readKnee(lm, w, h) : null;
    if (angle == null) {
      draw(ctx, lm, w, h, false);
      setFeedback("Step back so your hips, knees and feet are all in view");
      return;
    }
    run.smooth = run.smooth == null ? angle : run.smooth * 0.55 + angle * 0.45;
    const a = run.smooth;
    run.startedAt ||= Date.now();
    // Depth meter: 0% standing, 100% at parallel or deeper.
    $("#depth-fill").style.height = `${Math.round(clamp((STANDING - a) / (STANDING - DEPTH), 0, 1) * 100)}%`;
    const deep = a <= DEPTH;
    draw(ctx, lm, w, h, deep);
    const event = run.counter.update(a);
    if (event === "rep") {
      setReps(run.counter.reps);
      haptic(25);
      say(String(run.counter.reps));
      setFeedback(run.counter.bottom <= GREAT ? "Great depth!" : "Good rep!", "good", 900);
    } else if (event === "shallow") {
      haptic(8);
      setFeedback("Not counted: sit a little lower, thighs to parallel", "bad", 1600);
    } else if (deep) {
      setFeedback("Good depth, now drive up through your heels", "good");
    } else if (a < STANDING - 18) {
      setFeedback("Lower… hips back, chest up");
    } else {
      setFeedback(run.counter.reps ? "Ready for the next one" : "Ready! Squat when you are", "");
    }
  };
  tick();
}

export function closeSquatCounter() {
  cancelAnimationFrame(run.raf);
  stopCamera(run.stream, $("#counter-video"));
  run.stream = null;
  try {
    run.wakeLock?.release();
  } catch {}
  run.wakeLock = null;
  try {
    speechSynthesis.cancel();
  } catch {}
  const el = $("#counter");
  el.classList.remove("open");
  setTimeout(() => {
    if (!el.classList.contains("open")) el.hidden = true;
  }, 300);
}

export function initSquatCounter() {
  $("#counter-close").addEventListener("click", closeSquatCounter);
  $("#counter-flip").addEventListener("click", async () => {
    run.facing = run.facing === "user" ? "environment" : "user";
    try {
      await startStream();
    } catch {
      toast("Couldn't switch camera");
    }
  });
  const voiceBtn = $("#counter-voice");
  const paintVoice = () => (voiceBtn.innerHTML = `<span class="ic">${run.voice ? icons.speaker : icons.speakerOff}</span>`);
  paintVoice();
  voiceBtn.addEventListener("click", () => {
    run.voice = !run.voice;
    paintVoice();
  });
  $("#counter-finish").addEventListener("click", () => {
    const reps = run.counter?.reps ?? 0;
    const seconds = run.startedAt ? Math.round((Date.now() - run.startedAt) / 1000) : 0;
    closeSquatCounter();
    if (reps > 0) run.onFinish?.({ reps, seconds });
    else toast("No squats counted yet");
  });
}
