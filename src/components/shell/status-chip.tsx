import type { ReactNode } from "react";
import { cx } from "@/components/ui";

type ChipTone = "neutral" | "zone" | "fsr" | "height" | "proposed" | "good" | "review" | "warn" | "brand";

const TONE: Record<ChipTone, string> = {
  neutral: "bg-canvas text-muted",
  zone: "bg-[#f3e4e6] text-[#7a3b45]",
  fsr: "bg-[#e4eef3] text-[#2a4f5c]",
  height: "bg-[#ece8f3] text-[#4a3d6b]",
  proposed: "bg-[#f5e6d4] text-[#8a5520]",
  good: "bg-[#e4f0e8] text-good",
  review: "bg-accent-soft text-warn",
  warn: "bg-amber-50 text-amber-900",
  brand: "bg-brand-soft text-brand",
};

/** Compact planning / status chip — muted fills, not decorative pills. */
export function StatusChip({
  children,
  tone = "neutral",
  title,
  className,
}: {
  children: ReactNode;
  tone?: ChipTone;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center whitespace-nowrap rounded-[5px] px-1.5 py-0.5 text-[11px] font-semibold tracking-wide",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Circular screening score as in the warm-stone concept. */
export function ScoreRing({
  score,
  label,
}: {
  score: number | null | undefined;
  label?: string;
}) {
  if (score == null) return <span className="text-muted">—</span>;
  const good = score >= 55;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div
        className={cx(
          "num flex h-12 w-12 items-center justify-center rounded-full border-2 text-[15px] font-semibold",
          good ? "border-good/50 bg-[#e4f0e8] text-good" : "border-accent/60 bg-accent-soft text-warn",
        )}
      >
        {Math.round(score)}
      </div>
      {label != null && (
        <div className={cx("max-w-[72px] text-center text-[10px] font-medium leading-tight", good ? "text-good" : "text-warn")}>
          {label}
        </div>
      )}
    </div>
  );
}
