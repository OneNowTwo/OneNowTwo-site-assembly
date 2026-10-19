import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getGlobalAssumptions } from "@/lib/opportunity-service";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { AppShell } from "@/components/map/app-shell";
import { getMarketScope } from "@/lib/market-scope";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();
  if (!session) redirect("/login");
  const assumptions = await getGlobalAssumptions();
  /** Selected market scope — not app identity (future: Newcastle / Wollongong / Melbourne). */
  const market = getMarketScope("sydney-metro");
  return (
    <div className="flex h-full">
      <AppSidebar marketLabel={market.headerLabel} email={session.email} />
      <div className="min-w-0 flex-1">
        <Suspense fallback={<div className="h-full bg-canvas">{children}</div>}>
          <AppShell assumptions={assumptions}>{children}</AppShell>
        </Suspense>
      </div>
    </div>
  );
}
