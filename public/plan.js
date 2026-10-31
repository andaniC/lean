// Calorie plan: Mifflin-St Jeor BMR x activity, adjusted for the weekly pace.
import { addDays } from "./util.js";

const ACTIVITY = { "0-2": 1.3, "3-5": 1.5, "6+": 1.7 };
const KCAL_PER_KG = 7700;

export function computePlan(p) {
  const sexAdj = p.sex === "male" ? 5 : p.sex === "female" ? -161 : -78;
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + sexAdj;
  const tdee = bmr * (ACTIVITY[p.workouts] ?? 1.3);
  let calories = tdee;
  if (p.goal === "lose") calories -= (p.pace * KCAL_PER_KG) / 7;
  if (p.goal === "gain") calories += (p.pace * KCAL_PER_KG) / 7;
  // Never plan below a safe minimum.
  const floor = p.sex === "male" ? 1500 : 1200;
  calories = Math.max(floor, Math.round(calories / 10) * 10);

  const proteinPerKg = p.goal === "maintain" ? 1.6 : 1.8;
  let protein = Math.round(p.weight * proteinPerKg);
  protein = Math.min(protein, Math.round((calories * 0.35) / 4));
  const fat = Math.round((calories * 0.27) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  return { calories, protein, carbs, fat, tdee: Math.round(tdee) };
}

export function goalDate(p, from = new Date()) {
  if (p.goal === "maintain" || !p.pace) return null;
  const kg = Math.abs(p.weight - p.targetWeight);
  const weeks = kg / p.pace;
  return addDays(from, Math.ceil(weeks * 7));
}

export function bmi(weight, heightCm) {
  const m = heightCm / 100;
  return m > 0 ? weight / (m * m) : 0;
}

export function bmiLabel(v) {
  if (v < 18.5) return "Underweight";
  if (v < 25) return "Healthy";
  if (v < 30) return "Overweight";
  return "Obese";
}
