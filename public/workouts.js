// Workouts tab: start a workout (her own exercises, sets and reps), today's log, recent workouts to repeat, cardio.
import { $, $$, openSheet, confirmSheet, toast, hydrateIcons } from "./ui.js";
import { icons } from "./icons.js";
import { GLUTE_EXERCISES } from "./exercise-data.js";
import { state, saveWorkout, deleteWorkout, workoutsFor, burnedFor, currentWeight, emit } from "./store.js";
import { openSquatCounter, preloadTracker } from "./squats.js";
import { readSession, startSession, openSessionDetail, lastSetsFor } from "./training.js";
import { esc, round, round1, num, uid, todayKey, dateOf, clock, haptic } from "./util.js";

export const gifUrl = (id) => `https://static.exercisedb.dev/media/${id}.gif`;
const API = "https://oss.exercisedb.dev/api/v1/exercises";

export const CARDIO = [
  { id: "walk", name: "Walking", emoji: "🚶‍♀️", met: 3.5 },
  { id: "brisk", name: "Brisk walk", emoji: "👟", met: 4.3 },
  { id: "run", name: "Running", emoji: "🏃‍♀️", met: 9.8 },
  { id: "cycle", name: "Cycling", emoji: "🚴‍♀️", met: 7.5 },
  { id: "stairs", name: "Stairs", emoji: "🪜", met: 8 },
  { id: "skip", name: "Skipping rope", emoji: "🪢", met: 8.8 },
  { id: "dance", name: "Dance", emoji: "💃", met: 6.5 },
  { id: "pilates", name: "Pilates", emoji: "🧘‍♀️", met: 3.8 },
  { id: "yoga", name: "Yoga", emoji: "🕉️", met: 3 },
  { id: "hiit", name: "HIIT", emoji: "⚡", met: 8 },
];

// Calories from METs: kcal = MET x body kg x hours. A set is ~4 s per rep plus ~45 s of rest.
const setKcal = (met, kg, reps) => met * kg * ((Math.max(1, reps) * 4 + 45) / 3600);
export const strengthKcal = (met, sets) => round(sets.reduce((s, x) => s + setKcal(met, currentWeight(), x.reps), 0));
export const cardioKcal = (met, minutes) => round((met * currentWeight() * minutes) / 60);

function newWorkout(fields) {
  const now = new Date();
  let time = now.getTime();
  if (state.selected !== todayKey()) {
    const d = dateOf(state.selected);
    d.setHours(now.getHours(), now.getMinutes());
    time = d.getTime();
  }
  return { id: uid(), date: state.selected, time, ...fields };
}

function setsSummary(w) {
  if (w.kind === "cardio") return `${w.minutes} min`;
  if (w.kind === "session") {
    const sets = w.exercises.reduce((s, e) => s + e.sets.length, 0);
    return `${sets} set${sets === 1 ? "" : "s"} · ${w.minutes} min`;
  }
  const reps = w.sets.reduce((s, x) => s + (x.reps || 0), 0);
  const top = Math.max(0, ...w.sets.map((x) => x.kg || 0));
  return `${w.sets.length} set${w.sets.length === 1 ? "" : "s"} · ${reps} reps${top ? ` · ${round1(top)} kg` : ""}`;
}

// ------------------------------------------------------------------ screen

// Bilateral squats can be counted with the camera; split/single-leg/jump variants can't (yet).
export const canCount = (ex) =>
  ex.counter === "squat" || (/\bsquat\b/i.test(ex.name) && !/(split|single|pistol|jump|bulgarian|hack|sissy|lunge|row|press|jerk)/i.test(ex.name));

const exTile = (e, cls = "") => `
  <button class="ex-tile press ${cls}" data-ex="${e.id}">
    <span class="ex-img"><img src="${gifUrl(e.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">${canCount(e) ? `<span class="ai-badge">AI counter</span>` : ""}</span>
    <b>${esc(e.name)}</b><span class="ex-eq">${esc(e.equipment)}</span>
  </button>`;

const pickExercise = (cb) => openLibrary({ onPick: cb });

function startCard() {
  const live = readSession();
  if (live) {
    const mins = Math.max(1, Math.round((Date.now() - live.startedAt) / 60000));
    return `
      <button class="start-card live press" data-start>
        <span class="start-ic"><span class="live-dot"></span></span>
        <span class="start-text"><b>Resume workout</b><span>${live.exercises.length} exercise${live.exercises.length === 1 ? "" : "s"} · ${mins} min so far</span></span>
        <span class="ic">${icons.chevronRight}</span>
      </button>`;
  }
  return `
    <button class="start-card press" data-start>
      <span class="start-ic"><span class="ic">${icons.dumbbell}</span></span>
      <span class="start-text"><b>Start a workout</b><span>Pick your exercises, sets and reps</span></span>
      <span class="ic">${icons.chevronRight}</span>
    </button>`;
}

export function renderWorkouts(el) {
  const items = workoutsFor(state.selected);
  const burned = burnedFor(state.selected);
  const minutes = items.reduce((s, w) => s + (w.minutes || 0), 0);
  const sets = items.reduce((s, w) => s + (w.sets?.length || 0) + (w.exercises?.reduce((n, e) => n + e.sets.length, 0) || 0), 0);
  const day = state.selected === todayKey() ? "Today" : dateOf(state.selected).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
  const recent = state.workouts
    .filter((w) => w.kind === "session" && w.date !== state.selected)
    .sort((a, b) => b.time - a.time)
    .slice(0, 3);

  el.innerHTML = `
    <div class="w-day">${esc(day)}</div>
    <div class="w-summary">
      <div><b>${burned}</b><span><span class="ic">${icons.flame}</span>kcal burned</span></div>
      <div><b>${minutes}</b><span><span class="ic">${icons.timer}</span>minutes</span></div>
      <div><b>${sets}</b><span><span class="ic">${icons.dumbbell}</span>sets</span></div>
    </div>

    ${startCard()}

    <h2 class="section-title">${state.selected === todayKey() ? "Today's workout" : "Workout"}</h2>
    <div class="w-log">${
      items.length
        ? items.map(logCard).join("")
        : `<div class="empty"><h3>Nothing logged yet</h3><p>Start a workout, or log some cardio below.</p></div>`
    }</div>

    ${
      recent.length
        ? `<h2 class="section-title">Recent workouts</h2><div class="w-log">${recent.map(logCard).join("")}</div>`
        : ""
    }

    <h2 class="section-title">Cardio</h2>
    <div class="carousel chips">${CARDIO.map((c) => `<button class="cardio-chip press" data-cardio="${c.id}"><span>${c.emoji}</span>${esc(c.name)}</button>`).join("")}</div>`;
  hydrateIcons(el);
}

function logCard(w) {
  const firstId = w.kind === "session" ? w.exercises[0]?.id : w.exerciseId;
  const thumb = firstId
    ? `<img src="${gifUrl(firstId)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
    : `<span class="emoji">${CARDIO.find((c) => c.id === w.activity)?.emoji ?? "🏋️‍♀️"}</span>`;
  const ai = w.counted || w.exercises?.some((e) => e.sets.some((s) => s.counted));
  const when = w.date === todayKey() ? clock(w.time) : dateOf(w.date).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  return `
    <button class="w-item press" data-w="${w.id}">
      <div class="w-thumb">${thumb}</div>
      <div class="w-body">
        <b>${esc(w.name)}</b>
        <span>${esc(setsSummary(w))}</span>
        ${ai ? `<em class="ai-tag">AI counted</em>` : ""}
      </div>
      <div class="w-side">
        <span class="w-time">${esc(when)}</span>
        <span class="w-kcal"><span class="ic">${icons.flame}</span>${w.kcal}</span>
      </div>
    </button>`;
}

export function wireWorkouts(el) {
  el.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("[data-start]")) return startSession(pickExercise);
    const c = t.closest("[data-cardio]");
    if (c) return openCardioSheet(CARDIO.find((x) => x.id === c.dataset.cardio));
    const w = t.closest("[data-w]");
    if (w) {
      const item = state.workouts.find((x) => x.id === w.dataset.w);
      if (!item) return;
      if (item.kind === "cardio") return openCardioSheet(CARDIO.find((x) => x.id === item.activity) ?? CARDIO[0], item);
      if (item.kind === "session")
        return openSessionDetail(item, { onRepeat: () => startSession(pickExercise, item), onDelete: () => deleteWorkout(item.id) });
      return openExerciseSheet(GLUTE_EXERCISES.find((x) => x.id === item.exerciseId) ?? { id: item.exerciseId, name: item.name, met: item.met ?? 5 }, item);
    }
  });
}

function goWorkouts() {
  if (state.tab !== "workouts") {
    state.tab = "workouts";
    emit();
  }
}

// ------------------------------------------------------------------ exercise sheet (sets x reps x kg)

async function loadDetails(ex) {
  if (ex.steps) return ex;
  try {
    const r = await fetch(`${API}/${ex.id}`);
    const j = await r.json();
    const d = j.data;
    return {
      ...ex,
      equipment: d.equipments?.[0] ?? "",
      bodyweight: (d.equipments ?? []).join() === "bodyweight",
      targets: [...(d.targetMuscles ?? []), ...(d.secondaryMuscles ?? []).slice(0, 2)],
      steps: (d.instructions ?? []).map((s) => s.replace(/^Step:\d+\s*/, "")),
    };
  } catch {
    return { ...ex, steps: [] };
  }
}

export function openExerciseSheet(base, existing) {
  if (canCount(base)) preloadTracker();
  const last = existing ? null : lastSetsFor(base.id);
  let sets = existing?.sets?.map((s) => ({ ...s })) ?? (last ? last.map((s) => ({ reps: s.reps, kg: s.kg })) : [{ reps: 12, kg: base.bodyweight ? 0 : 10 }]);
  openSheet({
    tall: true,
    html: `
      <div class="sheet-head"><h2 class="sheet-title">${esc(base.name)}</h2><button class="round-btn press" data-close aria-label="Close" data-icon="close"></button></div>
      <div class="ex-hero"><img src="${gifUrl(base.id)}" alt="${esc(base.name)} demo"></div>
      <div class="ex-meta" data-meta></div>
      ${last ? `<div class="last-time">Last time: ${esc(last.map((s) => `${s.reps}${s.kg ? ` × ${round1(s.kg)} kg` : ""}`).join(", "))}. Try one more rep or a little more weight.</div>` : ""}
      ${
        canCount(base)
          ? `<button class="count-btn press" data-count><span class="ic">${icons.camera}</span><span><b>Count reps with camera</b><small>Prop your phone up and squat. AI counts and checks depth.</small></span></button>`
          : ""
      }
      <div class="sets-head"><span>Set</span><span>Reps</span><span>Weight (kg)</span><span></span></div>
      <div class="sets" data-sets></div>
      <button class="btn light" style="height:46px;margin-top:8px" data-add-set><span class="ic">${icons.plus}</span>Add set</button>
      <div class="ex-steps" data-steps></div>
      <div class="btn-row">
        ${existing ? `<button class="btn light" data-del>Delete</button>` : ""}
        <button class="btn" data-save>${existing ? "Save" : "Log exercise"} · <span data-kcal>0</span> kcal</button>
      </div>`,
    async onMount(sheet, close) {
      let counted = existing?.counted ?? false;
      let countedSeconds = 0;
      const paint = () => {
        $("[data-sets]", sheet).innerHTML = sets
          .map(
            (s, i) => `
          <div class="set-row">
            <span class="set-n">${i + 1}</span>
            <input class="input" type="number" inputmode="numeric" data-i="${i}" data-k="reps" value="${s.reps}">
            <input class="input" type="number" inputmode="decimal" data-i="${i}" data-k="kg" value="${s.kg || ""}" placeholder="—">
            <button class="round-btn" data-rm="${i}" aria-label="Remove set" ${sets.length === 1 ? "disabled" : ""}><span class="ic">${icons.minus}</span></button>
          </div>`
          )
          .join("");
        $("[data-kcal]", sheet).textContent = strengthKcal(base.met ?? 5, sets);
      };
      paint();
      $("[data-sets]", sheet).addEventListener("input", (e) => {
        const i = Number(e.target.dataset.i);
        if (Number.isNaN(i)) return;
        sets[i][e.target.dataset.k] = Math.max(0, num(e.target.value));
        $("[data-kcal]", sheet).textContent = strengthKcal(base.met ?? 5, sets);
      });
      $("[data-sets]", sheet).addEventListener("click", (e) => {
        const rm = e.target.closest("[data-rm]");
        if (!rm || sets.length === 1) return;
        sets.splice(Number(rm.dataset.rm), 1);
        paint();
      });
      $("[data-count]", sheet)?.addEventListener("click", () =>
        openSquatCounter(({ reps, seconds }) => {
          // Fill the untouched starter set, otherwise add a new set with the same weight.
          const last = sets[sets.length - 1];
          const fresh = !existing && !counted && sets.length === 1 && !last;
          if (fresh) sets[0] = { reps, kg: last.kg || 0 };
          else sets.push({ reps, kg: last?.kg || 0 });
          counted = true;
          countedSeconds += seconds;
          haptic(20);
          paint();
          toast(`${reps} reps added`);
        })
      );
      $("[data-add-set]", sheet).addEventListener("click", () => {
        sets.push({ ...sets[sets.length - 1] });
        haptic(6);
        paint();
      });
      $("[data-save]", sheet).addEventListener("click", async () => {
        const clean = sets.filter((s) => s.reps > 0);
        if (!clean.length) return toast("Add at least one set with reps");
        const extra = { counted, ...(countedSeconds ? { minutes: Math.max(1, Math.round(countedSeconds / 60)) } : {}) };
        const w = existing
          ? { ...existing, ...extra, sets: clean, kcal: strengthKcal(base.met ?? 5, clean) }
          : newWorkout({ kind: "strength", exerciseId: base.id, name: base.name, met: base.met ?? 5, sets: clean, kcal: strengthKcal(base.met ?? 5, clean), ...extra });
        close();
        await saveWorkout(w);
        goWorkouts();
        toast(existing ? "Workout updated" : `Logged ${base.name}`);
      });
      $("[data-del]", sheet)?.addEventListener("click", async () => {
        if (!(await confirmSheet({ title: "Delete this exercise?", text: "It will be removed from your workout.", confirm: "Delete", danger: true }))) return;
        close();
        await deleteWorkout(existing.id);
      });
      const ex = await loadDetails(base);
      $("[data-meta]", sheet).innerHTML = [ex.equipment, ...(ex.targets ?? [])]
        .filter(Boolean)
        .map((t) => `<span>${esc(t)}</span>`)
        .join("");
      $("[data-steps]", sheet).innerHTML = ex.steps?.length
        ? `<h4>How to do it</h4><ol>${ex.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`
        : "";
    },
  });
}

// ------------------------------------------------------------------ cardio sheet

function openCardioSheet(activity, existing) {
  let minutes = existing?.minutes ?? 30;
  openSheet({
    html: `
      <div class="sheet-head"><h2 class="sheet-title">${activity.emoji} ${esc(activity.name)}</h2><button class="round-btn press" data-close aria-label="Close" data-icon="close"></button></div>
      <div class="big-readout"><span data-min>${minutes}</span><small> min</small></div>
      <input class="range" type="range" min="5" max="180" step="5" value="${minutes}">
      <div class="pace-note" data-note></div>
      <div class="btn-row">
        ${existing ? `<button class="btn light" data-del>Delete</button>` : ""}
        <button class="btn" data-save>${existing ? "Save" : "Log activity"}</button>
      </div>`,
    onMount(sheet, close) {
      const input = $(".range", sheet);
      const paint = () => {
        minutes = Number(input.value);
        input.style.setProperty("--fill", `${((minutes - 5) / 175) * 100}%`);
        $("[data-min]", sheet).textContent = minutes;
        $("[data-note]", sheet).textContent = `About ${cardioKcal(activity.met, minutes)} kcal burned`;
      };
      paint();
      input.addEventListener("input", paint);
      $("[data-save]", sheet).addEventListener("click", async () => {
        const fields = { kind: "cardio", activity: activity.id, name: activity.name, minutes, kcal: cardioKcal(activity.met, minutes) };
        close();
        await saveWorkout(existing ? { ...existing, ...fields } : newWorkout(fields));
        goWorkouts();
        toast(`Logged ${minutes} min of ${activity.name.toLowerCase()}`);
      });
      $("[data-del]", sheet)?.addEventListener("click", async () => {
        close();
        await deleteWorkout(existing.id);
      });
    },
  });
}

// ------------------------------------------------------------------ search all exercises

let catalogue;
const loadCatalogue = () => (catalogue ??= fetch("data/exercises.json").then((r) => r.json()));

function openLibrary({ onPick } = {}) {
  const groups = [...new Set(GLUTE_EXERCISES.map((e) => e.group))];
  openSheet({
    tall: true,
    html: `
      <div class="sheet-head"><h2 class="sheet-title">${onPick ? "Add exercise" : "Exercises"}</h2><button class="round-btn press" data-close aria-label="Close" data-icon="close"></button></div>
      <div class="search-box"><span data-icon="search"></span>
        <input class="input" type="search" placeholder="Search home exercises" enterkeyhint="search" autocomplete="off"></div>
      <p class="status" style="margin:8px 4px 0">No gym needed: everything here uses just your body or a resistance band.</p>
      <div data-browse>${groups
        .map(
          (g) => `<div class="w-group">${esc(g)}</div>
        <div class="ex-grid">${GLUTE_EXERCISES.filter((e) => e.group === g).map((e) => exTile(e)).join("")}</div>`
        )
        .join("")}
        <p class="status" style="text-align:center;margin-top:16px">Exercise demos from ExerciseDB</p></div>
      <div class="results" data-results hidden></div>`,
    async onMount(sheet, close) {
      const input = $("input", sheet);
      const browse = $("[data-browse]", sheet);
      const results = $("[data-results]", sheet);
      const choose = (ex) => {
        if (!onPick) return openExerciseSheet(ex);
        close();
        haptic(10);
        onPick(ex);
      };
      browse.addEventListener("click", (e) => {
        const b = e.target.closest("[data-ex]");
        if (b) choose(GLUTE_EXERCISES.find((x) => x.id === b.dataset.ex));
      });
      input.addEventListener("input", async () => {
        const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
        browse.hidden = words.length > 0;
        results.hidden = !words.length;
        if (!words.length) return;
        const list = await loadCatalogue();
        const match = (text) => words.every((w) => text.toLowerCase().includes(w));
        // Our curated names ("Cable Glute Kickback") first, then the full catalogue.
        const curated = GLUTE_EXERCISES.filter((e) => match(`${e.name} ${e.group} ${e.equipment} ${(e.targets ?? []).join(" ")}`)).map((e) => [e.id, e.name, e.targets?.[0] ?? "glutes", e.equipment]);
        const seen = new Set(curated.map((r) => r[0]));
        const hits = [...curated, ...list.filter((r) => !seen.has(r[0]) && match(`${r[1]} ${r[2]} ${r[3]}`))].slice(0, 60);
        results.innerHTML = hits.length
          ? hits
              .map(
                (r) => `
          <button class="result press" data-id="${r[0]}">
            <img class="result-gif" src="${gifUrl(r[0])}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
            <div class="result-main"><div class="result-name">${esc(r[1])}</div><div class="result-sub">${esc(r[2])} · ${esc(r[3])}</div></div>
          </button>`
              )
              .join("")
          : `<div class="note">No exercises match “${esc(input.value)}”.</div>`;
      });
      results.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-id]");
        if (!b) return;
        const r = (await loadCatalogue()).find((x) => x[0] === b.dataset.id);
        const curated = GLUTE_EXERCISES.find((x) => x.id === r[0]);
        const ex = curated ?? { id: r[0], name: r[1], met: 5, bodyweight: r[3] === "bodyweight", band: r[3] === "resistance band" };
        if (!curated && canCount(ex)) ex.counter = "squat";
        choose(ex);
      });
    },
  });
}
