export type Theme = "light" | "dark";

const KEY = "theme";
const systemDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

function stored(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

/** The visitor's explicit choice, else the system setting. */
export const currentTheme = (): Theme => stored() ?? (systemDark() ? "dark" : "light");

/** An explicit choice sets `data-theme` on <html>; without one the system setting applies. */
export function initTheme() {
  const theme = stored();
  if (theme) document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // The choice just lasts until the page is closed.
  }
}
