// Confetti when she reaches a goal: daily calories, protein and water (once a day each), her goal weight, a finished workout.
import { state, onChange, totalsFor, waterFor, burnedFor, currentWeight } from "./store.js";
import { direction } from "./plan.js";
import { toast } from "./ui.js";
import { todayKey, haptic } from "./util.js";
import { STORAGE } from "./config.js";

const KEY = `${STORAGE}.celebrated.v1`;
const PALETTE = ["#ff7a1a", "#2f9a63", "#f4a226", "#f0644f", "#3b8cff", "#6d5df6", "#e2558f", "#ffd23f"];
const COLORS = {
  calories: ["#ff7a1a", "#ff9a4d", "#ffd23f", "#f0644f"],
  protein: ["#2f9a63", "#4cd68a", "#a6e9c3", "#ffd23f"],
  water: ["#3b8cff", "#7ab4ff", "#bfe0ff", "#6d5df6"],
};

/** Two party poppers fire from the bottom corners, then the pieces flutter down. */
export function confetti({ colors = PALETTE, count = 160 } = {}) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.createElement("canvas");
  canvas.className = "confetti";
  document.body.append(canvas);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = innerWidth;
  const h = innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const rand = (a, b) => a + Math.random() * (b - a);
  const reach = h / 844; // same arc on small and tall phones
  const bits = Array.from({ length: count }, (_, i) => {
    const left = i % 2 === 0;
    const angle = ((left ? rand(-82, -52) : rand(-128, -98)) * Math.PI) / 180;
    const speed = rand(30, 46) * reach; // rises 45–80% of the screen
    return {
      x: left ? rand(-10, 20) : w - rand(-10, 20),
      y: h + rand(0, 20),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: colors[i % colors.length],
      round: Math.random() < 0.22,
      bw: rand(6, 10),
      bh: rand(10, 16),
      rot: rand(0, Math.PI * 2),
      spin: rand(-0.22, 0.22),
      flip: rand(0, Math.PI * 2),
      flipSpeed: rand(0.08, 0.3),
      sway: rand(0, Math.PI * 2),
    };
  });

  const LIFE = 5000;
  const start = performance.now();
  let last = start;
  const frame = (now) => {
    const f = Math.min((now - last) / 16.67, 3);
    last = now;
    const age = now - start;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = age > LIFE - 900 ? Math.max(0, (LIFE - age) / 900) : 1;
    let alive = 0;
    for (const b of bits) {
      b.vx *= 0.96 ** f;
      b.vy = Math.min(b.vy * 0.96 ** f + 0.32 * f, 3); // drag, gravity, then a slow flutter down
      b.sway += 0.08 * f;
      b.x += (b.vx + Math.sin(b.sway) * 0.9) * f;
      b.y += b.vy * f;
      b.rot += b.spin * f;
      b.flip += b.flipSpeed * f;
      if (b.y > h + 30) continue;
      alive++;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.scale(1, Math.cos(b.flip)); // tumbling paper
      ctx.fillStyle = b.color;
      if (b.round) {
        ctx.beginPath();
        ctx.arc(0, 0, b.bw / 2, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(-b.bw / 2, -b.bh / 2, b.bw, b.bh);
      ctx.restore();
    }
    if (alive && age < LIFE) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ goals

function readLog() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? {};
  } catch {
    return {};
  }
}

function writeLog(log) {
  try {
    localStorage.setItem(KEY, JSON.stringify(log));
  } catch {}
}

/** Which goals are reached right now, today. */
function reached() {
  const day = todayKey();
  const { goals, profile, addBurned } = state.settings;
  const t = totalsFor(day);
  const dir = direction(profile);
  const out = new Set();
  // Calories count as hit inside the target zone; when building, a little over is still on plan.
  const budget = goals.calories + (addBurned ? burnedFor(day) : 0);
  if (budget > 0 && t.calories >= budget * 0.95 && t.calories <= budget * (dir === "gain" ? 1.15 : 1.05)) out.add("calories");
  if (goals.protein > 0 && t.protein >= goals.protein) out.add("protein");
  if (goals.water > 0 && waterFor(day) >= goals.water) out.add("water");
  const kg = currentWeight();
  if ((dir === "lose" && kg <= profile.targetWeight) || (dir === "gain" && kg >= profile.targetWeight)) out.add("weight");
  return out;
}

function message(keys) {
  const p = state.settings.profile;
  if (keys.includes("weight")) return `🏆 You reached your goal weight of ${p.targetWeight} kg!`;
  if (keys.length > 1) {
    const names = keys.map((k) => ({ calories: "calorie", protein: "protein", water: "water" })[k]);
    const list = `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
    return `🎉 ${list[0].toUpperCase()}${list.slice(1)} goals hit!`;
  }
  return {
    calories: "🎯 Calorie target hit for today!",
    protein: p.goal === "glutes" ? "💪 Protein goal hit! Your glutes say thanks" : "💪 Protein goal hit!",
    water: "💧 Water goal reached. Nice!",
  }[keys[0]];
}

/**
 * Celebrates the moment a goal is crossed, never on opening the app, changing targets or a new day.
 * Call after the saved data has loaded so that state is the starting point.
 */
export function watchGoals() {
  const signature = () => JSON.stringify([todayKey(), state.settings.goals, state.settings.addBurned, state.settings.profile.targetWeight, direction(state.settings.profile)]);
  let sig = signature();
  let before = reached();
  onChange(() => {
    if (!state.settings.onboarded) return;
    const now = reached();
    const changed = signature() !== sig;
    sig = signature();
    const prev = before;
    before = now;
    if (changed) return;

    const day = todayKey();
    const log = readLog();
    const done = log.day === day ? log.done ?? [] : [];
    const fresh = [...now].filter((k) => !prev.has(k) && (k === "weight" ? log.weight !== state.settings.profile.targetWeight : !done.includes(k)));
    if (!fresh.length) return;

    writeLog({
      day,
      done: [...new Set([...done, ...fresh.filter((k) => k !== "weight")])],
      weight: fresh.includes("weight") ? state.settings.profile.targetWeight : log.weight,
    });
    const big = fresh.includes("weight");
    confetti({ colors: fresh.length === 1 && COLORS[fresh[0]] ? COLORS[fresh[0]] : PALETTE, count: big ? 260 : 160 });
    haptic(big ? 60 : 30);
    toast(message(fresh), big ? 4200 : 3200);
  });
}
