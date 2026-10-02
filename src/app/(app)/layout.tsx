import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { NavLinks } from "@/components/nav-links";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-6 border-b border-[#0b2f49] bg-brand px-4 text-white">
        <div className="text-[13px] font-bold tracking-[0.18em]">SITE ASSEMBLY</div>
        <NavLinks />
        <div className="ml-auto flex items-center gap-3 text-[11.5px] text-white/70">
          <span>NSW · Sydney metro</span>
          <span className="text-white/40">|</span>
          <span>{session.email}</span>
          <form action="/api/auth/logout" method="post">
            <button className="rounded-[3px] px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-white/80 hover:bg-white/10 hover:text-white">Sign out</button>
          </form>
        </div>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
