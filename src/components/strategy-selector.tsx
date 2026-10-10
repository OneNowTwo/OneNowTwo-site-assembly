"use client";

import { cx } from "@/components/ui";
import {
  STRATEGY_LABELS,
  type DevelopmentStrategy,
} from "@/lib/source-watcher/strategy-profile";

const OPTIONS: DevelopmentStrategy[] = ["APARTMENTS", "CO_LIVING", "TOWNHOUSES", "GENERAL_RESIDENTIAL"];

export function StrategySelector({
  value,
  onChange,
  tone = "light",
}: {
  value: DevelopmentStrategy;
  onChange: (v: DevelopmentStrategy) => void;
  tone?: "light" | "dark";
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={cx("text-[10.5px] font-semibold uppercase tracking-[0.08em]", tone === "dark" ? "text-white/65" : "text-muted")}>
        Strategy
      </span>
      {OPTIONS.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={cx(
              "rounded-[3px] px-2 py-1 text-[11px] font-semibold uppercase tracking-wide",
              tone === "dark"
                ? active
                  ? "bg-white text-brand"
                  : "bg-white/10 text-white/85 hover:bg-white/20"
                : active
                  ? "bg-brand text-white"
                  : "border border-line bg-white text-ink hover:bg-canvas",
            )}
          >
            {STRATEGY_LABELS[opt]}
          </button>
        );
      })}
    </div>
  );
}
