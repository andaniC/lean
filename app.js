import { state, onChange, emit, loadAll, totalsFor, entriesFor, streak, updateSettings, deleteEntry } from "./store.js";
import { $, $$, hydrateIcons, setRing, animateNumber, toast, confirmSheet } from "./ui.js";
import { icons } from "./icons.js";
import { initCamera, runAnalysis } from "./capture.js";
import { openPlusMenu, openEntry, openSettings, openWeightSheet } from "./flows.js";
import { startOnboarding, codeFromUrl } from "./onboarding.js";
import { renderProgress } from "./progress.js";
import { dateOf, todayKey, addDays, mondayOf, keyOf, round, esc } from "./util.js";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
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
  const left = g.calories - t.calories;
  animateNumber($("#cal-num"), eaten ? round(t.calories) : Math.abs(round(left)));
  $("#cal-label").textContent = eaten ? "Calories eaten" : left >= 0 ? "Calories left" : "Calories over";
  setRing($("#cal-ring"), g.calories ? t.calories / g.calories : 0, 10.4, flame);

  for (const key of ["protein", "carbs", "fat"]) {
    const name = key[0].toUpperCase() + key.slice(1);
    const rem = g[key] - t[key];
    animateNumber($(`#${key}-num`), eaten ? round(t[key]) : Math.abs(round(rem)), "g");
    $(`#${key}-label`).textContent = eaten ? `${name} eaten` : rem >= 0 ? `${name} left` : `${name} over`;
    setRing($(`#${key}-ring`), g[key] ? t[key] / g[key] : 0, 13.5);
  }
  $("#code-banner").hidden = !!state.settings.accessCode;
}

function thumb(entry, overlay = "") {
  const inner = entry.photo
    ? `<img src="${entry.photo}" alt="">`
    : `<span class="ic">${entry.source === "text" ? icons.sparkle : icons.fork}</span>`;
  return `<div class="food-thumb">${inner}${overlay}</div>`;
}

function entryMarkup(e) {
  if (e.status === "pending") {
    const C = 2 * Math.PI * 21;
    return `<div class="food" data-id="${e.id}" data-pending>
      ${thumb(e, `<div class="veil"><div class="pct-ring"><svg viewBox="0 0 50 50"><circle class="track" cx="25" cy="25" r="21"/><circle class="arc" cx="25" cy="25" r="21" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg><span class="pct">0%</span></div></div>`)}
      <div class="food-body">
        <div class="pending-title">${e.source === "text" ? "Estimating…" : "Analyzing food…"}</div>
        <div class="shimmer w1"></div><div class="shimmer w2"></div>
        <div class="pending-note">${e.source === "text" ? esc(e.query) : "We'll have it ready in a few seconds"}</div>
      </div></div>`;
  }
  if (e.status === "error") {
    return `<div class="food" data-id="${e.id}">
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
  const kcal = round(e.calories * (e.servings || 1));
  return `<button class="food press" data-id="${e.id}" data-open>
    ${thumb(e)}
    <div class="food-body">
      <div class="food-kcal">${flame}${kcal} calories</div>
      <div class="food-name">${esc(e.name)}</div>
    </div></button>`;
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
  // Keyed update so existing cards don't re-animate on every change.
  const old = new Map($$("[data-id]", list).map((el) => [el.dataset.id, el]));
  const frag = document.createDocumentFragment();
  for (const e of entries) {
    const sig = `${e.status}|${e.name}|${e.calories}|${e.servings}|${e.error}|${e.photo?.length ?? 0}`;
    let el = old.get(e.id);
    if (!el || el.dataset.sig !== sig) {
      const tpl = document.createElement("template");
      tpl.innerHTML = entryMarkup(e).trim();
      el = tpl.content.firstElementChild;
      el.dataset.sig = sig;
      if (old.has(e.id)) el.style.animation = "none";
    }
    frag.append(el);
  }
  list.replaceChildren(frag);
}

function tickPending() {
  for (const el of $$("[data-pending]")) {
    const e = state.entries.find((x) => x.id === el.dataset.id);
    if (!e?.startedAt) continue;
    const pct = Math.min(96, Math.round(100 * (1 - Math.exp(-(Date.now() - e.startedAt) / 6500))));
    const arc = $(".arc", el);
    const C = parseFloat(arc.getAttribute("stroke-dasharray"));
    arc.setAttribute("stroke-dashoffset", String(C * (1 - pct / 100)));
    $(".pct", el).textContent = `${pct}%`;
  }
}

// ------------------------------------------------------------------ tabs

function moveIndicator() {
  const tab = $(`.tab[data-tab="${state.tab}"]`);
  const ind = $("#tab-indicator");
  if (!tab) return;
  ind.style.transform = `translateX(${tab.offsetLeft + tab.offsetWidth / 2 - ind.offsetWidth / 2}px)`;
}

function renderTabs() {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === state.tab));
  const home = $("#screen-home");
  const prog = $("#screen-progress");
  if (home.hidden !== (state.tab !== "home")) home.hidden = state.tab !== "home";
  if (prog.hidden !== (state.tab !== "progress")) prog.hidden = state.tab !== "progress";
  moveIndicator();
}

function render() {
  if ($("#app").hidden) return;
  renderTabs();
  if (state.tab === "home") {
    renderStreak();
    renderWeek();
    renderSummary();
    renderLog();
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

const settingsOpts = { onRedoOnboarding: () => startOnboarding(render, { fromSettings: true }) };

function wire() {
  $$(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      if (state.tab === t.dataset.tab) return;
      state.tab = t.dataset.tab;
      window.scrollTo({ top: 0 });
      emit();
    })
  );
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

  $("#log-list").addEventListener("click", async (e) => {
    const card = e.target.closest("[data-id]");
    if (!card) return;
    const entry = state.entries.find((x) => x.id === card.dataset.id);
    if (!entry) return;
    if (e.target.closest("[data-retry]")) {
      if (!state.settings.accessCode) return openSettings(settingsOpts);
      runAnalysis({ ...entry });
      return;
    }
    if (e.target.closest("[data-remove]")) {
      const ok = await confirmSheet({ title: "Delete this scan?", text: "It will be removed from your log.", confirm: "Delete", danger: true });
      if (ok) deleteEntry(entry.id);
      return;
    }
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
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

boot();
