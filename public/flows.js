// Bottom sheets: + menu, food database, amounts, describe, manual, food detail, weight, settings.
import { $, $$, openSheet, confirmSheet, toast, wheel, range, hydrateIcons, fitInput } from "./ui.js";
import { icons } from "./icons.js";
import { searchFoods, checkConnection } from "./ai.js";
import {
  state,
  saveEntry,
  deleteEntry,
  saveWeight,
  updateSettings,
  replaceAll,
  emit,
  entryTotals,
  currentWeight,
} from "./store.js";
import { openCamera, newEntry, runAnalysis, startTextAnalysis, photoBase64 } from "./capture.js";
import { computePlan, direction } from "./plan.js";
import { setTheme } from "./theme.js";
import { esc, round, round1, num, uid, todayKey, timeLabel, clamp, haptic, pad, dateOf, mealFor, MEALS, MEAL_LABEL } from "./util.js";

const closeBtn = `<button class="round-btn press" data-close aria-label="Close" data-icon="close"></button>`;

function goHome() {
  if (state.tab !== "home") {
    state.tab = "home";
    emit();
  }
}

// ------------------------------------------------------------------ + menu

const tile = (act, iconName, bg, color, title, sub) => `
  <button class="tile press" data-act="${act}">
    <span class="tile-ic" style="background:${bg};color:${color}"><span class="ic">${icons[iconName]}</span></span>
    <div><b>${title}</b><span>${sub}</span></div></button>`;

export function openPlusMenu() {
  openSheet({
    html: `
      <div class="sheet-head"><h2 class="sheet-title">Log food</h2>${closeBtn}</div>
      <div class="tiles">
        ${tile("scan", "camera", "var(--flame-bg)", "var(--flame)", "Scan food", "Snap a photo and AI counts it")}
        ${tile("search", "search", "var(--dinner-bg)", "var(--dinner)", "Food database", "Search foods by name")}
        ${tile("describe", "sparkle", "var(--snack-bg)", "var(--snack)", "Describe meal", "Type what you ate")}
        ${tile("manual", "pencil", "var(--carbs-bg)", "var(--carbs-ink)", "Manual entry", "Enter exact numbers")}
        ${tile("water", "drop", "var(--water-bg)", "var(--water)", "Log water", "Add a glass of water")}
        ${tile("weight", "scale", "var(--protein-bg)", "var(--protein)", "Log weight", "Track your progress")}
      </div>`,
    onMount(sheet, close) {
      $$("[data-act]", sheet).forEach((b) =>
        b.addEventListener("click", () => {
          close();
          const act = b.dataset.act;
          setTimeout(() => {
            if (act === "scan") openCamera("scan");
            if (act === "search") openFoodDatabase();
            if (act === "describe") openDescribe();
            if (act === "manual") openManual();
            if (act === "water") document.dispatchEvent(new CustomEvent("lean:water"));
            if (act === "weight") openWeightSheet();
          }, 180);
        })
      );
    },
  });
}

// ------------------------------------------------------------------ food database (USDA)

function rank(foods, query) {
  const q = query.toLowerCase().trim();
  const score = (f) => {
    const n = f.name.toLowerCase();
    const match = n.startsWith(q) ? 0 : n.includes(q) ? 1 : 2;
    return match * 1000 + (f.brand ? 300 : 0) + n.length;
  };
  return [...foods].sort((a, b) => score(a) - score(b));
}

const servingText = (f) => (f.serving ? f.serving.label : "100 g");
const servingKcal = (f) => round((f.per100.calories * (f.serving?.grams ?? 100)) / 100);

export function openFoodDatabase(prefill = "") {
  openSheet({
    tall: true,
    html: `
      <div class="sheet-head"><h2 class="sheet-title">Food database</h2>${closeBtn}</div>
      <div class="search-box"><span data-icon="search"></span>
        <input class="input" type="search" placeholder="Search foods, e.g. banana" enterkeyhint="search" autocomplete="off" value="${esc(prefill)}"></div>
      <div class="results"><div class="note">Search thousands of foods by name.</div></div>`,
    onMount(sheet, close) {
      const input = $("input", sheet);
      const results = $(".results", sheet);
      let timer = 0;
      let seq = 0;
      const describeLink = (q) =>
        `<button class="link-btn" data-describe>Can't find it? Describe it to AI instead</button>`;

      async function run() {
        const q = input.value.trim();
        const my = ++seq;
        if (q.length < 2) {
          results.innerHTML = `<div class="note">Search thousands of foods by name.</div>`;
          return;
        }
        if (!state.settings.accessCode) {
          results.innerHTML = `<div class="note">Enter your access code in Settings to search the food database.</div>`;
          return;
        }
        results.innerHTML = `<div class="note"><span class="spinner dark" style="display:inline-block"></span></div>`;
        try {
          const foods = rank(await searchFoods(state.settings.accessCode, q), q);
          if (my !== seq) return;
          if (!foods.length) {
            results.innerHTML = `<div class="note">No matches for “${esc(q)}”.</div>${describeLink(q)}`;
          } else {
            results.innerHTML =
              foods
                .map(
                  (f, i) => `
              <button class="result press" data-i="${i}">
                <div class="result-main">
                  <div class="result-name">${esc(f.name)}</div>
                  <div class="result-sub"><span class="ic">${icons.flame}</span>${servingKcal(f)} cal · ${esc(servingText(f))}${f.brand ? ` · ${esc(f.brand)}` : ""}</div>
                </div>
                <span class="add"><span class="ic">${icons.plus}</span></span>
              </button>`
                )
                .join("") + describeLink(q);
            $$(".result", results).forEach((b) =>
              b.addEventListener("click", () => openAmountSheet(foods[Number(b.dataset.i)], { source: "database", onLogged: close }))
            );
          }
          $("[data-describe]", results)?.addEventListener("click", () => {
            close();
            setTimeout(() => openDescribe(q), 180);
          });
        } catch (err) {
          if (my === seq) results.innerHTML = `<div class="note">${esc(err.message)}</div>`;
        }
      }
      input.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(run, 380);
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          clearTimeout(timer);
          run();
          input.blur();
        }
      });
      setTimeout(() => input.focus(), 350);
      if (prefill) run();
    },
  });
}

// ------------------------------------------------------------------ amount picker (database + barcode)

export function openAmountSheet(food, { photo = null, source = "database", barcode = "", onLogged } = {}) {
  const defaultGrams = food.serving?.grams ?? 100;
  const chips = [];
  if (food.serving) chips.push({ g: food.serving.grams, label: `1 serving (${round1(food.serving.grams)} g)` });
  for (const g of [50, 100, 150, 200]) if (!chips.some((c) => c.g === g)) chips.push({ g, label: `${g} g` });

  openSheet({
    html: `
      <div class="sheet-head">
        <div style="min-width:0">
          <h2 class="sheet-title">${esc(food.name)}</h2>
          ${food.brand ? `<div class="p-sub">${esc(food.brand)}</div>` : ""}
        </div>${closeBtn}
      </div>
      <div class="big-stat" style="margin-top:4px">
        <div class="ic-box" data-icon="flame"></div>
        <label><span>Calories</span><div class="num-input" data-out="calories">0</div></label>
      </div>
      <div class="mini-stats">
        <div class="mini-stat" style="--dot:var(--protein)"><span>Protein</span><div class="num-wrap"><b class="num-input" data-out="protein">0</b><em>g</em></div></div>
        <div class="mini-stat" style="--dot:var(--carbs)"><span>Carbs</span><div class="num-wrap"><b class="num-input" data-out="carbs">0</b><em>g</em></div></div>
        <div class="mini-stat" style="--dot:var(--fat)"><span>Fat</span><div class="num-wrap"><b class="num-input" data-out="fat">0</b><em>g</em></div></div>
      </div>
      <label class="field"><span>Amount (grams)</span>
        <input class="input" type="number" inputmode="decimal" min="1" value="${round1(defaultGrams)}" data-grams></label>
      <div class="chips">${chips.map((c) => `<button class="chip" data-g="${c.g}">${esc(c.label)}</button>`).join("")}</div>
      <button class="btn" style="margin-top:22px" data-log>Log food</button>`,
    onMount(sheet, close) {
      const gramsInput = $("[data-grams]", sheet);
      const calc = () => {
        const g = Math.max(0, num(gramsInput.value));
        const k = g / 100;
        const out = {
          calories: round(food.per100.calories * k),
          protein: round(food.per100.protein * k),
          carbs: round(food.per100.carbs * k),
          fat: round(food.per100.fat * k),
        };
        for (const [key, v] of Object.entries(out)) $(`[data-out="${key}"]`, sheet).textContent = v;
        $$(".chip", sheet).forEach((c) => c.classList.toggle("active", Number(c.dataset.g) === g));
        $("[data-log]", sheet).disabled = g <= 0;
        return { g, ...out };
      };
      calc();
      gramsInput.addEventListener("input", calc);
      $$(".chip", sheet).forEach((c) =>
        c.addEventListener("click", () => {
          gramsInput.value = c.dataset.g;
          calc();
        })
      );
      $("[data-log]", sheet).addEventListener("click", async () => {
        const v = calc();
        const entry = newEntry({
          name: food.name,
          brand: food.brand || "",
          calories: v.calories,
          protein: v.protein,
          carbs: v.carbs,
          fat: v.fat,
          items: [{ name: food.name, amount: `${round1(v.g)} g`, calories: v.calories }],
          photo,
          source,
          barcode,
          status: "done",
        });
        close();
        onLogged?.();
        goHome();
        await saveEntry(entry);
        haptic(20);
        toast(`Logged ${food.name}`);
      });
    },
  });
}

// ------------------------------------------------------------------ describe (AI from text)

export function openDescribe(prefill = "") {
  openSheet({
    html: `
      <div class="sheet-head"><h2 class="sheet-title">Describe meal</h2>${closeBtn}</div>
      <textarea class="textarea" placeholder="e.g. 2 slices of pepperoni pizza and a can of Coke" maxlength="600">${esc(prefill)}</textarea>
      <p class="status">Mention amounts (“a big plate”, “2 cups”) for the most accurate estimate.</p>
      <button class="btn" style="margin-top:18px" data-go><span data-icon="sparkle"></span>Estimate with AI</button>`,
    onMount(sheet, close) {
      const ta = $("textarea", sheet);
      const go = $("[data-go]", sheet);
      const sync = () => (go.disabled = ta.value.trim().length < 2);
      sync();
      ta.addEventListener("input", sync);
      setTimeout(() => ta.focus(), 350);
      go.addEventListener("click", () => {
        if (!state.settings.accessCode) {
          toast("Enter your access code in Settings first.");
          return;
        }
        const text = ta.value.trim();
        close();
        startTextAnalysis(text);
      });
    },
  });
}

// ------------------------------------------------------------------ manual entry

export function openManual() {
  openSheet({
    html: `
      <div class="sheet-head"><h2 class="sheet-title">Manual entry</h2>${closeBtn}</div>
      <label class="field" style="margin-top:0"><span>Food name</span><input class="input" data-k="name" placeholder="e.g. Greek yoghurt" autocomplete="off"></label>
      <label class="field"><span>Calories</span><input class="input" data-k="calories" type="number" inputmode="numeric" placeholder="0"></label>
      <div class="grid-2" style="grid-template-columns:1fr 1fr 1fr">
        <label class="field"><span>Protein (g)</span><input class="input" data-k="protein" type="number" inputmode="decimal" placeholder="0"></label>
        <label class="field"><span>Carbs (g)</span><input class="input" data-k="carbs" type="number" inputmode="decimal" placeholder="0"></label>
        <label class="field"><span>Fat (g)</span><input class="input" data-k="fat" type="number" inputmode="decimal" placeholder="0"></label>
      </div>
      <button class="btn" style="margin-top:22px" data-add disabled>Add food</button>`,
    onMount(sheet, close) {
      const val = (k) => $(`[data-k="${k}"]`, sheet).value;
      const add = $("[data-add]", sheet);
      const sync = () => (add.disabled = !val("name").trim() || num(val("calories"), -1) < 0);
      $$("input", sheet).forEach((i) => i.addEventListener("input", sync));
      setTimeout(() => $('[data-k="name"]', sheet).focus(), 350);
      add.addEventListener("click", async () => {
        const entry = newEntry({
          name: val("name").trim(),
          calories: round(num(val("calories"))),
          protein: round(num(val("protein"))),
          carbs: round(num(val("carbs"))),
          fat: round(num(val("fat"))),
          source: "manual",
          status: "done",
        });
        close();
        goHome();
        await saveEntry(entry);
        toast(`Logged ${entry.name}`);
      });
    },
  });
}

// ------------------------------------------------------------------ food detail

export function openEntry(entry) {
  const draft = { ...entry, servings: entry.servings || 1, meal: entry.meal || mealFor(entry.time) };
  const t0 = new Date(entry.time);
  const base = { calories: entry.calories, protein: entry.protein, carbs: entry.carbs, fat: entry.fat };
  const photo = entry.photo
    ? `<div class="detail-photo"><img src="${entry.photo}" alt="">
         <button class="round-btn close-l" data-close aria-label="Close" data-icon="close"></button>
         <button class="round-btn trash-r" data-del aria-label="Delete" data-icon="trash"></button></div>`
    : `<div class="sheet-head"><span></span>${closeBtn}</div>`;
  const items = (entry.items || []).filter((i) => i && i.name).map((i) => ({ ...i }));
  // Older estimates only had calories per ingredient: share the meal's macros out by calories.
  const itemCalories = items.reduce((sum, i) => sum + (i.calories || 0), 0);
  for (const i of items) {
    for (const m of ["protein", "carbs", "fat"]) {
      if (typeof i[m] !== "number") i[m] = itemCalories ? (base[m] * (i.calories || 0)) / itemCalories : 0;
    }
  }

  openSheet({
    tall: !!entry.photo,
    cls: entry.photo ? "" : "no-photo",
    html: `
      ${photo}
      <div class="detail-card">
        <div class="time-label">${esc(timeLabel(entry.time, entry.date))}</div>
        <div class="name-row">
          <input class="name-input" value="${esc(entry.name)}" aria-label="Food name" maxlength="60">
          <div class="stepper">
            <button data-step="-0.5" aria-label="Fewer servings" data-icon="minus"></button>
            <output data-servings>${draft.servings}</output>
            <button data-step="0.5" aria-label="More servings" data-icon="plus"></button>
          </div>
        </div>
        <div class="meal-row">
          ${MEALS.map((m) => `<button class="meal-chip ${draft.meal === m ? "active" : ""}" data-meal="${m}" style="--m:var(--${m})"><span class="meal-dot"></span>${MEAL_LABEL[m]}</button>`).join("")}
          <input class="time-input" type="time" data-time value="${pad(t0.getHours())}:${pad(t0.getMinutes())}" aria-label="Time eaten">
        </div>
        <div class="big-stat">
          <div class="ic-box" data-icon="flame"></div>
          <label><span>Calories</span><input class="num-input" data-f="calories" type="number" inputmode="numeric"></label>
        </div>
        <div class="mini-stats">
          <label class="mini-stat" style="--dot:var(--protein)"><span>Protein</span><div class="num-wrap"><input class="num-input" data-f="protein" type="number" inputmode="numeric"><em>g</em></div></label>
          <label class="mini-stat" style="--dot:var(--carbs)"><span>Carbs</span><div class="num-wrap"><input class="num-input" data-f="carbs" type="number" inputmode="numeric"><em>g</em></div></label>
          <label class="mini-stat" style="--dot:var(--fat)"><span>Fat</span><div class="num-wrap"><input class="num-input" data-f="fat" type="number" inputmode="numeric"><em>g</em></div></label>
        </div>
        ${
          entry.healthScore
            ? `<div class="health"><div class="health-top"><span>Health score</span><span>${entry.healthScore}/10</span></div>
               <div class="bar"><i style="width:${clamp(entry.healthScore, 0, 10) * 10}%"></i></div></div>`
            : ""
        }
        <div class="items" data-items-box ${items.length ? "" : "hidden"}>
          <h4>Ingredients</h4>
          <p class="items-hint">Tap one to edit it, or ✕ to remove it.</p>
          <div data-items></div>
        </div>
        ${
          entry.source !== "manual"
            ? `<div class="fix-box"><input class="input" data-fix-text placeholder="Fix with AI, e.g. “no rice, 2 eggs”" maxlength="200">
               <button class="btn" data-fix><span data-icon="wand"></span>Fix</button></div>`
            : ""
        }
        <div class="btn-row">
          <button class="btn light" data-del>Delete</button>
          <button class="btn" data-save>Done</button>
        </div>
      </div>`,
    onMount(sheet, close) {
      const fields = ["calories", "protein", "carbs", "fat"];
      const fit = (el) => {
        if (el.closest(".mini-stat")) fitInput(el);
      };
      const paint = () => {
        for (const f of fields) {
          const el = $(`[data-f="${f}"]`, sheet);
          el.value = round(base[f] * draft.servings);
          fit(el);
        }
        $("[data-servings]", sheet).textContent = draft.servings;
      };
      paint();

      const edited = () => {
        const [hh, mm] = ($("[data-time]", sheet).value || "").split(":").map(Number);
        let time = entry.time;
        if (Number.isFinite(hh) && Number.isFinite(mm)) {
          const d = dateOf(entry.date);
          d.setHours(hh, mm, 0, 0);
          time = d.getTime();
        }
        return {
          ...entry,
          name: $(".name-input", sheet).value.trim() || entry.name,
          meal: draft.meal,
          time,
          servings: draft.servings,
          items: items.map((i) => ({
            name: i.name,
            amount: i.amount,
            calories: round1(i.calories),
            protein: round1(i.protein),
            carbs: round1(i.carbs),
            fat: round1(i.fat),
          })),
          calories: round1(base.calories),
          protein: round1(base.protein),
          carbs: round1(base.carbs),
          fat: round1(base.fat),
        };
      };

      // Ingredients: removing or editing one moves the meal's totals by the difference, and saves straight away.
      const shift = (from, to) => {
        for (const f of fields) base[f] = Math.max(0, base[f] + (to?.[f] || 0) - (from?.[f] || 0));
      };
      const renderItems = () => {
        $("[data-items-box]", sheet).hidden = !items.length;
        const list = $("[data-items]", sheet);
        list.innerHTML = items
          .map(
            (i, n) => `
            <div class="item">
              <button class="item-main" data-edit-item="${n}"><div>${esc(i.name)}<small>${esc(i.amount || "")}</small></div><b>${round(i.calories)} cal</b></button>
              <button class="item-del" data-del-item="${n}" aria-label="Remove ${esc(i.name)}" data-icon="close"></button>
            </div>`
          )
          .join("");
        hydrateIcons(list);
      };
      const removeItem = (n) => {
        const [gone] = items.splice(n, 1);
        shift(gone, null);
        renderItems();
        paint();
        saveEntry(edited());
        haptic(10);
        toast(`Removed ${gone.name}`, 4000, {
          label: "Undo",
          onClick: () => {
            items.splice(n, 0, gone);
            shift(null, gone);
            renderItems();
            paint();
            saveEntry(edited());
          },
        });
      };
      renderItems();
      $("[data-items]", sheet).addEventListener("click", (e) => {
        const del = e.target.closest("[data-del-item]");
        if (del) return removeItem(Number(del.dataset.delItem));
        const edit = e.target.closest("[data-edit-item]");
        if (edit) {
          const n = Number(edit.dataset.editItem);
          openItemEditor(items[n], {
            onSave: (next) => {
              shift(items[n], next);
              items[n] = next;
              renderItems();
              paint();
              saveEntry(edited());
            },
            onRemove: () => removeItem(n),
          });
        }
      });

      for (const f of fields) {
        $(`[data-f="${f}"]`, sheet).addEventListener("input", (e) => {
          base[f] = Math.max(0, num(e.target.value)) / draft.servings;
          fit(e.target);
        });
      }
      $$("[data-step]", sheet).forEach((b) =>
        b.addEventListener("click", () => {
          draft.servings = clamp(draft.servings + Number(b.dataset.step), 0.5, 20);
          haptic(6);
          paint();
        })
      );
      $$("[data-meal]", sheet).forEach((b) =>
        b.addEventListener("click", () => {
          draft.meal = b.dataset.meal;
          $$("[data-meal]", sheet).forEach((x) => x.classList.toggle("active", x === b));
          haptic(6);
        })
      );
      $("[data-save]", sheet).addEventListener("click", async () => {
        close();
        await saveEntry(edited());
      });
      $$("[data-del]", sheet).forEach((b) =>
        b.addEventListener("click", async () => {
          const ok = await confirmSheet({
            title: "Delete this food?",
            text: "It will be removed from your log.",
            confirm: "Delete",
            danger: true,
          });
          if (!ok) return;
          close();
          await deleteEntry(entry.id);
          toast("Food deleted");
        })
      );
      $("[data-fix]", sheet)?.addEventListener("click", async () => {
        const correction = $("[data-fix-text]", sheet).value.trim();
        if (!correction) {
          $("[data-fix-text]", sheet).focus();
          return;
        }
        if (!state.settings.accessCode) {
          toast("Enter your access code in Settings first.");
          return;
        }
        const t = entryTotals({ ...entry, ...base, servings: draft.servings });
        const previous = {
          name: entry.name,
          calories: round(t.calories),
          protein: round(t.protein),
          carbs: round(t.carbs),
          fat: round(t.fat),
          items,
          note: entry.query ? `Originally described as: ${entry.query}` : undefined,
        };
        const image = entry.photo ? await photoBase64(entry) : null;
        close();
        runAnalysis({ ...entry }, { mode: "fix", image, previous, correction });
      });
    },
  });
}

/** "150 g" → [150, "g"]; kilograms and litres become g and ml so "0.2 kg" compares with "150 g". */
function parseAmount(text) {
  const m = /(\d+(?:[.,]\d+)?)\s*([a-z]+)/i.exec(String(text || ""));
  if (!m) return null;
  let value = Number(m[1].replace(",", "."));
  let unit = m[2].toLowerCase();
  if (unit === "kg") [value, unit] = [value * 1000, "g"];
  if (unit === "l") [value, unit] = [value * 1000, "ml"];
  return value > 0 ? [value, unit.replace(/s$/, "")] : null;
}

function openItemEditor(item, { onSave, onRemove }) {
  const macros = ["calories", "protein", "carbs", "fat"];
  const label = { calories: "Calories", protein: "Protein (g)", carbs: "Carbs (g)", fat: "Fat (g)" };
  openSheet({
    html: `
      <div class="sheet-head"><h2 class="sheet-title">Edit ingredient</h2>${closeBtn}</div>
      <label class="field"><span>Name</span><input class="input" data-i="name" value="${esc(item.name)}" maxlength="80" autocomplete="off"></label>
      <label class="field"><span>Amount</span><input class="input" data-i="amount" value="${esc(item.amount || "")}" placeholder="e.g. 150 g" maxlength="40" autocomplete="off"></label>
      <div class="item-macros">
        ${macros
          .map(
            (f) => `<label class="field"><span>${label[f]}</span><input class="input" data-i="${f}" type="number" inputmode="decimal" value="${f === "calories" ? round(item[f]) : round1(item[f])}"></label>`
          )
          .join("")}
      </div>
      <div class="btn-row">
        <button class="btn light" data-remove>Remove</button>
        <button class="btn" data-save-item>Save</button>
      </div>`,
    onMount(sheet, close) {
      const input = (k) => $(`[data-i="${k}"]`, sheet);
      // Changing the amount rescales the numbers, from whatever they were when the amount was last set.
      let from = { amount: parseAmount(item.amount), values: Object.fromEntries(macros.map((f) => [f, item[f]])) };
      const rebase = () => (from = { amount: parseAmount(input("amount").value), values: Object.fromEntries(macros.map((f) => [f, num(input(f).value)])) });
      input("amount").addEventListener("input", () => {
        const to = parseAmount(input("amount").value);
        if (!from.amount || !to || to[1] !== from.amount[1]) return;
        const k = to[0] / from.amount[0];
        for (const f of macros) input(f).value = f === "calories" ? round(from.values[f] * k) : round1(from.values[f] * k);
      });
      for (const f of macros) input(f).addEventListener("change", rebase);
      $("[data-save-item]", sheet).addEventListener("click", () => {
        close();
        onSave({
          name: input("name").value.trim() || item.name,
          amount: input("amount").value.trim(),
          ...Object.fromEntries(macros.map((f) => [f, Math.max(0, num(input(f).value))])),
        });
      });
      $("[data-remove]", sheet).addEventListener("click", () => {
        close();
        onRemove();
      });
    },
  });
}

// ------------------------------------------------------------------ weight

export function openWeightSheet() {
  const current = currentWeight();
  let kg = Math.floor(current);
  let dec = Math.round((current - kg) * 10);
  openSheet({
    html: `
      <div class="sheet-head"><h2 class="sheet-title">Log weight</h2>${closeBtn}</div>
      <p class="ob-sub" style="margin:0 0 6px">Weigh in at the same time each day for the clearest trend.</p>
      <div class="wheels" style="margin-top:12px">
        <div class="wheel-col" data-w="kg"></div>
        <div class="wheel-col" data-w="dec" style="max-width:110px"></div>
      </div>
      <button class="btn" style="margin-top:22px" data-save>Save weight</button>`,
    onMount(sheet, close) {
      wheel($('[data-w="kg"]', sheet), { values: range(30, 250), value: kg, format: (v) => `${v}`, onChange: (v) => (kg = v) });
      wheel($('[data-w="dec"]', sheet), { values: range(0, 9), value: dec, format: (v) => `.${v} kg`, onChange: (v) => (dec = v) });
      $("[data-save]", sheet).addEventListener("click", async () => {
        const value = round1(kg + dec / 10);
        close();
        await saveWeight({ id: uid(), date: todayKey(), time: Date.now(), kg: value });
        toast(`Saved ${value} kg`);
      });
    },
  });
}

// ------------------------------------------------------------------ settings

const GOAL_LABEL = { lose: "Lose weight", maintain: "Maintain weight", gain: "Gain weight", glutes: "Grow glutes" };

export function openSettings({ onRedoOnboarding } = {}) {
  const s = state.settings;
  const p = s.profile;
  const initial = (s.name || "L").trim().charAt(0).toUpperCase();
  openSheet({
    tall: true,
    html: `
      <div class="sheet-head"><h2 class="sheet-title">Settings</h2>${closeBtn}</div>
      <div class="settings">
        <div class="profile-card">
          <div class="initial">${esc(initial)}</div>
          <div><b>${esc(s.name || "You")}</b><span>${GOAL_LABEL[p.goal]}${direction(p) !== "maintain" ? ` · ${p.pace} kg/week` : ""}</span></div>
        </div>

        <section>
          <h4>Appearance</h4>
          <div class="segmented" data-appearance>
            ${[["system", "Automatic"], ["light", "Light"], ["dark", "Dark"]]
              .map(([k, v]) => `<button class="${(s.appearance ?? "system") === k ? "on" : ""}" data-v="${k}">${v}</button>`)
              .join("")}
          </div>
        </section>

        <section>
          <h4>Daily targets</h4>
          <div class="rows">
            <div class="row"><span class="dot" style="background:var(--ink)"></span><span class="row-label">Calories</span><input type="number" inputmode="numeric" data-goal="calories" value="${s.goals.calories}"></div>
            <div class="row"><span class="dot" style="background:var(--protein)"></span><span class="row-label">Protein (g)</span><input type="number" inputmode="numeric" data-goal="protein" value="${s.goals.protein}"></div>
            <div class="row"><span class="dot" style="background:var(--carbs)"></span><span class="row-label">Carbs (g)</span><input type="number" inputmode="numeric" data-goal="carbs" value="${s.goals.carbs}"></div>
            <div class="row"><span class="dot" style="background:var(--fat)"></span><span class="row-label">Fat (g)</span><input type="number" inputmode="numeric" data-goal="fat" value="${s.goals.fat}"></div>
            <div class="row"><span class="dot" style="background:var(--water)"></span><span class="row-label">Water (ml)</span><input type="number" inputmode="numeric" step="250" data-goal="water" value="${s.goals.water}"></div>
            <div class="row"><span class="row-label">Add exercise calories to my goal<small>Eat back what you burn in workouts</small></span><label class="switch"><input type="checkbox" data-addburned ${s.addBurned ? "checked" : ""}><i></i></label></div>
            <div class="row"><span class="row-label">Recalculate from my details<small>Uses the details below</small></span><button class="row-action" data-recalc>Update</button></div>
          </div>
        </section>

        <section>
          <h4>Personal details</h4>
          <div class="rows">
            <div class="row"><span class="row-label">Name</span><input data-p="name" value="${esc(s.name)}" style="width:150px" autocomplete="off"></div>
            <div class="row"><span class="row-label">Goal</span><select data-p="goal">
              ${Object.entries(GOAL_LABEL).map(([k, v]) => `<option value="${k}" ${p.goal === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
            <div class="row" data-glutes-row ${p.goal === "glutes" ? "" : "hidden"}><span class="row-label">Glute approach</span><select data-p="glutes">
              <option value="lean" ${p.glutes !== "bulk" ? "selected" : ""}>Stay lean</option>
              <option value="bulk" ${p.glutes === "bulk" ? "selected" : ""}>Build faster</option></select></div>
            <div class="row"><span class="row-label">Current weight (kg)</span><input type="number" inputmode="decimal" data-p="weight" value="${round1(currentWeight())}"></div>
            <div class="row"><span class="row-label">Goal weight (kg)</span><input type="number" inputmode="decimal" data-p="targetWeight" value="${p.targetWeight}"></div>
            <div class="row"><span class="row-label">Pace (kg/week)</span><input type="number" inputmode="decimal" step="0.1" data-p="pace" value="${p.pace}"></div>
            <div class="row"><span class="row-label">Height (cm)</span><input type="number" inputmode="numeric" data-p="height" value="${p.height}"></div>
            <div class="row"><span class="row-label">Age</span><input type="number" inputmode="numeric" data-p="age" value="${p.age}"></div>
            <div class="row"><span class="row-label">Gender</span><select data-p="sex">
              ${[["female", "Female"], ["male", "Male"], ["other", "Other"]].map(([k, v]) => `<option value="${k}" ${p.sex === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
            <div class="row"><span class="row-label">Workouts per week</span><select data-p="workouts">
              ${["0-2", "3-5", "6+"].map((k) => `<option value="${k}" ${p.workouts === k ? "selected" : ""}>${k}</option>`).join("")}</select></div>
          </div>
        </section>

        <section>
          <h4>Food scanning</h4>
          <div class="rows">
            <div class="row"><span class="row-label">Access code</span><input data-code value="${esc(s.accessCode)}" placeholder="lean-…" autocomplete="off" autocapitalize="off" spellcheck="false" style="width:160px"></div>
            <div class="row"><span class="row-label">Connection</span><button class="row-action" data-test>Test</button></div>
          </div>
          <p class="status" data-status>${s.accessCode ? "Code saved on this phone." : "Needed for photo scans, barcodes and food search."}</p>
        </section>

        <section>
          <h4>Your data</h4>
          <div class="rows">
            <div class="row"><span class="row-label">Export backup<small>Save all your logs as a file</small></span><button class="row-action" data-export>Export</button></div>
            <div class="row"><span class="row-label">Restore backup</span><button class="row-action" data-import>Import</button></div>
            <div class="row"><span class="row-label">Redo onboarding</span><button class="row-action" data-redo>Start</button></div>
            <div class="row"><span class="row-label" style="color:var(--danger)">Delete all data</span><button class="row-action" style="color:var(--danger)" data-wipe>Delete</button></div>
          </div>
        </section>
        <p class="status" style="text-align:center;margin-top:22px">Lean · AI by Claude · Food data from USDA and Open Food Facts</p>
      </div>`,
    onMount(sheet, close) {
      $$("[data-goal]", sheet).forEach((i) =>
        i.addEventListener("change", () => {
          const v = Math.max(0, round(num(i.value)));
          i.value = v;
          updateSettings({ goals: { [i.dataset.goal]: v } });
        })
      );
      const recalc = (message) => {
        const plan = computePlan({ ...state.settings.profile, weight: currentWeight() });
        updateSettings({ goals: { calories: plan.calories, protein: plan.protein, carbs: plan.carbs, fat: plan.fat, water: plan.water } });
        for (const k of ["calories", "protein", "carbs", "fat", "water"]) $(`[data-goal="${k}"]`, sheet).value = plan[k];
        toast(message ?? `New target: ${plan.calories} calories a day`);
        return plan;
      };
      $$("[data-p]", sheet).forEach((i) =>
        i.addEventListener("change", async () => {
          const k = i.dataset.p;
          if (k === "name") return updateSettings({ name: i.value.trim() });
          if (k === "goal" || k === "glutes") {
            const profile = { [k]: i.value };
            // Moving towards a weight needs a target on the right side of the current weight.
            const next = { ...state.settings.profile, ...profile };
            const w = currentWeight();
            if (direction(next) === "lose" && next.targetWeight >= w) profile.targetWeight = Math.max(30, round1(w - 5));
            if (direction(next) === "gain" && next.targetWeight <= w) profile.targetWeight = round1(w + (next.goal === "glutes" ? 3 : 5));
            if (next.goal === "glutes" && direction(next) === "gain" && next.pace > 0.3) profile.pace = 0.2;
            if (profile.targetWeight) $('[data-p="targetWeight"]', sheet).value = profile.targetWeight;
            if (profile.pace) $('[data-p="pace"]', sheet).value = profile.pace;
            $("[data-glutes-row]", sheet).hidden = next.goal !== "glutes";
            updateSettings({ profile });
            const plan = recalc();
            toast(`Targets updated for ${GOAL_LABEL[next.goal].toLowerCase()}: ${plan.calories} cal, ${plan.protein} g protein`);
            return;
          }
          if (["sex", "workouts"].includes(k)) return updateSettings({ profile: { [k]: i.value } });
          const v = num(i.value, state.settings.profile[k]);
          i.value = v;
          if (k === "weight") {
            await saveWeight({ id: uid(), date: todayKey(), time: Date.now(), kg: round1(v) });
          } else updateSettings({ profile: { [k]: v } });
        })
      );
      $("[data-recalc]", sheet).addEventListener("click", () => recalc());
      $("[data-addburned]", sheet).addEventListener("change", (e) => updateSettings({ addBurned: e.target.checked }));
      $$("[data-appearance] button", sheet).forEach((b) =>
        b.addEventListener("click", () => {
          $$("[data-appearance] button", sheet).forEach((x) => x.classList.toggle("on", x === b));
          updateSettings({ appearance: b.dataset.v });
          setTheme(b.dataset.v);
        })
      );

      const status = $("[data-status]", sheet);
      const codeInput = $("[data-code]", sheet);
      codeInput.addEventListener("change", () => updateSettings({ accessCode: codeInput.value.trim() }));
      $("[data-test]", sheet).addEventListener("click", async () => {
        updateSettings({ accessCode: codeInput.value.trim() });
        status.className = "status";
        status.textContent = "Testing…";
        try {
          await checkConnection(state.settings.accessCode);
          status.className = "status good";
          status.textContent = "Connected. Food scanning is ready.";
        } catch (err) {
          status.className = "status bad";
          status.textContent = err.message;
        }
      });

      $("[data-export]", sheet).addEventListener("click", () => {
        const { accessCode, ...settings } = state.settings;
        const blob = new Blob([JSON.stringify({ app: "lean", version: 3, settings, entries: state.entries, weights: state.weights, water: state.water, workouts: state.workouts })], {
          type: "application/json",
        });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `lean-backup-${todayKey()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      });
      $("[data-import]", sheet).addEventListener("click", () => {
        const input = $("#file-import");
        input.onchange = async () => {
          const file = input.files?.[0];
          input.value = "";
          if (!file) return;
          try {
            const data = JSON.parse(await file.text());
            if (data.app !== "lean" || !Array.isArray(data.entries)) throw new Error();
            const ok = await confirmSheet({
              title: "Restore this backup?",
              text: `It has ${data.entries.length} foods. Your current logs on this phone will be replaced.`,
              confirm: "Restore",
            });
            if (!ok) return;
            await replaceAll({ entries: data.entries, weights: data.weights ?? [], water: data.water ?? {}, workouts: data.workouts ?? [] });
            if (data.settings) updateSettings({ ...data.settings, accessCode: state.settings.accessCode });
            close();
            toast("Backup restored");
          } catch {
            toast("That file isn't a Lean backup.");
          }
        };
        input.click();
      });
      $("[data-redo]", sheet).addEventListener("click", () => {
        close();
        setTimeout(() => onRedoOnboarding?.(), 200);
      });
      $("[data-wipe]", sheet).addEventListener("click", async () => {
        const ok = await confirmSheet({
          title: "Delete everything?",
          text: "All foods and weigh-ins on this phone will be erased. This can't be undone.",
          confirm: "Delete all",
          danger: true,
        });
        if (!ok) return;
        await replaceAll({ entries: [], weights: [] });
        close();
        toast("All data deleted");
      });
    },
  });
}

export { hydrateIcons };
