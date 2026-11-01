// Light/dark theme. "system" follows the phone; Settings > Appearance can force light or dark.
const media = matchMedia("(prefers-color-scheme: dark)");
let mode = "system";

function apply() {
  const dark = mode === "dark" || (mode !== "light" && media.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#000000" : "#ffffff");
}

export function setTheme(next = "system") {
  mode = next;
  apply();
}

media.addEventListener("change", apply);
