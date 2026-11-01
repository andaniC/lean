// Food analysis goes through the Supabase Edge Function "lean-food-ai", which holds the
// Claude API key as a secret. The phone only knows the access code.
import { FUNCTION_URL } from "./config.js";

export class AIError extends Error {}

async function call(accessCode, body, retry = true) {
  if (!accessCode) throw new AIError("Enter your access code in Settings to analyze food.");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 170_000);
  let res;
  try {
    res = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-access-code": accessCode },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new AIError(err.name === "AbortError" ? "That took too long. Please retry." : "No connection. Check your internet and retry.");
  } finally {
    clearTimeout(timer);
  }
  // 503 means the server function failed to start (it happens briefly after an update): try once more.
  if (res.status === 503 && retry) {
    await new Promise((r) => setTimeout(r, 1200));
    return call(accessCode, body, false);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw new AIError(data?.error || `Server error (${res.status}). Please retry.`);
  return data;
}

/**
 * mode: "scan" | "label" | "barcode" | "text" | "fix"
 * image: base64 JPEG (no data: prefix) or null
 */
export async function analyzeFood({ accessCode, mode, image, text, previous, correction, barcodeDigits }) {
  const data = await call(accessCode, { action: "analyze", mode, image, text, previous, correction, barcodeDigits });
  return data.result;
}

/** Checks the access code and that the server can reach Claude. */
export async function checkConnection(accessCode) {
  return call(accessCode, { action: "ping" });
}

/** USDA FoodData Central search. Returns [{ id, name, brand, per100, serving }]. */
export async function searchFoods(accessCode, query) {
  const data = await call(accessCode, { action: "search", query });
  return data.foods ?? [];
}

/** Open Food Facts, then USDA branded foods. Returns a food or null. */
export async function lookupBarcode(accessCode, code) {
  const data = await call(accessCode, { action: "barcode", code });
  return data.food ?? null;
}
