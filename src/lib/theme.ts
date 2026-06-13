import type { AppSettings } from "../types/domain";

type ThemePreference = AppSettings["theme"];
type ResolvedTheme = "light" | "dark";

const darkThemeQuery = "(prefers-color-scheme: dark)";

function getSystemThemeQuery() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
  return window.matchMedia(darkThemeQuery);
}

export function resolveThemePreference(theme: ThemePreference = "system"): ResolvedTheme {
  if (theme === "light" || theme === "dark") return theme;
  return getSystemThemeQuery()?.matches ? "dark" : "light";
}

export function applyThemePreference(theme: ThemePreference = "system") {
  if (typeof document === "undefined") return;

  const resolvedTheme = resolveThemePreference(theme);
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme;
  root.dataset.themePreference = theme;
  root.style.colorScheme = resolvedTheme;
}

export function subscribeToSystemThemeChange(onChange: () => void) {
  const query = getSystemThemeQuery();
  if (!query) return () => {};

  const handleChange = () => onChange();
  query.addEventListener("change", handleChange);
  return () => query.removeEventListener("change", handleChange);
}
