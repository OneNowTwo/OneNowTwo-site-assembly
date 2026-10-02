export function money(n: number | null | undefined, opts: { compact?: boolean; dp?: number } = {}): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const neg = n < 0;
  const v = Math.abs(n);
  let s: string;
  if (opts.compact && v >= 1_000_000) s = `$${(v / 1_000_000).toFixed(opts.dp ?? (v >= 100_000_000 ? 0 : v >= 10_000_000 ? 1 : 2))}m`;
  else if (opts.compact && v >= 10_000) s = `$${Math.round(v / 1000).toLocaleString("en-AU")}k`;
  else s = `$${Math.round(v).toLocaleString("en-AU")}`;
  return neg ? `−${s}` : s;
}

export function pct(n: number | null | undefined, dp = 1, signed = false): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = `${(n * 100).toFixed(dp)}%`;
  return signed && n > 0 ? `+${s}` : n < 0 ? s.replace("-", "−") : s;
}

export function sqm(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n).toLocaleString("en-AU")} sqm`;
}

export function num(n: number | null | undefined, dp = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-AU", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fsr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(n >= 10 ? 1 : 2).replace(/\.?0+$/, "") || "0"}:1`;
}

export function date(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(x.getTime())) return "—";
  return x.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export function lotDp(p: { lot: string | null; section?: string | null; dp: string | null }): string {
  if (!p.lot && !p.dp) return "—";
  return `Lot ${p.lot ?? "?"}${p.section ? ` Sec ${p.section}` : ""} ${p.dp ?? ""}`.trim();
}
