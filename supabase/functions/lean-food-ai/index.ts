// Lean food analysis proxy. The Claude API key lives only in this function's secrets
// (ANTHROPIC_API_KEY, USDA_API_KEY); the app proves it's allowed in with APP_ACCESS_CODE.
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";

const MODEL = "claude-sonnet-5-5";

const NUTRITION_SCHEMA = {
  type: "object",
  properties: {
    is_food: { type: "boolean" },
    message: { type: "string" },
    name: { type: "string" },
    calories: { type: "number" },
    protein: { type: "number" },
    carbs: { type: "number" },
    fat: { type: "number" },
    health_score: { type: "integer" },
    barcode: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          amount: { type: "string" },
          calories: { type: "number" },
        },
        required: ["name", "amount", "calories"],
        additionalProperties: false,
      },
    },
  },
  required: ["is_food", "message", "name", "calories", "protein", "carbs", "fat", "health_score", "barcode", "items"],
  additionalProperties: false,
};

const SYSTEM = `You are the nutrition engine of Lean, a calorie-tracking app. Your numbers go straight into someone's daily totals, so they need to be as accurate as a careful dietitian's estimate, not rough guesses or cautious round numbers.

How to estimate:
1. Identify every component of the meal, including drinks, sauces, dressings, spreads and cooking fat that are visible or very likely there (fried food absorbs oil; restaurant and home-cooked dishes usually contain oil or butter).
2. Estimate the edible weight of each component in grams (ml for drinks). Use cues for scale: a dinner plate is about 26 cm across, plus cutlery, hands, cups, packaging and how deep food sits in a bowl. For descriptions, use the amounts given, or standard portion sizes when none are given.
3. Work out each component's calories and macros from standard reference values (USDA FoodData Central, or the product's own label) for that weight and cooking method.
4. Add them up. The totals must be consistent: protein x 4 + carbs x 4 + fat x 9 (+ alcohol x 7 for alcoholic drinks) should land within about 5% of the calorie total.

Estimate the whole portion shown or described, not per 100 g. When something is ambiguous, choose the most likely common version and make the assumption visible in the item names and amounts rather than hedging.

Fields:
- name: a short dish name, 2 to 4 words, Title Case (for example "Grilled Salmon" or "Chicken With Sauce").
- items: each component with its amount in grams or ml ("150 g", "330 ml") and its calories. Items must add up to the total.
- calories, protein, carbs, fat: totals for the portion, as whole numbers.
- health_score: 1 to 10, how nutritious the meal is overall.
- barcode: the digits of a product barcode if one is clearly readable, otherwise "".
- is_food: false when there is nothing to eat or drink in the input. Then put a one-sentence explanation in message and use 0 and empty values elsewhere. Otherwise message is "".`;

const PROMPTS: Record<string, string> = {
  scan: "Estimate the nutrition of the food in this photo.",
  label:
    "This is a photo of a nutrition information label. Read the values for one serving as printed (if only kJ is shown, convert with kcal = kJ / 4.184; if only per-100 g values are shown, use the serving size printed on the label, or 100 g if there is none). Use the product name as the name if it is visible.",
  barcode:
    "This photo should show a packaged product and its barcode. Read the barcode digits if you can, identify the product, and estimate the nutrition for one typical serving of it.",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-access-code",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function sameCode(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// deno-lint-ignore no-explicit-any
const apiMessage = (err: any) => err?.error?.error?.message as string | undefined;

function errorReply(err: unknown) {
  if (err instanceof Anthropic.AuthenticationError) return reply({ error: "The Claude API key stored in Supabase was rejected." }, 502);
  if (err instanceof Anthropic.PermissionDeniedError) return reply({ error: "The stored Claude API key isn't allowed to use this model." }, 502);
  if (err instanceof Anthropic.RateLimitError) return reply({ error: "Too many scans at once. Wait a moment and retry." }, 429);
  if (err instanceof Anthropic.BadRequestError) return reply({ error: apiMessage(err) ?? "Claude couldn't read that request." }, 400);
  if (err instanceof Anthropic.InternalServerError) return reply({ error: "Claude is busy right now. Try again in a minute." }, 503);
  if (err instanceof Anthropic.APIConnectionError) return reply({ error: "Couldn't reach Claude. Try again." }, 504);
  if (err instanceof Anthropic.APIError) return reply({ error: apiMessage(err) ?? `Claude error ${err.status}` }, 502);
  console.error(err);
  return reply({ error: "Something went wrong analyzing this meal." }, 500);
}

type Body = {
  action?: "ping" | "analyze" | "search" | "barcode";
  mode?: "scan" | "label" | "barcode" | "text" | "fix";
  image?: string | null;
  text?: string;
  previous?: unknown;
  correction?: string;
  barcodeDigits?: string;
  query?: string;
  code?: string;
};

type Food = {
  id: string;
  name: string;
  brand: string;
  source: "usda" | "off";
  per100: { calories: number; protein: number; carbs: number; fat: number };
  serving: { grams: number; label: string } | null;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const tidyName = (s: string) =>
  s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s.charAt(0).toUpperCase() + s.slice(1);

// --- USDA FoodData Central -------------------------------------------------
// deno-lint-ignore no-explicit-any
function fromUsda(f: any): Food | null {
  // deno-lint-ignore no-explicit-any
  const nutrient = (...ids: number[]) => {
    for (const id of ids) {
      // deno-lint-ignore no-explicit-any
      const hit = f.foodNutrients?.find((n: any) => n.nutrientId === id && typeof n.value === "number");
      if (hit) return hit.value as number;
    }
    return null;
  };
  let kcal = nutrient(1008, 2047, 2048);
  if (kcal == null) {
    const kj = nutrient(1062);
    if (kj != null) kcal = kj / 4.184;
  }
  if (kcal == null) return null;
  const unit = String(f.servingSizeUnit ?? "").toLowerCase();
  const grams = typeof f.servingSize === "number" && ["g", "grm", "ml", "mlt"].includes(unit) ? f.servingSize : null;
  return {
    id: `usda:${f.fdcId}`,
    name: tidyName(String(f.description ?? "Food")),
    brand: tidyName(String(f.brandName || f.brandOwner || "")),
    source: "usda",
    per100: { calories: Math.round(kcal), protein: round1(nutrient(1003) ?? 0), carbs: round1(nutrient(1005) ?? 0), fat: round1(nutrient(1004) ?? 0) },
    serving: grams ? { grams: round1(grams), label: f.householdServingFullText ? `${f.householdServingFullText} (${round1(grams)} g)` : `${round1(grams)} g` } : null,
  };
}

async function usdaSearch(query: string, dataType: string, pageSize: number) {
  const key = Deno.env.get("USDA_API_KEY");
  if (!key) throw new Error("USDA_API_KEY missing");
  const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
  url.searchParams.set("api_key", key);
  url.searchParams.set("query", query);
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("dataType", dataType);
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`USDA ${res.status}`);
  const data = await res.json();
  // deno-lint-ignore no-explicit-any
  return (data.foods ?? []) as any[];
}

async function searchFoods(query: string) {
  const q = query.slice(0, 120).trim();
  if (!q) return reply({ foods: [] });
  // Generic foods first (better for home-cooked meals), then branded products.
  const [generic, branded] = await Promise.allSettled([
    usdaSearch(q, "Survey (FNDDS),SR Legacy,Foundation", 15),
    usdaSearch(q, "Branded", 10),
  ]);
  if (generic.status === "rejected" && branded.status === "rejected") {
    console.error(generic.reason, branded.reason);
    return reply({ error: "The food database isn't responding. Try again." }, 502);
  }
  const all = [
    ...(generic.status === "fulfilled" ? generic.value : []),
    ...(branded.status === "fulfilled" ? branded.value : []),
  ];
  const seen = new Set<string>();
  const foods = all.map(fromUsda).filter((f): f is Food => {
    if (!f) return false;
    const k = `${f.name}|${f.brand}`.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return reply({ foods });
}

// --- Barcodes: Open Food Facts first (good South African coverage), then USDA branded ---
async function lookupOpenFoodFacts(code: string): Promise<Food | null> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,nutriments,serving_size,serving_quantity`;
  const res = await fetch(url, { headers: { "User-Agent": "Lean/1.0 (personal calorie tracker)" }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) return null;
  const data = await res.json();
  const p = data?.product;
  if (data?.status !== 1 || !p) return null;
  const n = p.nutriments ?? {};
  let kcal = n["energy-kcal_100g"];
  if (typeof kcal !== "number" && typeof n["energy_100g"] === "number") kcal = n["energy_100g"] / 4.184;
  if (typeof kcal !== "number") return null;
  const grams = Number(p.serving_quantity);
  return {
    id: `off:${code}`,
    name: tidyName(String(p.product_name || "Product")),
    brand: String(p.brands ?? "").split(",")[0].trim(),
    source: "off",
    per100: { calories: Math.round(kcal), protein: round1(n.proteins_100g ?? 0), carbs: round1(n.carbohydrates_100g ?? 0), fat: round1(n.fat_100g ?? 0) },
    serving: grams > 0 ? { grams: round1(grams), label: p.serving_size ? String(p.serving_size) : `${round1(grams)} g` } : null,
  };
}

async function lookupBarcode(raw: string) {
  const code = raw.replace(/\D/g, "").slice(0, 20);
  if (code.length < 6) return reply({ error: "That barcode looks incomplete." }, 400);
  // UPC-A (12 digits) is stored as EAN-13 with a leading zero in Open Food Facts.
  const variants = code.length === 12 ? [code, `0${code}`] : [code];
  for (const v of variants) {
    try {
      const off = await lookupOpenFoodFacts(v);
      if (off) return reply({ food: off });
    } catch (err) {
      console.error("OFF", err);
    }
  }
  try {
    const strip = (s: string) => s.replace(/^0+/, "");
    const hits = await usdaSearch(code, "Branded", 5);
    const match = hits.find((f) => strip(String(f.gtinUpc ?? "")) === strip(code));
    const food = match ? fromUsda(match) : null;
    if (food) return reply({ food });
  } catch (err) {
    console.error("USDA", err);
  }
  return reply({ food: null });
}

async function analyze(client: Anthropic, body: Body) {
  const mode = body.mode ?? "scan";
  const image = typeof body.image === "string" && body.image.length > 0 ? body.image : null;
  if (image && image.length > 8_000_000) return reply({ error: "That photo is too large." }, 413);

  let prompt: string;
  if (mode === "text") {
    const text = String(body.text ?? "").slice(0, 2000).trim();
    if (!text) return reply({ error: "Describe what you ate first." }, 400);
    prompt = `What I ate: ${text}`;
  } else if (mode === "fix") {
    const correction = String(body.correction ?? "").slice(0, 1000).trim();
    prompt =
      `Your previous estimate for this meal was:\n${JSON.stringify(body.previous ?? {}).slice(0, 4000)}\n\n` +
      `The person corrected it: "${correction}"\n\nReturn the corrected estimate for the whole meal.`;
  } else {
    if (!image) return reply({ error: "No photo was sent." }, 400);
    prompt = PROMPTS[mode] ?? PROMPTS.scan;
  }
  const digits = String(body.barcodeDigits ?? "").replace(/\D/g, "").slice(0, 20);
  if (digits) prompt += `\nThe barcode reads ${digits}.`;

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } });
  content.push({ type: "text", text: prompt });

  const params = {
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // re-runs a declined request on Anthropic's recommended fallback model
    system: SYSTEM,
    output_config: { effort: "high", format: { type: "json_schema", schema: NUTRITION_SCHEMA } },
    messages: [{ role: "user", content }],
  };
  // Cast: SDK typings may lag the "default" fallback mode.
  const res = await client.beta.messages.create(
    params as unknown as Parameters<typeof client.beta.messages.create>[0],
  ) as Anthropic.Beta.BetaMessage;

  if (res.stop_reason === "refusal") return reply({ error: "Claude couldn't analyze this one. Try a different photo." }, 422);
  if (res.stop_reason === "max_tokens") return reply({ error: "The analysis was cut short. Please retry." }, 502);
  const block = res.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return reply({ error: "Claude returned an empty answer. Please retry." }, 502);
  try {
    return reply({ result: JSON.parse(block.text), model: res.model });
  } catch {
    return reply({ error: "Claude's answer couldn't be read. Please retry." }, 502);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  // Always read the whole body first: the edge runtime stalls if we answer before an upload finishes.
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return reply({ error: "Bad request." }, 400);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  const accessCode = Deno.env.get("APP_ACCESS_CODE");
  if (!apiKey || !accessCode) return reply({ error: "Lean's server isn't set up yet (missing secrets)." }, 500);
  if (!sameCode(req.headers.get("x-access-code") ?? "", accessCode)) {
    return reply({ error: "Wrong access code. Check it in Settings." }, 401);
  }

  let body: Body;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply({ error: "Bad request." }, 400);
  }

  const client = new Anthropic({ apiKey, maxRetries: 2 });
  try {
    if (body.action === "ping") {
      await client.models.retrieve(MODEL);
      return reply({ ok: true, model: MODEL });
    }
    if (body.action === "search") return await searchFoods(String(body.query ?? ""));
    if (body.action === "barcode") return await lookupBarcode(String(body.code ?? ""));
    return await analyze(client, body);
  } catch (err) {
    return errorReply(err);
  }
});
