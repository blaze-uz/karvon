import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function getLaunchOnLoginEnabled() {
  if (!isTauri) return false;
  return isEnabled();
}

export async function setLaunchOnLoginEnabled(enabled: boolean) {
  if (!isTauri) return;
  if (enabled) {
    await enable();
  } else {
    await disable();
  }
}
