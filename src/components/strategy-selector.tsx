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
  variant = "default",
}: {
  value: DevelopmentStrategy;
  onChange: (v: DevelopmentStrategy) => void;
  tone?: "light" | "dark";
  /** filter = compact ranking filter (Today); default = general control */
  variant?: "default" | "filter";
}) {
  const isFilter = variant === "filter";
  return (
    <div
      className={cx("flex flex-wrap items-center", isFilter ? "gap-1" : "gap-1.5")}
      role="group"
      aria-label="Strategy filter"
    >
      <span
        className={cx(
          "text-[10.5px] font-semibold uppercase tracking-[0.08em]",
          tone === "dark" ? "text-white/65" : "text-muted",
          isFilter && "mr-1",
        )}
      >
        {isFilter ? "Filter" : "Strategy"}
      </span>
      {OPTIONS.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            aria-pressed={active}
            className={cx(
              "rounded-[6px] px-2.5 py-1 text-[11.5px] font-semibold tracking-wide",
              isFilter ? "normal-case" : "uppercase",
              tone === "dark"
                ? active
                  ? "bg-white text-brand"
                  : "bg-white/10 text-white/85 hover:bg-white/20"
                : active
                  ? "bg-brand text-white"
                  : "border border-line bg-panel text-ink hover:bg-canvas",
            )}
          >
            {STRATEGY_LABELS[opt]}
          </button>
        );
      })}
    </div>
  );
}
