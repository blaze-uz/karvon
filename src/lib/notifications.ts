import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function ensureNotificationPermission() {
  if (!isTauri) return true;
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === "granted";
}

export function notify(title: string, body: string) {
  if (!isTauri) return;
  sendNotification({ title, body });
}
