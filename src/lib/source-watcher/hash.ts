import { createHash } from "node:crypto";

/** Stable content hash for normalised payloads (deterministic JSON). */
export function contentHash(value: unknown): string {
  const json = JSON.stringify(sortKeys(value));
  return createHash("sha256").update(json).digest("hex").slice(0, 32);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = sortKeys(obj[key]);
    return out;
  }
  return value;
}
