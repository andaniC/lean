// Free-form workout sessions: she picks the exercises, sets, reps and weight herself.
// Sets are ticked off with a rest timer; squats can be counted with the camera; any past
// workout can be repeated as a routine.
import { $, openSheet, confirmSheet, toast } from "./ui.js";
import { icons } from "./icons.js";
import { GLUTE_EXERCISES } from "./exercise-data.js";
import { state, saveWorkout, currentWeight, emit } from "./store.js";
import { openSquatCounter, preloadTracker } from "./squats.js";
import { openDemo } from "./demo.js";
import { esc, round, round1, num, uid, todayKey, dateOf, haptic, clamp } from "./util.js";
import { STORAGE } from "./config.js";

const gif = (id) => `https://static.exercisedb.dev/media/${id}.gif`;
const exById = (id) => GLUTE_EXERCISES.find((e) => e.id === id);
const SESSION_KEY = `${STORAGE}.workout.v2`;
const REST_SECONDS = 90;

/** Most recent sets for an exercise, from workouts or single-exercise logs. */
export function lastSetsFor(id) {
  for (const w of [...state.workouts].sort((a, b) => b.time - a.time)) {
    if (w.kind === "session") {
      const e = w.exercises.find((x) => x.id === id);
      if (e?.sets.length) return e.sets;
    } else if (w.exerciseId === id && w.sets?.length) return w.sets;
  }
  return null;
}

export function setsText(sets) {
  const reps = sets.map((s) => s.reps).join(", ");
  const kgs = [...new Set(sets.map((s) => round1(s.kg || 0)))];
  if (kgs.length === 1) return kgs[0] ? `${reps} × ${kgs[0]} kg` : `${reps} reps`;
  return sets.map((s) => `${s.reps}${s.kg ? ` × ${round1(s.kg)} kg` : ""}`).join(", ");
}

export function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function writeSession(s) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {}
}

function exerciseEntry(ex, sets) {
  const last = lastSetsFor(ex.id);
  return {
    id: ex.id,
    name: ex.name,
    weighted: !ex.bodyweight && !ex.band,
    band: !!ex.band,
    counter: ex.counter === "squat",
    last: last ? setsText(last) : "",
    note: ex.note ?? "",
    sets: (sets ?? last ?? [{ reps: 10 }, { reps: 10 }, { reps: 10 }]).map((s) => ({ reps: s.reps ?? 10, kg: s.kg || "", done: false })),
  };
}

/** Starts (or resumes) a workout. `from` is a past workout to repeat. */
export function startSession(pickExercise, from) {
  const live = readSession();
  if (live && !from) return openSession(live, pickExercise);
  const session = {
    name: from?.name ?? "",
    startedAt: Date.now(),
    exercises: from ? from.exercises.map((e) => exerciseEntry(exById(e.id) ?? { id: e.id, name: e.name }, e.sets)) : [],
  };
  writeSession(session);
  emit();
  openSession(session, pickExercise);
}

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

function openSession(session, pickExercise) {
  if (session.exercises.some((e) => e.counter)) preloadTracker();
  let restEnd = 0;
  let restTimer = 0;
  let clockTimer = 0;
  openSheet({
    tall: true,
    cls: "session-sheet",
    html: `
      <div class="sheet-head">
        <div style="flex:1;min-width:0">
          <input class="session-name" data-name placeholder="Workout name, e.g. Glute day" value="${esc(session.name)}" maxlength="40">
          <div class="session-clock"><span class="ic">${icons.timer}</span><span data-clock>0:00</span></div>
        </div>
        <button class="round-btn press" data-close aria-label="Minimise" data-icon="chevronLeft" style="transform:rotate(-90deg)"></button>
      </div>
      <div data-list></div>
      <button class="add-ex press" data-add-ex><span class="ic">${icons.plus}</span>Add exercise</button>
      <button class="link-btn" data-discard>Discard workout</button>
      <div class="session-foot">
        <button class="rest-pill" data-rest hidden><span class="ic">${icons.timer}</span>Rest <b data-rest-left>1:30</b> · Skip</button>
        <button class="btn" data-finish>Finish workout</button>
      </div>`,
    onClose() {
      clearInterval(restTimer);
      clearInterval(clockTimer);
      emit();
    },
    onMount(sheet, close) {
      const list = $("[data-list]", sheet);
      const save = () => writeSession(session);
      const doneSets = () => session.exercises.reduce((s, e) => s + e.sets.filter((x) => x.done).length, 0);

      const paint = () => {
        list.innerHTML = session.exercises.length
          ? session.exercises
              .map((e, ei) => {
                const done = e.sets.filter((s) => s.done).length;
                return `
          <div class="s-ex ${done && done === e.sets.length ? "complete" : ""}">
            <div class="s-ex-head">
              <img src="${gif(e.id)}" alt="How to do ${esc(e.name)}" loading="lazy" data-demo="${ei}" onerror="this.style.visibility='hidden'">
              <div data-demo="${ei}">
                <b>${esc(e.name)} <span class="how-link">How to</span></b>
                <span>${e.last ? `Last time: ${esc(e.last)}` : esc(e.note || "First time: go until 1–2 good reps are left")}</span>
              </div>
              <button class="s-remove" data-remove="${ei}" aria-label="Remove exercise">${icons.close}</button>
            </div>
            ${
              e.counter
                ? `<button class="count-btn small press" data-count="${ei}"><span class="ic">${icons.camera}</span><span><b>Count reps with camera</b></span></button>`
                : ""
            }
            <div class="s-sets">
              <div class="s-set s-labels"><span>Set</span><span>Reps</span><span>${e.weighted ? "kg" : ""}</span><span></span></div>
              ${e.sets
                .map(
                  (s, si) => `
                <div class="s-set ${s.done ? "done" : ""}">
                  <span class="set-n">${si + 1}</span>
                  <input type="number" inputmode="numeric" data-ei="${ei}" data-si="${si}" data-k="reps" value="${s.reps}" aria-label="Reps">
                  ${
                    e.weighted
                      ? `<input type="number" inputmode="decimal" data-ei="${ei}" data-si="${si}" data-k="kg" value="${s.kg}" placeholder="0" aria-label="Weight in kg">`
                      : `<span class="s-bw">${e.band ? "Band" : "Body"}</span>`
                  }
                  <button class="s-check" data-check="${ei}:${si}" aria-label="Set done">${icons.check}</button>
                </div>`
                )
                .join("")}
              <div class="s-set-actions">
                <button data-add="${ei}">+ Add set</button>
                ${e.sets.length > 1 ? `<button data-drop="${ei}">− Remove set</button>` : ""}
              </div>
            </div>
          </div>`;
              })
              .join("")
          : `<div class="empty" style="margin-top:12px"><h3>Add your first exercise</h3><p>Choose exercises and set your own sets, reps and weight.</p></div>`;
        $("[data-finish]", sheet).disabled = doneSets() === 0;
      };
      paint();

      const tickClock = () => ($("[data-clock]", sheet).textContent = mmss((Date.now() - session.startedAt) / 1000));
      tickClock();
      clockTimer = setInterval(tickClock, 1000);

      const stopRest = () => {
        clearInterval(restTimer);
        $("[data-rest]", sheet).hidden = true;
      };
      const startRest = () => {
        restEnd = Date.now() + REST_SECONDS * 1000;
        $("[data-rest]", sheet).hidden = false;
        clearInterval(restTimer);
        const tick = () => {
          const left = Math.ceil((restEnd - Date.now()) / 1000);
          if (left <= 0) {
            stopRest();
            haptic(200);
            toast("Rest's over. Next set!");
            return;
          }
          $("[data-rest-left]", sheet).textContent = mmss(left);
        };
        tick();
        restTimer = setInterval(tick, 250);
      };
      $("[data-rest]", sheet).addEventListener("click", stopRest);

      $("[data-name]", sheet).addEventListener("input", (e) => {
        session.name = e.target.value;
        save();
      });

      $("[data-add-ex]", sheet).addEventListener("click", () =>
        pickExercise((ex) => {
          session.exercises.push(exerciseEntry(ex));
          if (ex.counter === "squat") preloadTracker();
          save();
          paint();
          setTimeout(() => list.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
        })
      );

      list.addEventListener("input", (ev) => {
        const t = ev.target;
        if (!t.dataset.k) return;
        session.exercises[t.dataset.ei].sets[t.dataset.si][t.dataset.k] = t.value === "" ? "" : Math.max(0, num(t.value));
        save();
      });

      list.addEventListener("click", async (ev) => {
        const demo = ev.target.closest("[data-demo]");
        if (demo) {
          const e = session.exercises[Number(demo.dataset.demo)];
          return openDemo(exById(e.id) ?? { id: e.id, name: e.name });
        }
        const check = ev.target.closest("[data-check]");
        if (check) {
          const [ei, si] = check.dataset.check.split(":").map(Number);
          const s = session.exercises[ei].sets[si];
          s.done = !s.done;
          save();
          paint();
          if (s.done) {
            haptic(15);
            startRest();
          }
          return;
        }
        const add = ev.target.closest("[data-add]");
        if (add) {
          const e = session.exercises[Number(add.dataset.add)];
          const prev = e.sets[e.sets.length - 1];
          e.sets.push({ reps: prev?.reps ?? 10, kg: prev?.kg ?? "", done: false });
          save();
          paint();
          return;
        }
        const drop = ev.target.closest("[data-drop]");
        if (drop) {
          session.exercises[Number(drop.dataset.drop)].sets.pop();
          save();
          paint();
          return;
        }
        const remove = ev.target.closest("[data-remove]");
        if (remove) {
          const e = session.exercises[Number(remove.dataset.remove)];
          if (e.sets.some((s) => s.done) && !(await confirmSheet({ title: `Remove ${e.name}?`, text: "Its ticked sets won't be saved.", confirm: "Remove", danger: true }))) return;
          session.exercises.splice(Number(remove.dataset.remove), 1);
          save();
          paint();
          return;
        }
        const count = ev.target.closest("[data-count]");
        if (count) {
          const e = session.exercises[Number(count.dataset.count)];
          openSquatCounter(({ reps }) => {
            const s = e.sets.find((x) => !x.done) ?? (e.sets.push({ reps: 0, kg: "", done: false }), e.sets[e.sets.length - 1]);
            s.reps = reps;
            s.done = true;
            s.counted = true;
            save();
            paint();
            toast(`${reps} reps counted`);
            startRest();
          });
        }
      });

      $("[data-discard]", sheet).addEventListener("click", async () => {
        const ok = await confirmSheet({ title: "Discard this workout?", text: "Nothing from it will be saved.", confirm: "Discard", danger: true });
        if (!ok) return;
        writeSession(null);
        close();
      });

      $("[data-finish]", sheet).addEventListener("click", async () => {
        const minutes = clamp(Math.round((Date.now() - session.startedAt) / 60000), 1, 240);
        const exercises = session.exercises
          .map((e) => ({
            id: e.id,
            name: e.name,
            sets: e.sets.filter((s) => s.done).map((s) => ({ reps: Number(s.reps) || 0, kg: Number(s.kg) || 0, ...(s.counted ? { counted: true } : {}) })),
          }))
          .filter((e) => e.sets.length);
        // Strength training is ~5 METs over the whole session, rests included.
        const kcal = round(5 * currentWeight() * (minutes / 60));
        const w = {
          id: uid(),
          kind: "session",
          date: todayKey(),
          time: Date.now(),
          name: session.name.trim() || "Workout",
          exercises,
          minutes,
          kcal,
        };
        writeSession(null);
        close();
        await saveWorkout(w);
        state.selected = todayKey();
        state.tab = "workouts";
        emit();
        haptic(40);
        const sets = exercises.reduce((s, e) => s + e.sets.length, 0);
        toast(`Workout saved · ${sets} sets · ${minutes} min`);
      });
    },
  });
}

/** A finished workout: see the sets, repeat it as a routine, or delete it. */
export function openSessionDetail(w, { onRepeat, onDelete }) {
  openSheet({
    tall: true,
    html: `
      <div class="sheet-head"><h2 class="sheet-title">${esc(w.name)}</h2><button class="round-btn press" data-close aria-label="Close" data-icon="close"></button></div>
      <p class="ob-sub" style="margin:0 0 8px">${dateOf(w.date).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })} · ${w.minutes} min · ${w.kcal} kcal</p>
      ${w.exercises
        .map(
          (e) => `
        <div class="plan-ex">
          <img src="${gif(e.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
          <div><b>${esc(e.name)}</b><span>${e.sets.length} set${e.sets.length === 1 ? "" : "s"} · ${esc(setsText(e.sets))}</span></div>
        </div>`
        )
        .join("")}
      <div class="btn-row">
        <button class="btn light" data-del>Delete</button>
        <button class="btn" data-repeat>Repeat workout</button>
      </div>`,
    onMount(sheet, close) {
      $("[data-repeat]", sheet).addEventListener("click", async () => {
        if (readSession() && !(await confirmSheet({ title: "Replace your current workout?", text: "You have a workout in progress. Starting this one discards it.", confirm: "Replace" }))) return;
        close();
        setTimeout(() => onRepeat?.(), 250);
      });
      $("[data-del]", sheet).addEventListener("click", async () => {
        if (!(await confirmSheet({ title: "Delete this workout?", text: "It will be removed from your history.", confirm: "Delete", danger: true }))) return;
        close();
        onDelete?.();
      });
    },
  });
}
