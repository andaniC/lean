export const pad = (n) => String(n).padStart(2, "0");
export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const dateOf = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const todayKey = () => keyOf(new Date());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));

export const round = (n) => Math.round(Number(n) || 0);
export const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const num = (v, fallback = 0) => {
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
};

export const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const haptic = (ms = 10) => {
  try {
    navigator.vibrate?.(ms);
  } catch {}
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function timeLabel(ts, dateKey) {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const key = dateKey ?? keyOf(d);
  const today = todayKey();
  if (key === today) return `Today, ${time}`;
  if (key === keyOf(addDays(new Date(), -1))) return `Yesterday, ${time}`;
  return `${dateOf(key).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}

export const longDate = (d) => d.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });

export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isMobile = () => isIOS() || /android/i.test(navigator.userAgent);
