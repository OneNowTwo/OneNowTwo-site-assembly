"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

const LINKS = [
  { href: "/dashboard", label: "Today" },
  { href: "/feed", label: "Feed" },
  { href: "/watching", label: "Watching" },
  { href: "/morning-report", label: "Report" },
  { href: "/map", label: "Map" },
  { href: "/radar", label: "Radar" },
  { href: "/opportunities", label: "Opportunities" },
  { href: "/acquisitions", label: "Acquisitions" },
  { href: "/alerts", label: "Alerts" },
  { href: "/assumptions", label: "Assumptions" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="flex h-full items-stretch">
      {LINKS.map((l) => {
        const active = path === l.href || path.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cx(
              "flex items-center border-b-2 px-3 text-[11.5px] font-semibold uppercase tracking-[0.1em]",
              active ? "border-white text-white" : "border-transparent text-white/65 hover:text-white",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
