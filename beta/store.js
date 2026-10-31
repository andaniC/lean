// App state, persistence and derived numbers. Views subscribe with onChange().
import * as db from "./db.js";
import { todayKey, keyOf, addDays, dateOf, clamp } from "./util.js";
import { STORAGE } from "./config.js";

const SETTINGS_KEY = `${STORAGE}.settings.v1`;

export const DEFAULT_SETTINGS = {
  onboarded: false,
  addBurned: false,
  name: "",
  accessCode: "",
  profile: {
    goal: "lose",
    sex: "female",
    age: 28,
    height: 165,
    weight: 70,
    targetWeight: 64,
    pace: 0.5,
    workouts: "0-2",
    wants: [],
    glutes: "lean",
    startWeight: 70,
    startDate: null,
  },
  goals: { calories: 2000, protein: 120, carbs: 220, fat: 65, water: 2000 },
};

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    if (!saved) return structuredClone(DEFAULT_SETTINGS);
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      profile: { ...DEFAULT_SETTINGS.profile, ...saved.profile },
      goals: { ...DEFAULT_SETTINGS.goals, ...saved.goals },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export const state = {
  settings: readSettings(),
  entries: [],
  weights: [],
  water: {},
  workouts: [],
  selected: todayKey(),
  tab: "home",
  calView: "left",
};

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
export const emit = () => listeners.forEach((fn) => fn());

export function updateSettings(patch) {
  const s = state.settings;
  state.settings = {
    ...s,
    ...patch,
    profile: { ...s.profile, ...patch.profile },
    goals: { ...s.goals, ...patch.goals },
  };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  } catch {}
  emit();
}

export async function loadAll() {
  try {
    navigator.storage?.persist?.();
  } catch {}
  const [entries, weights, water, workouts] = await Promise.all([
    db.getAll("entries"),
    db.getAll("weights"),
    db.getAll("water"),
    db.getAll("workouts"),
  ]);
  state.workouts = workouts;
  state.water = Object.fromEntries(water.map((w) => [w.date, w.ml]));
  // Requests can't survive an app restart: surface interrupted scans as retryable errors.
  for (const e of entries) {
    if (e.status === "pending") {
      e.status = "error";
      e.error = "The app was closed before this finished.";
      db.put("entries", e);
    }
  }
  state.entries = entries;
  state.weights = weights.sort((a, b) => a.date.localeCompare(b.date) || a.time - b.time);
  emit();
}

export async function saveEntry(entry) {
  const i = state.entries.findIndex((e) => e.id === entry.id);
  if (i >= 0) state.entries[i] = entry;
  else state.entries.push(entry);
  emit();
  await db.put("entries", entry);
}

export async function deleteEntry(id) {
  state.entries = state.entries.filter((e) => e.id !== id);
  emit();
  await db.remove("entries", id);
}

export async function saveWeight(w) {
  const sameDay = state.weights.filter((x) => x.id !== w.id && x.date === w.date);
  await Promise.all(sameDay.map((x) => db.remove("weights", x.id)));
  state.weights = state.weights.filter((x) => x.id !== w.id && x.date !== w.date);
  state.weights.push(w);
  state.weights.sort((a, b) => a.date.localeCompare(b.date));
  // Keep the profile's current weight in sync with the latest weigh-in.
  const latest = state.weights[state.weights.length - 1];
  updateSettings({ profile: { weight: latest.kg } });
  await db.put("weights", w);
}

export async function deleteWeight(id) {
  state.weights = state.weights.filter((w) => w.id !== id);
  emit();
  await db.remove("weights", id);
}

export async function replaceAll({ entries = [], weights = [], water = {}, workouts = [] }) {
  await Promise.all([db.clear("entries"), db.clear("weights"), db.clear("water"), db.clear("workouts")]);
  await Promise.all([
    db.putMany("workouts", workouts),
    db.putMany("entries", entries),
    db.putMany("weights", weights),
    db.putMany("water", Object.entries(water).map(([date, ml]) => ({ date, ml }))),
  ]);
  state.water = { ...water };
  state.workouts = workouts;
  state.entries = entries;
  state.weights = weights.sort((a, b) => a.date.localeCompare(b.date));
  emit();
}

export const entryTotals = (e) => {
  const s = e.servings || 1;
  return { calories: e.calories * s, protein: e.protein * s, carbs: e.carbs * s, fat: e.fat * s };
};

export function totalsFor(key) {
  const t = { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 };
  for (const e of state.entries) {
    if (e.date !== key || e.status !== "done") continue;
    const x = entryTotals(e);
    t.calories += x.calories;
    t.protein += x.protein;
    t.carbs += x.carbs;
    t.fat += x.fat;
    t.count++;
  }
  return t;
}

export const entriesFor = (key) =>
  state.entries.filter((e) => e.date === key).sort((a, b) => b.time - a.time);

/** Consecutive days with at least one logged food, ending today (or yesterday if today is still empty). */
export function streak() {
  const logged = new Set(state.entries.filter((e) => e.status === "done").map((e) => e.date));
  let d = new Date();
  if (!logged.has(keyOf(d))) d = addDays(d, -1);
  let n = 0;
  while (logged.has(keyOf(d))) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export const currentWeight = () => {
  const w = state.weights[state.weights.length - 1];
  return w ? w.kg : state.settings.profile.weight;
};

export const loggedDays = () => new Set(state.entries.filter((e) => e.status === "done").map((e) => e.date)).size;

export const isFuture = (key) => dateOf(key) > dateOf(todayKey());

export const waterFor = (key) => state.water[key] ?? 0;

export async function setWater(key, ml) {
  const v = clamp(Math.round(ml), 0, 10000);
  state.water[key] = v;
  emit();
  await db.put("water", { date: key, ml: v });
}

export const workoutsFor = (key) => state.workouts.filter((w) => w.date === key).sort((a, b) => b.time - a.time);
export const burnedFor = (key) => workoutsFor(key).reduce((sum, w) => sum + (w.kcal || 0), 0);

export async function saveWorkout(w) {
  const i = state.workouts.findIndex((x) => x.id === w.id);
  if (i >= 0) state.workouts[i] = w;
  else state.workouts.push(w);
  emit();
  await db.put("workouts", w);
}

export async function deleteWorkout(id) {
  state.workouts = state.workouts.filter((w) => w.id !== id);
  emit();
  await db.remove("workouts", id);
}
