// Progress tab: weight, streak, weight trend, weekly calories, BMI.
import { $, hydrateIcons } from "./ui.js";
import { icons } from "./icons.js";
import { state, streak, loggedDays, currentWeight, totalsFor } from "./store.js";
import { bmi, bmiLabel, goalDate, direction } from "./plan.js";
import { esc, round, round1, clamp, keyOf, addDays, mondayOf, dateOf, todayKey, longDate } from "./util.js";

export function renderProgress(el, { onLogWeight }) {
  const s = state.settings;
  const p = s.profile;
  const weight = round1(currentWeight());
  const start = p.startWeight ?? weight;
  const target = p.targetWeight;
  let pct = 1;
  const dir = direction(p);
  if (dir === "lose" && start > target) pct = clamp((start - weight) / (start - target), 0, 1);
  if (dir === "gain" && target > start) pct = clamp((weight - start) / (target - start), 0, 1);
  const st = streak();
  const b = round1(bmi(weight, p.height));

  el.innerHTML = `
    <div class="p-grid">
      <div class="p-card">
        <div class="p-label">My weight</div>
        <div class="p-big">${weight}<small> kg</small></div>
        <div class="p-sub">${dir === "maintain" ? (p.goal === "glutes" ? "Goal: grow glutes" : "Goal: maintain") : `Goal ${target} kg`}</div>
        <div class="bar"><i style="width:${Math.round(pct * 100)}%;background:var(--protein)"></i></div>
        <button class="btn press" data-log-weight>Log weight</button>
      </div>
      <div class="p-card streak-card">
        <div class="p-label">Day streak</div>
        <div class="streak-big"><span class="ic">${icons.flame}</span><span class="p-big">${st}</span></div>
        <div class="p-sub">${loggedDays()} day${loggedDays() === 1 ? "" : "s"} logged in total</div>
        ${weekDots()}
      </div>
    </div>

    ${p.goal === "glutes" ? gluteCard(s.goals.protein) : ""}

    <div class="p-card p-wide">
      <div class="p-head"><h3>Weight progress</h3><span>${progressNote(p, weight, pct)}</span></div>
      ${weightChart(p)}
    </div>

    <div class="p-card p-wide">
      <div class="p-head"><h3>This week's calories</h3><span>${weekAverage()}</span></div>
      ${calorieChart(s.goals.calories)}
    </div>

    <div class="p-card p-wide">
      <div class="p-head"><h3>Your BMI</h3><span>Height ${p.height} cm</span></div>
      <div class="p-big" style="margin-top:10px">${b}<span class="tag">${bmiLabel(b)}</span></div>
      <div class="bmi-bar"><i style="left:${clamp(((b - 15) / 25) * 100, 2, 98)}%"></i></div>
      <div class="bmi-legend"><span>Underweight</span><span>Healthy</span><span>Overweight</span><span>Obese</span></div>
    </div>`;
  hydrateIcons(el);
  $("[data-log-weight]", el).addEventListener("click", onLogWeight);
}

function progressNote(p, weight, pct) {
  if (direction(p) === "maintain") return p.goal === "glutes" ? `Building at ${weight} kg` : `Holding at ${weight} kg`;
  const date = goalDate({ ...p, weight });
  return pct >= 1 ? "Goal reached!" : `${Math.round(pct * 100)}% of goal${date ? ` · ETA ${date.toLocaleDateString([], { month: "short", year: "numeric" })}` : ""}`;
}

function weekDots() {
  const monday = mondayOf(new Date());
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  return `<div style="display:flex;justify-content:space-between;margin-top:14px">${days
    .map((d, i) => {
      const k = keyOf(addDays(monday, i));
      const done = totalsFor(k).count > 0;
      return `<div style="text-align:center;font-size:11px;font-weight:600;color:var(--muted)">${d}
        <div style="width:16px;height:16px;margin-top:4px;border-radius:50%;background:${done ? "#ff8a1f" : "var(--track)"}"></div></div>`;
    })
    .join("")}</div>`;
}

function weightChart(p) {
  const pts = state.weights.map((w) => ({ t: dateOf(w.date).getTime(), kg: w.kg }));
  if (new Set(state.weights.map((w) => w.date)).size < 2) {
    return `<div class="note" style="padding:28px 6px 12px">Log your weight a few times to see your trend here.</div>`;
  }
  const W = 320;
  const H = 150;
  const padL = 30;
  const padR = 8;
  const padT = 10;
  const padB = 22;
  const kgs = pts.map((x) => x.kg);
  const moving = direction(p) !== "maintain";
  if (moving) kgs.push(p.targetWeight);
  let lo = Math.floor(Math.min(...kgs) - 1);
  let hi = Math.ceil(Math.max(...kgs) + 1);
  const t0 = pts[0].t;
  const t1 = Math.max(pts[pts.length - 1].t, t0 + 86400000);
  const x = (t) => padL + ((t - t0) / (t1 - t0)) * (W - padL - padR);
  const y = (kg) => padT + (1 - (kg - lo) / (hi - lo)) * (H - padT - padB);
  const path = pts.map((q, i) => `${i ? "L" : "M"}${x(q.t).toFixed(1)},${y(q.kg).toFixed(1)}`).join(" ");
  const area = `${path} L${x(pts[pts.length - 1].t).toFixed(1)},${H - padB} L${x(t0).toFixed(1)},${H - padB} Z`;
  const ticks = [lo, (lo + hi) / 2, hi];
  const fmt = (t) => new Date(t).toLocaleDateString([], { day: "numeric", month: "short" });
  const goalLine =
    moving
      ? `<line x1="${padL}" x2="${W - padR}" y1="${y(p.targetWeight)}" y2="${y(p.targetWeight)}" stroke="#3bb56b" stroke-width="1.5" stroke-dasharray="4 4"/>
         <text x="${W - padR}" y="${y(p.targetWeight) - 5}" text-anchor="end" style="fill:#3bb56b">Goal ${p.targetWeight}</text>`
      : "";
  const last = pts[pts.length - 1];
  return `
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight over time">
      <defs><linearGradient id="wfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2f9a63" stop-opacity=".22"/><stop offset="1" stop-color="#2f9a63" stop-opacity="0"/></linearGradient></defs>
      ${ticks.map((v) => `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--line)"/><text x="${padL - 6}" y="${y(v) + 3}" text-anchor="end">${round(v)}</text>`).join("")}
      ${goalLine}
      <path d="${area}" fill="url(#wfill)"/>
      <path d="${path}" fill="none" stroke="#2f9a63" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${x(last.t)}" cy="${y(last.kg)}" r="4.5" fill="#2f9a63" style="stroke:var(--card)" stroke-width="2"/>
      <text x="${padL}" y="${H - 4}">${fmt(t0)}</text>
      <text x="${W - padR}" y="${H - 4}" text-anchor="end">${fmt(last.t)}</text>
    </svg>`;
}

function weekDays() {
  const monday = mondayOf(new Date());
  return Array.from({ length: 7 }, (_, i) => keyOf(addDays(monday, i)));
}

function weekAverage() {
  const today = todayKey();
  const days = weekDays().filter((k) => k <= today && totalsFor(k).count > 0);
  if (!days.length) return "No logs yet";
  const avg = days.reduce((s, k) => s + totalsFor(k).calories, 0) / days.length;
  return `Avg ${round(avg)} cal/day`;
}

function calorieChart(goal) {
  const W = 320;
  const H = 160;
  const padT = 14;
  const padB = 22;
  const keys = weekDays();
  const today = todayKey();
  const vals = keys.map((k) => totalsFor(k).calories);
  const max = Math.max(goal * 1.25, ...vals, 1);
  const y = (v) => padT + (1 - v / max) * (H - padT - padB);
  const slot = W / 7;
  const bw = 24;
  const labels = ["M", "T", "W", "T", "F", "S", "S"];
  return `
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Calories per day this week">
      <line x1="0" x2="${W}" y1="${y(goal)}" y2="${y(goal)}" style="stroke:var(--faint)" stroke-width="1.5" stroke-dasharray="4 4"/>
      <text x="${W}" y="${y(goal) - 5}" text-anchor="end">Goal ${goal}</text>
      ${keys
        .map((k, i) => {
          const v = vals[i];
          const cx = slot * i + slot / 2;
          const h = Math.max(0, H - padB - y(v));
          const fill = v > goal ? "#ef6c63" : "#ff7a1a";
          const bar = v > 0 ? `<rect x="${cx - bw / 2}" y="${y(v)}" width="${bw}" height="${h}" rx="7" fill="${fill}"/>` : `<rect x="${cx - bw / 2}" y="${H - padB - 4}" width="${bw}" height="4" rx="2" style="fill:var(--track)"/>`;
          return `${bar}<text x="${cx}" y="${H - 5}" text-anchor="middle" style="${k === today ? "fill:var(--ink);font-weight:700" : ""}">${labels[i]}</text>`;
        })
        .join("")}
    </svg>`;
}

function gluteCard(proteinGoal) {
  const eaten = round(totalsFor(todayKey()).protein);
  const pct = proteinGoal ? clamp(eaten / proteinGoal, 0, 1) : 0;
  const left = Math.max(0, proteinGoal - eaten);
  return `
    <div class="p-card p-wide glute-box">
      <div class="p-head"><h3>🍑 Glute plan</h3><span>${left ? `${left} g protein to go today` : "Protein goal hit today!"}</span></div>
      <div class="p-big" style="margin-top:10px">${eaten}<small> / ${proteinGoal} g protein</small></div>
      <div class="bar"><i style="width:${Math.round(pct * 100)}%;background:var(--protein)"></i></div>
      <ul>
        <li>Train glutes 2–3 times a week: bridges, sofa hip thrusts, squats, lunges</li>
        <li>Add a few reps, a pause or a stronger band each week</li>
        <li>Sleep 7–9 hours to recover and grow</li>
      </ul>
    </div>`;
}
