"use client";

import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent";
export function Button({ variant = "secondary", size = "md", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-[3px] font-semibold uppercase tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-7 px-2.5 text-[11px]" : "h-9 px-3.5 text-[12px]",
        variant === "primary" && "bg-brand text-white hover:bg-[#0b2f49]",
        variant === "accent" && "bg-accent text-white hover:bg-[#954513]",
        variant === "secondary" && "border border-line bg-white text-ink hover:bg-canvas",
        variant === "ghost" && "text-muted hover:bg-canvas hover:text-ink",
        variant === "danger" && "border border-line bg-white text-bad hover:bg-red-50",
        className,
      )}
    />
  );
}

export function Panel({ title, actions, children, className, bodyClassName }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cx("rounded-[3px] border border-line bg-panel", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{title}</h3>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone, size = "lg" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "bad" | "brand" | "accent"; size?: "lg" | "md" }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">{label}</div>
      <div
        className={cx(
          "num mt-0.5 truncate font-semibold leading-tight",
          size === "lg" ? "text-[24px]" : "text-[17px]",
          tone === "good" && "text-good",
          tone === "bad" && "text-bad",
          tone === "brand" && "text-brand",
          tone === "accent" && "text-accent",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11.5px] text-muted">{sub}</div>}
    </div>
  );
}

export function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: "neutral" | "live" | "demo" | "good" | "bad" | "warn" | "brand" | "official" | "assumption" | "estimate"; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-[2px] px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide",
        tone === "neutral" && "bg-canvas text-muted",
        tone === "live" && "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
        tone === "demo" && "bg-amber-50 text-amber-800 ring-1 ring-amber-300",
        tone === "good" && "bg-emerald-50 text-good",
        tone === "bad" && "bg-red-50 text-bad",
        tone === "warn" && "bg-amber-50 text-amber-800",
        tone === "brand" && "bg-brand-soft text-brand",
        tone === "official" && "bg-sky-50 text-sky-800",
        tone === "assumption" && "bg-violet-50 text-violet-800",
        tone === "estimate" && "bg-stone-100 text-stone-700",
      )}
    >
      {children}
    </span>
  );
}

export function LiveDataBadge({ cached }: { cached?: boolean }) {
  return (
    <Badge tone="live" title={cached ? "Real NSW data served from a saved snapshot" : "Real NSW cadastral and planning data"}>
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
      {cached ? "NSW data · saved snapshot" : "Live NSW data"}
    </Badge>
  );
}

export function DemoFinancialBadge() {
  return (
    <Badge tone="demo" title="Market values and owner details are fictional demonstration figures">
      Demo financial data
    </Badge>
  );
}

export function SourceTag({ kind }: { kind: "OFFICIAL" | "ASSUMPTION" | "ESTIMATE" }) {
  return kind === "OFFICIAL" ? <Badge tone="official">Official data</Badge> : kind === "ASSUMPTION" ? <Badge tone="assumption">User assumption</Badge> : <Badge tone="estimate">System estimate</Badge>;
}

type NumberKind = "money" | "pct" | "number";

function toDisplay(v: number | null | undefined, kind: NumberKind, dp?: number) {
  if (v == null || !Number.isFinite(v)) return "";
  if (kind === "pct") return String(Math.round(v * 100 * 100) / 100);
  if (kind === "money") return Math.round(v).toLocaleString("en-AU");
  return dp != null ? v.toFixed(dp) : String(v);
}

/** Text input for numbers that commits on blur/Enter. Percentages are edited as whole numbers (20 = 20%). */
export function NumberField({
  value,
  onCommit,
  kind = "number",
  placeholder,
  className,
  allowEmpty = true,
  dp,
  suffix,
  ariaLabel,
}: {
  value: number | null | undefined;
  onCommit: (v: number | null) => void;
  kind?: NumberKind;
  placeholder?: string;
  className?: string;
  allowEmpty?: boolean;
  dp?: number;
  suffix?: string;
  ariaLabel?: string;
}) {
  const display = toDisplay(value, kind, dp);
  const [text, setText] = useState(display);
  const [focused, setFocused] = useState(false);
  const [synced, setSynced] = useState(display);
  if (!focused && display !== synced) {
    setSynced(display);
    setText(display);
  }
  const commit = () => {
    setFocused(false);
    const cleaned = text.replace(/[$,%\s]/g, "");
    if (cleaned === "") {
      if (allowEmpty) onCommit(null);
      else setText(toDisplay(value, kind, dp));
      return;
    }
    let n = Number(cleaned.replace(/k$/i, "e3").replace(/m$/i, "e6"));
    if (!Number.isFinite(n)) return setText(toDisplay(value, kind, dp));
    if (kind === "pct") n = n / 100;
    if (n !== value) onCommit(n);
    else setText(display);
  };
  return (
    <div className={cx("flex h-8 items-center rounded-[3px] border border-line bg-white focus-within:border-brand focus-within:ring-1 focus-within:ring-brand", className)}>
      {kind === "money" && <span className="pl-2 text-muted">$</span>}
      <input
        aria-label={ariaLabel}
        className="num h-full w-full min-w-0 bg-transparent px-2 text-right outline-none"
        value={text}
        placeholder={placeholder}
        inputMode="decimal"
        onFocus={() => setFocused(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      {(kind === "pct" || suffix) && <span className="pr-2 text-muted">{kind === "pct" ? "%" : suffix}</span>}
    </div>
  );
}

export function Field({ label, children, hint, tag }: { label: string; children: ReactNode; hint?: ReactNode; tag?: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between gap-2 text-[11.5px] font-medium text-muted">
        <span>{label}</span>
        {tag}
      </span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export function Select<T extends string>({ value, onChange, options, className, ariaLabel }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string; ariaLabel?: string }) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={cx("h-8 rounded-[3px] border border-line bg-white px-2 text-[12.5px] outline-none focus:border-brand", className)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Local text state that resets when the upstream value changes (render-time sync, no effect). */
function useSyncedText(value: string) {
  const [text, setText] = useState(value);
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setText(value);
  }
  return [text, setText] as const;
}

export function TextArea({ value, onCommit, rows = 3, placeholder }: { value: string; onCommit: (v: string) => void; rows?: number; placeholder?: string }) {
  const [text, setText] = useSyncedText(value);
  return (
    <textarea
      rows={rows}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      className="w-full rounded-[3px] border border-line bg-white p-2 text-[12.5px] outline-none focus:border-brand"
    />
  );
}

export function TextInput({ value, onCommit, placeholder, className }: { value: string; onCommit: (v: string) => void; placeholder?: string; className?: string }) {
  const [text, setText] = useSyncedText(value);
  return (
    <input
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className={cx("h-8 w-full rounded-[3px] border border-line bg-white px-2 text-[12.5px] outline-none focus:border-brand", className)}
    />
  );
}

export function ScoreBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="text-muted">—</span>;
  const tone = score >= 65 ? "bg-good" : score >= 45 ? "bg-amber-600" : "bg-bad";
  return <span className={cx("num inline-flex h-6 min-w-9 items-center justify-center rounded-[3px] px-1.5 text-[12px] font-bold text-white", tone)}>{score}</span>;
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cx("h-1.5 w-full overflow-hidden rounded-full bg-canvas", className)}>
      <div className="h-full bg-brand" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}
