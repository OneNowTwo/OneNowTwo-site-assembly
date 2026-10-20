import type { ReactNode } from "react";
import { cx } from "@/components/ui";

/** Shared page title block — Source Serif display + IBM Plex body. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0 max-w-3xl">
        {eyebrow != null && (
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{eyebrow}</div>
        )}
        <h1 className="font-display mt-1 text-[28px] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
        {description != null && <p className="mt-1.5 max-w-2xl text-[14px] leading-snug text-muted">{description}</p>}
      </div>
      {actions != null && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
