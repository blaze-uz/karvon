export function formatRelativeTime(value?: string): string {
  if (!value) return "n/a";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "n/a";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 5) return "now";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function formatClock(value?: string): string {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatPath(path: string): string {
  if (path.length <= 48) return path;
  const parts = path.split("/");
  return `${parts.slice(0, 2).join("/")}/.../${parts.slice(-2).join("/")}`;
}

export function normalizeCliText(value: string): string {
  return value.replace('—', "--").replace('–', "-").replace('−', "-");
}

export function parseListInput(value: string): string[] {
  return normalizeCliText(value)
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseEnvInput(value: string): Record<string, string> {
  return value.split("\n").reduce<Record<string, string>>((acc, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return acc;
    const index = trimmed.indexOf("=");
    if (index === -1) return acc;
    acc[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
    return acc;
  }, {});
}

export function envToText(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}
