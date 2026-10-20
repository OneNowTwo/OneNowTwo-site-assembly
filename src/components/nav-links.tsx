"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";

/** Primary labels — keep in sync with AppSidebar and tests/phase3-helpers. */
export const PRIMARY_NAV_LABELS = ["Today", "Find", "Map", "Sites", "Pipeline"] as const;

const PRIMARY = [
  { href: "/dashboard", label: "Today" },
  { href: "/find", label: "Find", match: ["/find", "/radar"] },
  { href: "/map", label: "Map" },
  { href: "/opportunities", label: "Sites" },
  { href: "/acquisitions", label: "Pipeline" },
] as const;

const SECONDARY = [
  { href: "/feed", label: "Feed" },
  { href: "/watching", label: "Watching" },
  { href: "/morning-report", label: "Morning Report" },
  { href: "/alerts", label: "Alerts" },
  { href: "/assumptions", label: "Assumptions" },
  { href: "/radar", label: "Radar (legacy)" },
] as const;

function isActive(path: string, href: string, match?: readonly string[]) {
  const prefixes = match ?? [href];
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Legacy horizontal nav (unused by AppSidebar shell; retained for compatibility). */
export function NavLinks() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setOpen(false);
  }, [path]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const secondaryActive = SECONDARY.some((l) => isActive(path, l.href));

  return (
    <nav className="flex h-full items-stretch">
      {PRIMARY.map((l) => {
        const active = isActive(path, l.href, "match" in l ? l.match : undefined);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cx(
              "flex items-center border-b-2 px-3 text-[11.5px] font-semibold uppercase tracking-[0.1em]",
              active ? "border-accent text-white" : "border-transparent text-white/65 hover:text-white",
            )}
          >
            {l.label}
          </Link>
        );
      })}
      <div className="relative flex items-stretch" ref={menuRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cx(
            "flex items-center border-b-2 px-3 text-[11.5px] font-semibold uppercase tracking-[0.1em]",
            secondaryActive || open ? "border-white/70 text-white" : "border-transparent text-white/65 hover:text-white",
          )}
          aria-expanded={open}
          aria-haspopup="menu"
        >
          More
        </button>
        {open && (
          <div role="menu" className="absolute left-0 top-full z-50 mt-0 min-w-[200px] border border-line bg-panel py-1 shadow-md">
            {SECONDARY.map((l) => {
              const active = isActive(path, l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  role="menuitem"
                  className={cx(
                    "block px-3 py-2 text-[12px] font-medium",
                    active ? "bg-brand-soft text-brand" : "text-ink hover:bg-canvas",
                  )}
                >
                  {l.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </nav>
  );
}
