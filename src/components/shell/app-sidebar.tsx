"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";

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

export function AppSidebar({
  marketLabel,
  email,
}: {
  marketLabel: string;
  email: string;
}) {
  const path = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMoreOpen(false);
  }, [path]);

  useEffect(() => {
    if (!moreOpen) return;
    function onDoc(e: MouseEvent) {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [moreOpen]);

  const secondaryActive = SECONDARY.some((l) => isActive(path, l.href));

  return (
    <aside className="flex w-[220px] shrink-0 flex-col bg-brand text-[#f4f1ea]">
      <div className="border-b border-white/10 px-4 pb-4 pt-5">
        <Link href="/dashboard" className="block">
          <div className="font-display text-[22px] font-semibold leading-none tracking-tight text-white">Site Assembly</div>
          <div className="mt-1 text-[11px] font-medium tracking-wide text-white/55">Development intelligence</div>
        </Link>
        <div className="mt-4 rounded-[6px] border border-white/15 bg-white/5 px-2.5 py-2">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-white/45">Workspace</div>
          <div className="mt-0.5 truncate text-[12.5px] font-semibold text-white">{marketLabel}</div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-2 py-3" aria-label="Primary">
        {PRIMARY.map((l) => {
          const active = isActive(path, l.href, "match" in l ? l.match : undefined);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={cx(
                "rounded-[6px] border-l-[3px] px-3 py-2 text-[13.5px] font-medium transition-colors",
                active
                  ? "border-accent bg-white/10 text-white"
                  : "border-transparent text-white/70 hover:bg-white/5 hover:text-white",
              )}
            >
              {l.label}
            </Link>
          );
        })}

        <div className="relative mt-1" ref={moreRef}>
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className={cx(
              "w-full rounded-[6px] border-l-[3px] px-3 py-2 text-left text-[13.5px] font-medium transition-colors",
              secondaryActive || moreOpen
                ? "border-white/40 bg-white/5 text-white"
                : "border-transparent text-white/70 hover:bg-white/5 hover:text-white",
            )}
            aria-expanded={moreOpen}
            aria-haspopup="menu"
          >
            More
          </button>
          {moreOpen && (
            <div role="menu" className="absolute left-0 right-0 top-full z-50 mt-1 rounded-[6px] border border-line bg-panel py-1 shadow-md">
              {SECONDARY.map((l) => {
                const active = isActive(path, l.href);
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    role="menuitem"
                    className={cx(
                      "block px-3 py-2 text-[12.5px] font-medium",
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

      <div className="mt-auto border-t border-white/10 px-3 py-3">
        <Link href="/feed" className="block rounded-[6px] px-2 py-1.5 text-[12px] text-white/55 hover:bg-white/5 hover:text-white/85">
          Feed
        </Link>
        <Link href="/assumptions" className="block rounded-[6px] px-2 py-1.5 text-[12px] text-white/55 hover:bg-white/5 hover:text-white/85">
          Assumptions
        </Link>
        <div className="mt-2 flex items-center justify-between gap-2 px-2">
          <span className="truncate text-[11px] text-white/45" title={email}>
            {email}
          </span>
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="rounded-[5px] px-1.5 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-white/60 hover:bg-white/10 hover:text-white"
            >
              Out
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
