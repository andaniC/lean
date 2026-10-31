// First-run onboarding: install hint, questions, plan generation, access code.
import { $, $$, wheel, range, ringMarkup, hydrateIcons, fitInput } from "./ui.js";
import { icons } from "./icons.js";
import { state, updateSettings, saveWeight } from "./store.js";
import { computePlan, goalDate, direction } from "./plan.js";
import { checkConnection } from "./ai.js";
import { esc, longDate, round1, uid, todayKey, sleep, isIOS, isStandalone, isMobile, haptic } from "./util.js";

const ORDER = ["welcome", "name", "goal", "glutes", "sex", "age", "body", "workouts", "target", "pace", "wants", "building", "plan", "code"];
const QUESTIONS = ["name", "goal", "glutes", "sex", "age", "body", "workouts", "target", "pace", "wants"];

let root;
let stage;
let current;
let trail = [];
let a; // answers
let finished;
let deferredInstall = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e;
});

export function codeFromUrl() {
  const m = location.hash.match(/code=([^&]+)/);
  if (!m) return "";
  history.replaceState(null, "", location.pathname + location.search);
  return decodeURIComponent(m[1]);
}

export function startOnboarding(onDone, { fromSettings = false } = {}) {
  finished = onDone;
  const s = state.settings;
  a = {
    ...structuredClone(s.profile),
    name: s.name,
    accessCode: s.accessCode || codeFromUrl(),
    codeOk: false,
    plan: null,
  };
  root?.remove();
  root = document.createElement("div");
  root.className = "ob";
  root.innerHTML = `
    <div class="ob-inner">
      <div class="ob-top"><button class="round-btn press" data-back aria-label="Back" data-icon="chevronLeft"></button>
        <div class="ob-progress"><i style="width:0%"></i></div></div>
      <div class="ob-stage" style="flex:1;display:flex;flex-direction:column;min-height:0"></div>
    </div>`;
  document.body.append(root);
  hydrateIcons(root);
  stage = $(".ob-stage", root);
  $("[data-back]", root).addEventListener("click", back);
  trail = [];
  go(fromSettings ? "name" : isMobile() && !isStandalone() ? "install" : "welcome");
}

function skip(step) {
  if (step === "glutes" && a.goal !== "glutes") return true;
  if ((step === "target" || step === "pace") && direction(a) === "maintain") return true;
  if (step === "code" && a.codeOk) return true;
  return false;
}

function nextOf(step) {
  if (step === "install") return "welcome";
  let i = ORDER.indexOf(step) + 1;
  while (i < ORDER.length && skip(ORDER[i])) i++;
  return ORDER[i];
}

function next() {
  const n = nextOf(current);
  if (!n) return finish();
  trail.push(current);
  go(n);
}

function back() {
  const prev = trail.pop();
  if (prev) go(prev, true);
}

function go(step, isBack = false) {
  current = step;
  const def = STEPS[step]();
  const top = $(".ob-top", root);
  const qs = QUESTIONS.filter((q) => !skip(q));
  const qi = qs.indexOf(step);
  top.style.visibility = qi >= 0 ? "visible" : "hidden";
  $(".ob-progress i", root).style.width = `${qi >= 0 ? ((qi + 1) / qs.length) * 100 : 0}%`;

  stage.innerHTML = `
    <div class="ob-step ${isBack ? "back" : ""}">
      ${def.title ? `<h1 class="ob-title">${def.title}</h1>` : ""}
      ${def.sub ? `<p class="ob-sub">${def.sub}</p>` : ""}
      <div class="ob-content ${def.top ? "top" : ""}">${def.body}</div>
      <div class="ob-foot">${def.foot ?? `<button class="btn" data-next>${def.cta ?? "Continue"}</button>`}</div>
    </div>`;
  hydrateIcons(stage);
  const el = $(".ob-step", stage);
  const cta = $("[data-next]", el);
  const refresh = () => {
    if (cta && def.valid) cta.disabled = !def.valid();
  };
  refresh();
  cta?.addEventListener("click", async () => {
    if (def.beforeNext && (await def.beforeNext(el)) === false) return;
    haptic(8);
    next();
  });
  // Single-choice option lists
  $$(".options[data-key]", el).forEach((list) => {
    const key = list.dataset.key;
    const multi = list.hasAttribute("data-multi");
    $$(".option", list).forEach((o) =>
      o.addEventListener("click", () => {
        haptic(6);
        if (multi) {
          const set = new Set(a[key]);
          set.has(o.dataset.v) ? set.delete(o.dataset.v) : set.add(o.dataset.v);
          a[key] = [...set];
          o.classList.toggle("selected", set.has(o.dataset.v));
        } else {
          a[key] = o.dataset.v;
          $$(".option", list).forEach((x) => x.classList.toggle("selected", x === o));
        }
        def.onPick?.(el);
        refresh();
      })
    );
  });
  def.mount?.(el, refresh);
}

const option = (key, value, label, emoji, sub = "") =>
  `<button class="option ${(Array.isArray(a[key]) ? a[key].includes(value) : a[key] === value) ? "selected" : ""}" data-v="${value}">
     ${emoji ? `<span class="emoji">${emoji}</span>` : ""}<span>${label}${sub ? `<small>${sub}</small>` : ""}</span></button>`;

const goalWord = () => (direction(a) === "gain" ? "gain" : "lose");
const gaining = () => direction(a) === "gain";

export const gluteTips = (protein) => `
  <div class="plan-box glute-box">
    <h3>🍑 Your glute plan</h3>
    <ul>
      <li>Eat <b>${protein} g of protein</b> every day, spread over your meals</li>
      <li>Train glutes 2–3 times a week: hip thrusts, Romanian deadlifts, squats and lunges</li>
      <li>Add a little weight or a few reps each week so they keep growing</li>
      <li>Sleep 7–9 hours; muscle is built while you recover</li>
    </ul>
  </div>`;

const STEPS = {
  install: () => {
    const ios = isIOS();
    const shareIcon = `<span class="share-glyph">${icons.share}</span>`;
    const steps = ios
      ? [`Tap the Share button ${shareIcon} in Safari`, `Scroll down and tap <b style="all:unset;font-weight:600">Add to Home Screen</b>`, "Open Lean from your Home Screen"]
      : ["Tap the ⋮ menu in your browser", `Tap <b style="all:unset;font-weight:600">Install app</b> or <b style="all:unset;font-weight:600">Add to Home screen</b>`, "Open Lean from your home screen"];
    return {
      body: `
        <div class="install">
          <img class="app-icon" src="icons/icon-192.png" alt="">
          <h1 class="ob-title" style="margin-top:22px">Install Lean</h1>
          <p class="ob-sub">Add Lean to your Home Screen so it opens full screen like a normal app and keeps your logs safe.</p>
          ${deferredInstall ? `<button class="btn" style="margin-top:26px" data-install>Install app</button>` : ""}
          <div class="install-steps">${steps.map((t, i) => `<div><b>${i + 1}</b><span>${t}</span></div>`).join("")}</div>
        </div>`,
      foot: `<button class="link-btn" data-next>Continue in the browser</button>`,
      mount(el) {
        $("[data-install]", el)?.addEventListener("click", async () => {
          deferredInstall.prompt();
          const choice = await deferredInstall.userChoice.catch(() => null);
          deferredInstall = null;
          if (choice?.outcome === "accepted") next();
        });
      },
    };
  },

  welcome: () => ({
    body: `
      <div class="welcome-art">
        <div class="float a"><span class="dot" style="background:var(--protein)"></span>76g protein left</div>
        <div class="card"><div><div class="cal-num">2125</div><div class="cal-label">Calories left</div></div>
          <div class="ring ring-lg">${ringMarkup(0.3, 10.4, `<span class="ic">${icons.flame}</span>`)}</div></div>
        <div class="float b"><span class="ic">${icons.flame}</span>240 calories</div>
      </div>`,
    foot: `
      <h1 class="ob-title" style="margin-top:0">Calorie tracking<br>made easy</h1>
      <p class="ob-sub" style="margin-bottom:26px">Snap a photo of your meal and Lean works out the calories for you.</p>
      <button class="btn" data-next>Get Started</button>`,
  }),

  name: () => ({
    title: "What's your name?",
    sub: "We'll use it to personalise your plan.",
    top: true,
    body: `<input class="input" style="height:60px;font-size:18px" data-name placeholder="Your first name" autocomplete="given-name" maxlength="30" value="${esc(a.name)}">`,
    valid: () => a.name.trim().length > 0,
    mount(el, refresh) {
      const input = $("[data-name]", el);
      input.addEventListener("input", () => {
        a.name = input.value;
        refresh();
      });
      input.addEventListener("keydown", (e) => e.key === "Enter" && a.name.trim() && $("[data-next]", el).click());
      setTimeout(() => input.focus(), 400);
    },
  }),

  goal: () => ({
    title: `What's your goal${a.name ? `, ${esc(a.name.trim())}` : ""}?`,
    sub: "This helps us build a plan for your calorie intake.",
    body: `<div class="options" data-key="goal">
      ${option("goal", "lose", "Lose weight", "🔥")}
      ${option("goal", "maintain", "Maintain", "⚖️")}
      ${option("goal", "gain", "Gain weight", "💪")}
      ${option("goal", "glutes", "Grow glutes", "🍑", "Build a stronger, rounder booty")}</div>`,
    valid: () => !!a.goal,
  }),

  glutes: () => ({
    title: "How do you want to grow them?",
    sub: "Glutes grow from training plus enough protein and food. Pick what suits you.",
    body: `<div class="options" data-key="glutes">
      ${option("glutes", "lean", "Stay lean while building", "✨", "Eat at maintenance with high protein")}
      ${option("glutes", "bulk", "Build faster", "📈", "Small calorie surplus, about 0.2 kg a week")}</div>`,
    valid: () => !!a.glutes,
  }),

  sex: () => ({
    title: "Choose your gender",
    sub: "This will be used to calibrate your custom plan.",
    body: `<div class="options" data-key="sex">
      ${option("sex", "female", "Female", "👩")}
      ${option("sex", "male", "Male", "👨")}
      ${option("sex", "other", "Other", "🙂")}</div>`,
    valid: () => !!a.sex,
  }),

  age: () => ({
    title: "How old are you?",
    sub: "Your metabolism changes with age, so this keeps your plan accurate.",
    body: `<div class="wheels"><div class="wheel-col" data-w="age"></div></div>`,
    mount(el) {
      wheel($("[data-w=age]", el), { values: range(13, 90), value: a.age, format: (v) => `${v} years`, onChange: (v) => (a.age = v) });
    },
  }),

  body: () => ({
    title: "Height & weight",
    sub: "This will be used to calibrate your custom plan.",
    body: `<div class="wheels">
      <div class="wheel-col"><b>Height</b><div data-w="h"></div></div>
      <div class="wheel-col"><b>Weight</b><div data-w="w"></div></div></div>`,
    mount(el) {
      wheel($("[data-w=h]", el), { values: range(120, 220), value: a.height, format: (v) => `${v} cm`, onChange: (v) => (a.height = v) });
      wheel($("[data-w=w]", el), {
        values: range(30, 250, 0.5),
        value: a.weight,
        format: (v) => `${v} kg`,
        onChange: (v) => {
          a.weight = v;
          // Keep the goal weight sensible as the current weight changes.
          if (direction(a) === "lose" && a.targetWeight >= v) a.targetWeight = Math.max(30, v - 5);
          if (gaining() && a.targetWeight <= v) a.targetWeight = v + (a.goal === "glutes" ? 3 : 5);
        },
      });
    },
  }),

  workouts: () => ({
    title: "How many workouts do you do per week?",
    sub: "This will be used to calibrate your custom plan.",
    body: `<div class="options" data-key="workouts">
      ${option("workouts", "0-2", "0–2", "🚶‍♀️", "Workouts now and then")}
      ${option("workouts", "3-5", "3–5", "🏃‍♀️", "A few workouts per week")}
      ${option("workouts", "6+", "6+", "🏋️‍♀️", "Dedicated athlete")}</div>`,
    valid: () => !!a.workouts,
  }),

  target: () => {
    if (direction(a) === "lose" && a.targetWeight >= a.weight) a.targetWeight = Math.max(30, a.weight - 5);
    if (gaining() && a.targetWeight <= a.weight) a.targetWeight = a.weight + (a.goal === "glutes" ? 3 : 5);
    return {
      title: "What is your desired weight?",
      sub: a.goal === "glutes" ? "Grow glutes" : gaining() ? "Gain weight" : "Lose weight",
      body: `
        <div class="big-readout"><span data-readout>${a.targetWeight}</span><small> kg</small></div>
        <div class="wheels" style="margin-top:14px"><div class="wheel-col" data-w="t"></div></div>
        <div class="pace-note" data-note></div>`,
      valid: () => (gaining() ? a.targetWeight > a.weight : a.targetWeight < a.weight),
      mount(el, refresh) {
        const note = () => {
          const diff = round1(Math.abs(a.weight - a.targetWeight));
          const ok = gaining() ? a.targetWeight > a.weight : a.targetWeight < a.weight;
          $("[data-note]", el).textContent = ok
            ? `${gaining() ? "Gaining" : "Losing"} ${diff} kg is a realistic target. You've got this!`
            : `Pick a weight ${gaining() ? "above" : "below"} your current ${a.weight} kg.`;
          $("[data-readout]", el).textContent = a.targetWeight;
        };
        note();
        wheel($("[data-w=t]", el), {
          values: range(30, 250, 0.5),
          value: a.targetWeight,
          format: (v) => `${v} kg`,
          onChange: (v) => {
            a.targetWeight = v;
            note();
            refresh();
          },
        });
      },
    };
  },

  pace: () => {
    const max = gaining() ? 0.5 : 1;
    const recommended = a.goal === "glutes" ? 0.2 : gaining() ? 0.3 : 0.5;
    if (a.pace > max || (a.goal === "glutes" && a.pace > 0.3)) a.pace = recommended;
    return {
      title: "How fast do you want to reach your goal?",
      sub: `${gaining() ? "Gain" : "Lose"} weight speed per week`,
      body: `
        <div class="big-readout"><span data-readout>${a.pace}</span><small> kg</small></div>
        <div class="pace-icons"><span>🐢</span><span>🐇</span><span>🐆</span></div>
        <input class="range" type="range" min="0.1" max="${max}" step="0.1" value="${a.pace}">
        <div class="pace-labels"><span>0.1 kg</span><span>${recommended} kg</span><span>${max} kg</span></div>
        <div class="pace-note" data-note></div>`,
      mount(el) {
        const input = $(".range", el);
        const paint = () => {
          a.pace = round1(Number(input.value));
          const t = (a.pace - 0.1) / (max - 0.1);
          input.style.setProperty("--fill", `${t * 100}%`);
          $("[data-readout]", el).textContent = a.pace;
          const icons3 = $$(".pace-icons span", el);
          const which = t < 0.34 ? 0 : t < 0.75 ? 1 : 2;
          icons3.forEach((s, i) => s.classList.toggle("on", i === which));
          const date = goalDate({ ...a });
          const when = date ? ` You'll reach ${a.targetWeight} kg around ${longDate(date)}.` : "";
          $("[data-note]", el).textContent =
            (which === 1 ? "Recommended pace." : which === 0 ? "Slow and steady, the easiest to stick with." : "Fast. You may feel tired, so eat enough protein.") + when;
        };
        paint();
        input.addEventListener("input", () => {
          paint();
          haptic(3);
        });
      },
    };
  },

  wants: () => ({
    title: "What would you like to accomplish?",
    sub: "Pick as many as you like.",
    body: `<div class="options" data-key="wants" data-multi>
      ${option("wants", "healthier", "Eat and live healthier", "🥗")}
      ${option("wants", "energy", "Boost my energy and mood", "⚡")}
      ${option("wants", "motivated", "Stay motivated and consistent", "🎯")}
      ${option("wants", "body", "Feel better about my body", "🧘‍♀️")}</div>`,
  }),

  building: () => ({
    body: `
      <div class="building">
        <div class="pct" data-pct>0%</div>
        <h2>We're setting everything<br>up for you</h2>
        <div class="bar"><i data-bar style="width:0%"></i></div>
        <div class="step-text" data-text>Estimating your metabolism…</div>
        <div class="checklist"><b>Daily recommendation for</b>
          ${["Calories", "Carbs", "Protein", "Fats", "Health score"].map((t) => `<div data-check><span class="ic">${icons.check}</span>${t}</div>`).join("")}
        </div>
      </div>`,
    foot: "",
    async mount(el) {
      $(".ob-top", root).style.visibility = "hidden";
      a.plan = computePlan(a);
      const texts = ["Estimating your metabolism…", `Applying your goal to ${goalWord()} weight…`, "Balancing your macros…", "Finalising your plan…"];
      const checks = $$("[data-check]", el);
      const t0 = performance.now();
      const dur = 3400;
      await new Promise((resolve) => {
        const frame = (t) => {
          if (current !== "building") return resolve();
          const k = Math.min(1, (t - t0) / dur);
          const eased = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          const pct = Math.round(eased * 100);
          $("[data-pct]", el).textContent = `${pct}%`;
          $("[data-bar]", el).style.width = `${pct}%`;
          $("[data-text]", el).textContent = texts[Math.min(texts.length - 1, Math.floor(eased * texts.length))];
          checks.forEach((c, i) => c.classList.toggle("done", eased >= (i + 1) / (checks.length + 0.5)));
          if (k < 1) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
      if (current !== "building") return;
      checks.forEach((c) => c.classList.add("done"));
      haptic(25);
      await sleep(450);
      if (current === "building") {
        current = "plan-from-building";
        trail = trail.filter((s) => s !== "building");
        go("plan");
      }
    },
  }),

  plan: () => {
    a.plan ??= computePlan(a);
    const date = goalDate(a);
    const diff = round1(Math.abs(a.weight - a.targetWeight));
    const headline =
      a.goal === "glutes" && direction(a) === "maintain"
        ? `<p class="ready-sub">Build your glutes at:</p><div class="ready-pill">${a.weight} kg, staying lean</div>`
        : direction(a) === "maintain"
        ? `<p class="ready-sub">You should maintain:</p><div class="ready-pill">${a.weight} kg</div>`
        : `<p class="ready-sub">You should ${goalWord()}:</p><div class="ready-pill">${diff} kg by ${longDate(date)}</div>`;
    const item = (key, label, color, unit, pct) => `
      <label class="plan-item">
        <span><span class="ic" style="color:${color}">${key === "calories" ? icons.flame : `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>`}</span>${label}</span>
        <div class="ring" style="--c:${color}">${ringMarkup(pct, 9, `<b><input type="number" inputmode="numeric" data-plan="${key}" value="${a.plan[key]}" style="width:${String(a.plan[key]).length}ch">${unit}</b>`)}</div>
        <span class="ic edit">${icons.pencil}</span>
      </label>`;
    return {
      top: true,
      body: `
        <div class="ready-badge">${icons.check}</div>
        <h1 class="ready-title">Congratulations${a.name ? `, ${esc(a.name.trim())}` : ""}!<br>Your custom plan is ready</h1>
        ${headline}
        <div class="plan-box">
          <h3>Daily recommendation</h3>
          <p>You can edit this any time</p>
          <div class="plan-grid">
            ${item("calories", "Calories", "var(--flame)", "", 0.72)}
            ${item("carbs", "Carbs", "var(--carbs)", "g", 0.6)}
            ${item("protein", "Protein", "var(--protein)", "g", 0.55)}
            ${item("fat", "Fats", "var(--fat)", "g", 0.45)}
          </div>
        </div>
        ${a.goal === "glutes" ? gluteTips(a.plan.protein) : ""}`,
      cta: "Let's get started!",
      mount(el) {
        $(".ob-top", root).style.visibility = "hidden";
        const fit = fitInput;
        const inputs = $$("[data-plan]", el);
        inputs.forEach((i) => {
          fit(i);
          i.addEventListener("input", () => fit(i));
        });
        document.fonts?.ready.then(() => inputs.forEach(fit));
        $$("[data-plan]", el).forEach((i) =>
          i.addEventListener("change", () => {
            const v = Math.max(0, Math.round(Number(i.value) || 0));
            i.value = v;
            fit(i);
            a.plan[i.dataset.plan] = v;
          })
        );
      },
      async beforeNext() {
        const profile = {
          goal: a.goal,
          sex: a.sex,
          age: a.age,
          height: a.height,
          weight: a.weight,
          targetWeight: direction(a) === "maintain" ? a.weight : a.targetWeight,
          glutes: a.glutes,
          pace: a.pace,
          workouts: a.workouts,
          wants: a.wants,
          startWeight: a.weight,
          startDate: todayKey(),
        };
        updateSettings({
          name: a.name.trim(),
          profile,
          goals: { calories: a.plan.calories, protein: a.plan.protein, carbs: a.plan.carbs, fat: a.plan.fat, water: a.plan.water },
        });
        await saveWeight({ id: uid(), date: todayKey(), time: Date.now(), kg: a.weight });
        // If we already have a working code (from a link or an earlier setup), skip that step.
        if (a.accessCode) {
          try {
            await checkConnection(a.accessCode);
            a.codeOk = true;
          } catch {}
        }
      },
    };
  },

  code: () => ({
    title: "Connect food scanning",
    sub: "Enter the access code you were given. It keeps your AI food scanner private.",
    top: true,
    body: `
      <input class="input" style="height:60px;font-size:18px" data-code placeholder="lean-…" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(a.accessCode)}">
      <p class="status" data-status></p>`,
    foot: `<button class="btn" data-connect>Connect</button><button class="link-btn" data-skip>Skip for now</button>`,
    mount(el) {
      $(".ob-top", root).style.visibility = "visible";
      $(".ob-progress", root).style.visibility = "hidden";
      const input = $("[data-code]", el);
      const status = $("[data-status]", el);
      const btn = $("[data-connect]", el);
      const sync = () => (btn.disabled = !input.value.trim());
      sync();
      input.addEventListener("input", sync);
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner"></span>`;
        status.className = "status";
        status.textContent = "";
        try {
          await checkConnection(input.value.trim());
          a.accessCode = input.value.trim();
          a.codeOk = true;
          status.className = "status good";
          status.textContent = "Connected!";
          haptic(25);
          await sleep(500);
          finish();
        } catch (err) {
          status.className = "status bad";
          status.textContent = err.message;
          btn.textContent = "Connect";
          sync();
        }
      });
      $("[data-skip]", el).addEventListener("click", () => finish());
    },
  }),
};

function finish() {
  updateSettings({ onboarded: true, accessCode: a.codeOk ? a.accessCode : state.settings.accessCode || a.accessCode });
  $(".ob-progress", root).style.visibility = "";
  root.style.transition = "opacity .35s ease, transform .45s cubic-bezier(.32,.72,0,1)";
  root.style.opacity = "0";
  root.style.transform = "scale(1.02)";
  const el = root;
  setTimeout(() => el.remove(), 450);
  root = null;
  finished?.();
}
