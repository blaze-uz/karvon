export function normalizeMemoryLimitMb(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value);
}

export function parseMemoryLimitInput(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return normalizeMemoryLimitMb(Number(trimmed));
}

export function formatMemory(bytes?: number): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

export function formatMemoryLimit(limitMb?: number): string {
  return limitMb ? `${limitMb} MB` : "Off";
}
