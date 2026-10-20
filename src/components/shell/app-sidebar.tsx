"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import styles from "./app-sidebar.module.css";

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
  const [openForPath, setOpenForPath] = useState<string | null>(null);
  const moreOpen = openForPath === path;
  const moreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!moreOpen) return;
    function onDoc(e: MouseEvent) {
      if (!moreRef.current?.contains(e.target as Node)) setOpenForPath(null);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [moreOpen]);

  const secondaryActive = SECONDARY.some((l) => isActive(path, l.href));

  return (
    <aside className={styles.sidebar}>
      <div className="border-b border-white/10 px-4 pb-4 pt-5">
        <Link href="/dashboard" className="block">
          <div className={styles.wordmark}>Site Assembly</div>
          <div className="mt-1 text-[11px] font-medium tracking-wide text-white/55">Development intelligence</div>
        </Link>
        <div className="mt-4 rounded-[6px] border border-white/15 bg-white/5 px-2.5 py-2">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-white/45">Workspace</div>
          <div className="mt-0.5 truncate text-[12.5px] font-semibold text-white">{marketLabel}</div>
        </div>
      </div>

      <nav className={styles.navigation} aria-label="Primary">
        {PRIMARY.map((l) => {
          const active = isActive(path, l.href, "match" in l ? l.match : undefined);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={cx(
                styles.navLink,
                active
                  ? "border-accent bg-white/10 text-white"
                  : "border-transparent text-white/70 hover:bg-white/5 hover:text-white",
              )}
            >
              <NavIcon name={l.label}/>{l.label}
            </Link>
          );
        })}

        <div className="relative mt-1" ref={moreRef}>
          <button
            type="button"
            onClick={() => setOpenForPath((value) => value === path ? null : path)}
            className={cx(
              "w-full rounded-[6px] border-l-[3px] px-3 py-2 text-left text-[13.5px] font-medium transition-colors",
              secondaryActive || moreOpen
                ? "border-white/40 bg-white/5 text-white"
                : "border-transparent text-white/70 hover:bg-white/5 hover:text-white",
            )}
            aria-expanded={moreOpen}
            aria-haspopup="menu"
          >
            <NavIcon name="More"/>More
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
              Sign out
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}

function NavIcon({name}:{name:string}) {
  const paths:Record<string,string>={
    Today:"M3 10 12 3l9 7v10H3Z M9 20v-7h6v7",
    Find:"M15 15l6 6 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
    Map:"m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z M9 3v16 M15 5v16",
    Sites:"M5 3h14v18l-7-4-7 4Z",
    Pipeline:"M3 5h5v14H3Z M10 5h5v10h-5Z M17 5h4v6h-4Z",
    More:"M4 7h16 M4 12h16 M4 17h16"
  };
  return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]||paths.More}/></svg>;
}
