"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { cx } from "@/components/ui";

/** Selectable list row used on Today / Find — colour marks selection, not decoration. */
export function ListRow({
  children,
  selected,
  onSelect,
  className,
  trailing,
}: {
  children: ReactNode;
  selected?: boolean;
  onSelect?: () => void;
  className?: string;
  trailing?: ReactNode;
}) {
  const interactive = !!onSelect;
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={
        interactive
          ? (e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect?.();
              }
            }
          : undefined
      }
      className={cx(
        "grid grid-cols-[1fr_auto] gap-3 border-b border-line px-3 py-3 last:border-b-0 sm:px-4",
        interactive && "cursor-pointer transition-colors",
        selected ? "bg-accent-soft/70 ring-1 ring-inset ring-accent/40" : interactive && "hover:bg-brand-soft/40",
        className,
      )}
    >
      <div className="min-w-0">{children}</div>
      {trailing != null && <div className="shrink-0 self-center">{trailing}</div>}
    </div>
  );
}
