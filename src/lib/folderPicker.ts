import { open } from "@tauri-apps/plugin-dialog";
import { api } from "./api";

interface SelectFolderOptions {
  title?: string;
  prompt?: string;
  fallbackPath?: string;
}

export async function selectFolder(currentPath?: string, options: SelectFolderOptions = {}): Promise<string | undefined> {
  if (api.isTauri) {
    const selected = await open({
      directory: true,
      multiple: false,
      title: options.title ?? "Select project folder",
      defaultPath: currentPath || undefined
    });
    return typeof selected === "string" ? selected : undefined;
  }

  const fallback = window.prompt(options.prompt ?? "Project folder path", currentPath || options.fallbackPath || "~/Projects/");
  return fallback?.trim() || undefined;
}
