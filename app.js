import {
  state,
  onChange,
  emit,
  loadAll,
  totalsFor,
  entriesFor,
  streak,
  updateSettings,
  deleteEntry,
  saveEntry,
  waterFor,
  setWater,
  burnedFor,
} from "./store.js";
import { $, $$, hydrateIcons, setRing, animateNumber, toast } from "./ui.js";
import { icons } from "./icons.js";
import { initCamera, runAnalysis } from "./capture.js";
import { openPlusMenu, openEntry, openSettings, openWeightSheet } from "./flows.js";
import { startOnboarding, codeFromUrl } from "./onboarding.js";
import { renderProgress } from "./progress.js";
import { renderWorkouts, wireWorkouts } from "./workouts.js";
import { initSquatCounter } from "./squats.js";
import { setTheme } from "./theme.js";
import { dateOf, todayKey, addDays, mondayOf, keyOf, round, esc, clamp, haptic, mealFor, MEAL_LABEL, clock } from "./util.js";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const GLASS_ML = 250;
const flame = `<span class="ic">${icons.flame}</span>`;
let lastToday = todayKey();

// ------------------------------------------------------------------ home

function renderStreak() {
  const n = streak();
  $("#streak-count").textContent = n;
  $("#streak").classList.toggle("zero", n === 0);
}

function renderWeek() {
  const today = todayKey();
  const goal = state.settings.goals.calories;
  const monday = mondayOf(dateOf(state.selected));
  $("#week").innerHTML = DAY_NAMES.map((name, i) => {
    const d = addDays(monday, i);
    const k = keyOf(d);
    const t = totalsFor(k);
    const future = k > today;
    const ring = t.count ? (t.calories > goal ? "over" : "ok") : "";
    return `<button class="day ${k === state.selected ? "selected" : ""} ${future ? "future" : ""}" data-date="${k}" ${future ? "disabled" : ""} aria-label="${d.toDateString()}">
      <span class="day-num">${d.getDate()}</span><span class="day-name">${name}</span><span class="day-ring ${ring}"></span></button>`;
  }).join("");
}

function renderSummary() {
  const g = state.settings.goals;
  const t = totalsFor(state.selected);
  const eaten = state.calView === "eaten";
  // Optionally "eat back" exercise calories.
  const budget = g.calories + (state.settings.addBurned ? burnedFor(state.selected) : 0);
  const left = budget - t.calories;
  animateNumber($("#cal-num"), eaten ? round(t.calories) : Math.abs(round(left)));
  $("#cal-label").textContent = eaten ? "Calories eaten" : left >= 0 ? "Calories left" : "Calories over";
  setRing($("#cal-ring"), budget ? t.calories / budget : 0, 10.4, flame);

  for (const key of ["protein", "carbs", "fat"]) {
    const name = key[0].toUpperCase() + key.slice(1);
    const rem = g[key] - t[key];
    animateNumber($(`#${key}-num`), eaten ? round(t[key]) : Math.abs(round(rem)), "g");
    $(`#${key}-label`).textContent = eaten ? `${name} eaten` : rem >= 0 ? `${name} left` : `${name} over`;
    setRing($(`#${key}-ring`), g[key] ? t[key] / g[key] : 0, 12, `<b class="ring-letter">${name[0]}</b>`);
  }
  $("#code-banner").hidden = !!state.settings.accessCode;
}

function renderWater() {
  const goal = state.settings.goals.water || 2000;
  const ml = waterFor(state.selected);
  animateNumber($("#water-num"), ml);
  $("#water-label").textContent = `Water · goal ${goal.toLocaleString()} ml`;
  setRing($("#water-ring"), ml / goal, 10.4, `<span class="ic">${icons.drop}</span>`);
  const count = clamp(Math.round(goal / GLASS_ML), 4, 12);
  const full = Math.floor(ml / GLASS_ML);
  const box = $("#glasses");
  if (box.childElementCount !== count) {
    box.innerHTML = Array.from(
      { length: count },
      (_, i) => `<button class="glass" data-glass="${i}" aria-label="${(i + 1) * GLASS_ML} ml"></button>`
    ).join("");
  }
  $$(".glass", box).forEach((b, i) => {
    const isFull = i < full;
    if (b.dataset.full === String(isFull)) return;
    b.dataset.full = String(isFull);
    b.classList.toggle("full", isFull);
    b.innerHTML = `<span class="ic">${isFull ? icons.glassFull : icons.glass}</span>`;
  });
  $("#water-minus").disabled = ml <= 0;
}

function thumb(entry, overlay = "") {
  const inner = entry.photo
    ? `<img src="${entry.photo}" alt="">`
    : `<span class="ic">${entry.source === "text" ? icons.sparkle : icons.fork}</span>`;
  return `<div class="food-thumb">${inner}${overlay}</div>`;
}

function mealLine(e) {
  const meal = e.meal || mealFor(e.time);
  return `<div class="food-top"><span class="meal-dot" style="--m:var(--${meal})"></span>${MEAL_LABEL[meal]} · ${clock(e.time)}</div>`;
}

function foodInner(e) {
  if (e.status === "pending") {
    const C = 2 * Math.PI * 21;
    return `<div class="food" data-pending>
      ${thumb(e, `<div class="veil"><div class="pct-ring"><svg viewBox="0 0 50 50"><circle class="track" cx="25" cy="25" r="21"/><circle class="arc" cx="25" cy="25" r="21" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg><span class="pct">0%</span></div></div>`)}
      <div class="food-body">
        <div class="pending-title">${e.source === "text" ? "Estimating…" : "Analyzing food…"}</div>
        <div class="shimmer w1"></div><div class="shimmer w2"></div>
        <div class="pending-note">${e.source === "text" ? esc(e.query) : "We'll have it ready in a few seconds"}</div>
      </div></div>`;
  }
  if (e.status === "error") {
    return `<div class="food">
      ${thumb(e)}
      <div class="food-body">
        <div class="error-title">Couldn't analyze</div>
        <div class="error-text">${esc(e.error)}</div>
        <div class="error-actions">
          <button class="mini-btn dark" data-retry><span class="ic">${icons.retry}</span>Retry</button>
          <button class="mini-btn" data-remove>Delete</button>
        </div>
      </div></div>`;
  }
  const s = e.servings || 1;
  return `<button class="food press" data-open>
    ${thumb(e)}
    <div class="food-body">
      ${mealLine(e)}
      <div class="food-kcal">${flame}${round(e.calories * s)} calories</div>
      <div class="food-name">${esc(e.name)}</div>
      <div class="mchips">
        <span class="mchip p"><b>P</b>${round(e.protein * s)}g</span>
        <span class="mchip c"><b>C</b>${round(e.carbs * s)}g</span>
        <span class="mchip f"><b>F</b>${round(e.fat * s)}g</span>
      </div>
    </div></button>`;
}

function entryMarkup(e) {
  const del = `<button class="swipe-del" data-swipe-del><span class="ic">${icons.trash}</span>Delete</button>`;
  return `<div class="swipe" data-id="${e.id}"><div class="swipe-bg">${del}${del}</div>${foodInner(e)}</div>`;
}

function renderLog() {
  const list = $("#log-list");
  const entries = entriesFor(state.selected);
  if (!entries.length) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-art"><div class="sq"></div><div class="ln"><span></span><span></span></div></div>
        <h3>You haven't uploaded any food</h3>
        <p>Start tracking ${state.selected === todayKey() ? "today's" : "this day's"} meals by taking a quick picture</p>
      </div>`;
    return;
  }
  // Keyed update so existing cards don't re-animate (or lose a swipe) on every change.
  const old = new Map($$(".swipe", list).map((el) => [el.dataset.id, el]));
  const frag = document.createDocumentFragment();
  for (const e of entries) {
    const sig = [e.status, e.name, e.calories, e.protein, e.carbs, e.fat, e.servings, e.meal, e.time, e.error, e.photo?.length ?? 0].join("|");
    let el = old.get(e.id);
    if (!el || el.dataset.sig !== sig) {
      const tpl = document.createElement("template");
      tpl.innerHTML = entryMarkup(e).trim();
      el = tpl.content.firstElementChild;
      el.dataset.sig = sig;
      if (old.has(e.id)) $(".food", el).style.animation = "none";
    }
    frag.append(el);
  }
  list.replaceChildren(frag);
}

function tickPending() {
  for (const el of $$("[data-pending]")) {
    const id = el.closest(".swipe")?.dataset.id;
    const e = state.entries.find((x) => x.id === id);
    if (!e?.startedAt) continue;
    const pct = Math.min(96, Math.round(100 * (1 - Math.exp(-(Date.now() - e.startedAt) / 7000))));
    const arc = $(".arc", el);
    const C = parseFloat(arc.getAttribute("stroke-dasharray"));
    arc.setAttribute("stroke-dashoffset", String(C * (1 - pct / 100)));
    $(".pct", el).textContent = `${pct}%`;
  }
}

// ------------------------------------------------------------------ swipe to delete

const OPEN_X = 92;
let drag = null;
let suppressClick = false;

function setOffset(sw, x) {
  sw.dataset.x = String(x);
  sw.classList.toggle("open", x !== 0);
  $(".food", sw).style.transform = x ? `translateX(${x}px)` : "";
}

function closeSwipes(except) {
  $$("#log-list .swipe.open").forEach((sw) => sw !== except && setOffset(sw, 0));
}

async function deleteWithUndo(entry) {
  await deleteEntry(entry.id);
  haptic(15);
  toast(`${entry.name || "Food"} deleted`, 4500, { label: "Undo", onClick: () => saveEntry(entry) });
}

function swipeAway(sw, dir) {
  const entry = state.entries.find((x) => x.id === sw.dataset.id);
  if (!entry) return;
  sw.classList.add("open");
  $(".food", sw).style.transform = `translateX(${dir * sw.offsetWidth * 1.1}px)`;
  sw.style.height = `${sw.offsetHeight}px`;
  sw.getBoundingClientRect();
  sw.classList.add("removing");
  setTimeout(() => {
    sw.style.height = "0px";
    sw.style.marginTop = "0px";
    sw.style.opacity = "0";
  }, 170);
  setTimeout(() => deleteWithUndo(entry), 450);
}

function wireSwipes(list) {
  list.addEventListener("pointerdown", (e) => {
    const sw = e.target.closest(".swipe");
    if (!sw || e.button > 0 || e.target.closest(".swipe-del, .mini-btn")) return;
    drag = { sw, id: e.pointerId, x0: e.clientX, y0: e.clientY, base: Number(sw.dataset.x || 0), dx: 0, axis: null };
  });
  list.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      drag.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (drag.axis === "y") {
        drag = null;
        return;
      }
      drag.sw.setPointerCapture?.(e.pointerId);
      drag.sw.classList.add("dragging");
      closeSwipes(drag.sw);
    }
    drag.dx = dx;
    const w = drag.sw.offsetWidth;
    const x = clamp(drag.base + dx, -w, w);
    $(".food", drag.sw).style.transform = `translateX(${x}px)`;
  });
  const end = (e, cancelled = false) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { sw, base, dx, axis } = drag;
    drag = null;
    if (axis !== "x") return;
    sw.classList.remove("dragging");
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    const x = base + dx;
    if (cancelled) return setOffset(sw, base);
    if (Math.abs(x) > sw.offsetWidth * 0.5) return swipeAway(sw, Math.sign(x));
    haptic(6);
    setOffset(sw, Math.abs(x) > 56 ? Math.sign(x) * OPEN_X : 0);
  };
  list.addEventListener("pointerup", (e) => end(e));
  list.addEventListener("pointercancel", (e) => end(e, true));
}

// ------------------------------------------------------------------ tabs

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Slides the glass lens under `tab`. It stretches as it travels, then settles, like a drop of liquid. */
function placeLens(tab, { stretch = true } = {}) {
  const lens = $("#tab-indicator");
  if (!tab) return;
  const x = `${tab.offsetLeft}px 0px`;
  const moved = lens.style.translate && lens.style.translate !== x;
  lens.style.width = `${tab.offsetWidth}px`;
  lens.style.translate = x;
  if (stretch && moved && !reduceMotion()) {
    lens.animate([{ scale: "1 1" }, { scale: "1.2 0.9" }, { scale: "1 1" }], { duration: 500, easing: "ease-out" });
  }
}

function moveIndicator() {
  placeLens($(`.tab[data-tab="${state.tab}"]`));
}

function selectTab(tab) {
  if (state.tab === tab) return moveIndicator();
  state.tab = tab;
  window.scrollTo({ top: 0 });
  emit();
}

/** Press a tab to lift the lens onto it; drag along the bar to slide the lens and let go to switch. */
function wireTabBar() {
  const bar = $("#tab-glass");
  const lens = $("#tab-indicator");
  const tabs = $$(".tab", bar);
  const real = tabs.filter((t) => t.dataset.tab);
  let touch = null;
  let suppressClick = false;

  const centre = (t) => {
    const r = t.getBoundingClientRect();
    return r.left + r.width / 2;
  };
  const nearest = (x) => real.reduce((a, b) => (Math.abs(centre(b) - x) < Math.abs(centre(a) - x) ? b : a));
  const markUnder = (t) => {
    if (touch.under !== t) haptic(6);
    touch.under = t;
    tabs.forEach((x) => x.classList.toggle("under", x === t));
  };
  const end = () => {
    bar.classList.remove("touching", "dragging");
    tabs.forEach((x) => x.classList.remove("under"));
    touch = null;
  };

  bar.addEventListener("pointerdown", (e) => {
    const t = e.target.closest(".tab");
    if (!t || touch) return;
    touch = { id: e.pointerId, x0: e.clientX, dragging: false, under: null };
    bar.classList.add("touching");
    markUnder(t);
    if (t.dataset.tab) placeLens(t, { stretch: false });
  });

  bar.addEventListener("pointermove", (e) => {
    if (!touch || e.pointerId !== touch.id) return;
    if (!touch.dragging && Math.abs(e.clientX - touch.x0) < 8) return;
    if (!touch.dragging) {
      touch.dragging = true;
      bar.classList.add("dragging");
      bar.setPointerCapture(e.pointerId);
    }
    // The lens follows the finger between the first and last real tab.
    const box = bar.getBoundingClientRect();
    const w = lens.offsetWidth;
    const min = real[0].offsetLeft;
    const max = real[real.length - 1].offsetLeft;
    const x = Math.max(min, Math.min(max, e.clientX - box.left - w / 2));
    lens.style.translate = `${x}px 0px`;
    markUnder(nearest(box.left + x + w / 2));
  });

  // On window, so a finger that slides off the bar before lifting still lets go of the lens.
  window.addEventListener("pointerup", (e) => {
    if (!touch || e.pointerId !== touch.id) return;
    const { dragging, under } = touch;
    end();
    if (!dragging) {
      // A plain tap: the click handler switches tabs. If the finger left the tab, no click comes, so settle back.
      setTimeout(moveIndicator, 0);
      return;
    }
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    selectTab(under.dataset.tab);
  });

  window.addEventListener("pointercancel", (e) => {
    if (!touch || e.pointerId !== touch.id) return;
    end();
    moveIndicator();
  });

  tabs.forEach((t) =>
    t.addEventListener("click", () => {
      if (suppressClick) return;
      if (t.hasAttribute("data-profile")) {
        moveIndicator();
        return openSettings(settingsOpts);
      }
      selectTab(t.dataset.tab);
    })
  );
}

function renderTabs() {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === state.tab));
  for (const [tab, id] of [["home", "#screen-home"], ["workouts", "#screen-workouts"], ["progress", "#screen-progress"]]) {
    const el = $(id);
    if (el.hidden !== (state.tab !== tab)) el.hidden = state.tab !== tab;
  }
  moveIndicator();
}

function render() {
  if ($("#app").hidden) return;
  renderTabs();
  if (state.tab === "home") {
    renderStreak();
    renderWeek();
    renderSummary();
    renderWater();
    renderLog();
  } else if (state.tab === "workouts") {
    renderWorkouts($("#workouts-body"));
  } else {
    renderProgress($("#progress-body"), { onLogWeight: openWeightSheet });
  }
}

function showApp() {
  $("#app").hidden = false;
  $("#tabbar").hidden = false;
  render();
  requestAnimationFrame(moveIndicator);
}

function showWaterPage() {
  state.tab = "home";
  emit();
  requestAnimationFrame(() => {
    const pager = $("#pager");
    // Two smooth scrolls at once can cancel each other in Chrome: jump the page, animate the pager.
    window.scrollTo({ top: 0 });
    pager.scrollTo({ left: pager.clientWidth, behavior: "smooth" });
    const card = $(".water-card");
    card.classList.remove("flash");
    card.getBoundingClientRect();
    card.classList.add("flash");
  });
}

const settingsOpts = { onRedoOnboarding: () => startOnboarding(render, { fromSettings: true }) };

function wire() {
  wireTabBar();
  $("#plus").addEventListener("click", openPlusMenu);
  $("#open-settings").addEventListener("click", () => openSettings(settingsOpts));
  $$("[data-open-settings]").forEach((b) => b.addEventListener("click", () => openSettings(settingsOpts)));
  $("#code-banner").addEventListener("click", () => openSettings(settingsOpts));
  $("#streak").addEventListener("click", () => {
    const n = streak();
    toast(n ? `${n}-day streak! Keep logging every day.` : "Log a meal today to start your streak.");
  });
  $("#cal-card").addEventListener("click", () => {
    state.calView = state.calView === "left" ? "eaten" : "left";
    emit();
  });

  // Calories / water pager
  const pager = $("#pager");
  const dots = $$("#dots button");
  pager.addEventListener(
    "scroll",
    () => {
      const i = Math.round(pager.scrollLeft / pager.clientWidth);
      dots.forEach((d, j) => d.classList.toggle("on", i === j));
    },
    { passive: true }
  );
  dots.forEach((d, j) => d.addEventListener("click", () => pager.scrollTo({ left: j * pager.clientWidth, behavior: "smooth" })));
  document.addEventListener("lean:water", showWaterPage);

  // Water
  const addWater = (delta) => {
    setWater(state.selected, waterFor(state.selected) + delta);
    haptic(10);
  };
  $("#water-plus").addEventListener("click", () => addWater(GLASS_ML));
  $("#water-minus").addEventListener("click", () => addWater(-GLASS_ML));
  $("#glasses").addEventListener("click", (e) => {
    const g = e.target.closest("[data-glass]");
    if (!g) return;
    const i = Number(g.dataset.glass);
    const ml = waterFor(state.selected);
    // Tapping the last full glass empties it; any other glass fills up to it.
    setWater(state.selected, ml === (i + 1) * GLASS_ML ? i * GLASS_ML : (i + 1) * GLASS_ML);
    haptic(10);
  });

  // Week strip
  $("#week").addEventListener("click", (e) => {
    const b = e.target.closest(".day");
    if (!b || b.disabled) return;
    state.selected = b.dataset.date;
    emit();
  });
  let sx = null;
  let sy = null;
  $("#week").addEventListener(
    "touchstart",
    (e) => {
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
    },
    { passive: true }
  );
  $("#week").addEventListener("touchend", (e) => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    const dir = dx < 0 ? 1 : -1;
    let next = keyOf(addDays(dateOf(state.selected), dir * 7));
    if (next > todayKey()) next = todayKey();
    if (next === state.selected) return;
    state.selected = next;
    emit();
    const week = $("#week");
    week.classList.remove("slide-left", "slide-right");
    week.getBoundingClientRect();
    week.classList.add(dir > 0 ? "slide-left" : "slide-right");
  });

  wireWorkouts($("#workouts-body"));
  initSquatCounter();

  // Food list
  const list = $("#log-list");
  wireSwipes(list);
  list.addEventListener("click", async (e) => {
    if (suppressClick) return;
    const sw = e.target.closest(".swipe");
    if (!sw) return;
    const entry = state.entries.find((x) => x.id === sw.dataset.id);
    if (!entry) return;
    if (e.target.closest("[data-swipe-del]") || e.target.closest("[data-remove]")) return swipeAway(sw, -1);
    if (sw.classList.contains("open")) return setOffset(sw, 0);
    if (e.target.closest("[data-retry]")) {
      if (!state.settings.accessCode) return openSettings(settingsOpts);
      runAnalysis({ ...entry });
      return;
    }
    closeSwipes();
    if (entry.status === "done") openEntry(entry);
  });

  window.addEventListener("resize", moveIndicator);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const now = todayKey();
    if (now !== lastToday) {
      if (state.selected === lastToday) state.selected = now;
      lastToday = now;
      emit();
    }
  });
  setInterval(tickPending, 200);
}

async function boot() {
  setTheme(state.settings.appearance);
  hydrateIcons();
  initCamera();
  wire();
  onChange(render);
  await loadAll();
  // A shared link like https://…/#code=lean-xxxx pre-fills the access code.
  const code = codeFromUrl();
  if (code) {
    updateSettings({ accessCode: code });
    if (state.settings.onboarded) toast("Access code saved");
  }
  if (!state.settings.onboarded) startOnboarding(showApp);
  else showApp();
}

if ("serviceWorker" in navigator) {
  // When a new version takes over, reload into it, but never in the middle of something.
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) {
      hadController = true; // first install, not an update
      return;
    }
    const busy = () => document.querySelector(".sheet, .ob") || !$("#camera").hidden;
    if (!busy()) return location.reload();
    const onReturn = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", onReturn);
      location.reload();
    };
    document.addEventListener("visibilitychange", onReturn);
  });
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

boot();
