// "How to" sheet: large looping demo, step-by-step instructions and YouTube tutorial videos.
import { $, openSheet } from "./ui.js";
import { icons } from "./icons.js";
import { GLUTE_EXERCISES } from "./exercise-data.js";
import { esc } from "./util.js";

const API = "https://oss.exercisedb.dev/api/v1/exercises";
const gif = (id) => `https://static.exercisedb.dev/media/${id}.gif`;

async function stepsFor(ex) {
  const curated = GLUTE_EXERCISES.find((e) => e.id === ex.id);
  if (curated?.steps?.length) return curated.steps;
  try {
    const j = await (await fetch(`${API}/${ex.id}`)).json();
    return (j.data?.instructions ?? []).map((s) => s.replace(/^Step:\d+\s*/, ""));
  } catch {
    return [];
  }
}

export const youtubeUrl = (name) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(`how to do ${name.replace(/\(.*?\)/g, "")} glutes`)}`;

/** Shows how to do an exercise. With `onAdd`, the sheet's main button adds it to the workout. */
export function openDemo(ex, { onAdd } = {}) {
  const note = ex.note ?? GLUTE_EXERCISES.find((e) => e.id === ex.id)?.note;
  openSheet({
    tall: true,
    html: `
      <div class="sheet-head"><h2 class="sheet-title">${esc(ex.name)}</h2><button class="round-btn press" data-close aria-label="Close" data-icon="close"></button></div>
      <div class="demo-gif"><img src="${gif(ex.id)}" alt="${esc(ex.name)} demo" onerror="this.closest('.demo-gif').hidden=true"></div>
      ${note ? `<div class="last-time">${esc(note)}</div>` : ""}
      ${onAdd ? `<button class="btn" style="margin-top:12px" data-add-demo><span class="ic">${icons.plus}</span>Add to workout</button>` : ""}
      <a class="yt-btn press" href="${youtubeUrl(ex.name)}" target="_blank" rel="noopener"><span class="ic">${icons.play}</span>Watch videos on YouTube</a>
      <div class="ex-steps" data-steps><div class="note"><span class="spinner dark" style="display:inline-block"></span></div></div>
      `,
    async onMount(sheet, close) {
      $("[data-add-demo]", sheet)?.addEventListener("click", () => {
        close();
        onAdd();
      });
      const steps = await stepsFor(ex);
      $("[data-steps]", sheet).innerHTML = steps.length
        ? `<h4>How to do it</h4><ol>${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`
        : "";
    },
  });
}
