// Camera stream + image helpers.

const ATTEMPTS = [
  { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
  { facingMode: { ideal: "environment" } },
  true,
];

export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera not supported in this browser.");
  let stream;
  let lastErr;
  for (const constraints of ATTEMPTS) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: constraints });
      break;
    } catch (err) {
      lastErr = err;
      // A refusal won't change with different constraints.
      if (err?.name === "NotAllowedError" || err?.name === "SecurityError") throw err;
    }
  }
  if (!stream) throw lastErr;
  // Keep the preview inside the app (iOS otherwise may open a fullscreen player).
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.muted = true;
  video.srcObject = stream;
  video.onloadedmetadata = () => video.play().catch(() => {});
  await video.play().catch(() => {});
  return stream;
}

export const streamLive = (stream) => !!stream && stream.getVideoTracks().some((t) => t.readyState === "live");

export function stopCamera(stream, video) {
  stream?.getTracks().forEach((t) => t.stop());
  if (video) video.srcObject = null;
}

export function torchSupported(stream) {
  const track = stream?.getVideoTracks()[0];
  return !!track?.getCapabilities?.().torch;
}

export async function setTorch(stream, on) {
  const track = stream?.getVideoTracks()[0];
  if (!track?.getCapabilities?.().torch) return false;
  await track.applyConstraints({ advanced: [{ torch: on }] });
  return true;
}

/** Draws a source (video / image / bitmap / canvas) scaled so its longest side is <= maxSide. */
export function drawScaled(source, maxSide, crop) {
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  const c = crop ?? { x: 0, y: 0, w: sw, h: sh };
  const scale = Math.min(1, maxSide / Math.max(c.w, c.h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(c.w * scale));
  canvas.height = Math.max(1, Math.round(c.h * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, c.x, c.y, c.w, c.h, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Square center crop, used for list thumbnails. */
export function squareThumb(source, size) {
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  const side = Math.min(sw, sh);
  return drawScaled(source, size, { x: (sw - side) / 2, y: (sh - side) / 2, w: side, h: side });
}

export const toDataUrl = (canvas, quality = 0.82) => canvas.toDataURL("image/jpeg", quality);
export const toBase64 = (canvas, quality = 0.85) => toDataUrl(canvas, quality).split(",")[1];

export async function fileToImage(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {}
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function dataUrlToImage(dataUrl) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return img;
}
