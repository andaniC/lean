// Shared UI building blocks: icons, rings, sheets, toasts, wheel pickers.
import { icons } from "./icons.js";
import { clamp, haptic } from "./util.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function hydrateIcons(root = document) {
  for (const el of $$("[data-icon]", root)) {
    if (el.dataset.iconDone) continue;
    el.insertAdjacentHTML("afterbegin", `<span class="ic">${icons[el.dataset.icon] ?? ""}</span>`);
    el.dataset.iconDone = "1";
  }
}

/** Progress ring in a 100x100 viewBox. `stroke` is in viewBox units. */
export function ringMarkup(pct, stroke, center = "") {
  const r = 50 - stroke / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - clamp(pct, 0, 1));
  return (
    `<svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="${r}" stroke-width="${stroke}"/>` +
    `<circle class="arc" cx="50" cy="50" r="${r}" stroke-width="${stroke}" stroke-dasharray="${c}" stroke-dashoffset="${off}"/></svg>${center}`
  );
}

/** Creates the ring once (empty), then animates the arc to pct. */
export function setRing(el, pct, stroke, center = "") {
  let arc = el.querySelector(".arc");
  if (!arc) {
    el.innerHTML = ringMarkup(0, stroke, center);
    arc = el.querySelector(".arc");
    arc.getBoundingClientRect();
  }
  const c = parseFloat(arc.getAttribute("stroke-dasharray"));
  requestAnimationFrame(() => arc.setAttribute("stroke-dashoffset", String(c * (1 - clamp(pct, 0, 1)))));
}

/** Counts a number up/down to its new value. */
export function animateNumber(el, to, suffix = "") {
  const from = Number(el.dataset.value ?? to);
  el.dataset.value = String(to);
  if (from === to || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = `${to}${suffix}`;
    return;
  }
  const t0 = performance.now();
  const dur = 650;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = `${Math.round(from + (to - from) * eased)}${suffix}`;
    if (k < 1 && el.dataset.value === String(to)) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

let toastTimer;
export function hideToast() {
  clearTimeout(toastTimer);
  $("#toast").classList.remove("show");
}

export function toast(message, ms = 2600) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

// ------------------------------------------------------------------ sheets

let openSheets = 0;

export function openSheet({ html, tall = false, cls = "", onMount, onClose }) {
  hideToast();
  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";
  const sheet = document.createElement("div");
  sheet.className = `sheet ${tall ? "tall" : ""} ${cls}`;
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.innerHTML = `<div class="sheet-grab"></div><div class="sheet-body">${html}</div>`;
  document.body.append(backdrop, sheet);
  hydrateIcons(sheet);
  openSheets++;
  document.body.classList.add("locked");
  sheet.getBoundingClientRect();
  backdrop.classList.add("open");
  sheet.classList.add("open");

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    sheet.classList.remove("open");
    backdrop.classList.remove("open");
    if (--openSheets === 0) document.body.classList.remove("locked");
    setTimeout(() => {
      sheet.remove();
      backdrop.remove();
    }, 460);
    onClose?.();
  };
  backdrop.addEventListener("click", close);
  $$("[data-close]", sheet).forEach((b) => b.addEventListener("click", close));
  enableDragToClose(sheet, close);
  onMount?.(sheet, close);
  return close;
}

function enableDragToClose(sheet, close) {
  const grab = $(".sheet-grab", sheet);
  const body = $(".sheet-body", sheet);
  let startY = null;
  let dy = 0;
  let t0 = 0;
  const begin = (y) => {
    startY = y;
    dy = 0;
    t0 = performance.now();
  };
  grab.addEventListener("touchstart", (e) => begin(e.touches[0].clientY), { passive: true });
  body.addEventListener(
    "touchstart",
    (e) => {
      if (body.scrollTop <= 0 && !e.target.closest("input, textarea, .wheel")) begin(e.touches[0].clientY);
    },
    { passive: true }
  );
  sheet.addEventListener(
    "touchmove",
    (e) => {
      if (startY == null) return;
      const d = e.touches[0].clientY - startY;
      if (d <= 0 && dy === 0) {
        startY = null;
        return;
      }
      dy = Math.max(0, d);
      sheet.classList.add("dragging");
      sheet.style.transform = `translateY(${dy}px)`;
      e.preventDefault();
    },
    { passive: false }
  );
  const end = () => {
    if (startY == null) return;
    const v = dy / Math.max(1, performance.now() - t0);
    startY = null;
    sheet.classList.remove("dragging");
    sheet.style.transform = "";
    if (dy > 110 || (dy > 30 && v > 0.55)) close();
  };
  sheet.addEventListener("touchend", end);
  sheet.addEventListener("touchcancel", end);
}

export function confirmSheet({ title, text, confirm = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet({
      html: `
        <div class="sheet-head"><h2 class="sheet-title">${title}</h2></div>
        <p class="ob-sub" style="margin-top:0">${text}</p>
        <div class="btn-row">
          <button class="btn light" data-close>Cancel</button>
          <button class="btn ${danger ? "danger" : ""}" data-ok>${confirm}</button>
        </div>`,
      onMount(sheet, close) {
        $("[data-ok]", sheet).addEventListener("click", () => {
          answered = true;
          resolve(true);
          close();
        });
      },
      onClose: () => !answered && resolve(false),
    });
  });
}

// ------------------------------------------------------------------ wheel picker

const ITEM_H = 46;

export function wheel(container, { values, value, format = (v) => v, onChange }) {
  container.innerHTML =
    `<div class="wheel"><div class="wheel-scroll"><div class="wheel-pad"></div>` +
    values.map((v, i) => `<div class="wheel-item" data-i="${i}">${format(v)}</div>`).join("") +
    `<div class="wheel-pad"></div></div></div>`;
  const scroller = $(".wheel-scroll", container);
  const items = $$(".wheel-item", container);
  let idx = 0;
  let best = Infinity;
  values.forEach((v, i) => {
    const d = Math.abs(Number(v) - Number(value));
    if (d < best) {
      best = d;
      idx = i;
    }
  });
  const paint = () => items.forEach((el, j) => el.classList.toggle("active", j === idx));
  paint();
  const place = () => {
    scroller.scrollTop = idx * ITEM_H;
  };
  place();
  requestAnimationFrame(place);

  let raf = 0;
  scroller.addEventListener(
    "scroll",
    () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const i = clamp(Math.round(scroller.scrollTop / ITEM_H), 0, values.length - 1);
        if (i === idx) return;
        idx = i;
        paint();
        haptic(4);
        onChange?.(values[i]);
      });
    },
    { passive: true }
  );
  items.forEach((el, i) =>
    el.addEventListener("click", () => scroller.scrollTo({ top: i * ITEM_H, behavior: "smooth" }))
  );
}

export const range = (from, to, step = 1) => {
  const out = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Math.round(v * 10) / 10);
  return out;
};
