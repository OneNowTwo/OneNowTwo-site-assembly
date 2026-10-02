import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — Site Assembly" };

export default function LoginPage() {
  return (
    <main className="flex min-h-full items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-[360px]">
        <div className="mb-6">
          <div className="text-[15px] font-bold tracking-[0.18em] text-brand">SITE ASSEMBLY</div>
          <p className="mt-1 text-[12.5px] text-muted">Residential site assembly analysis · NSW</p>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
        <p className="mt-4 text-[11px] leading-relaxed text-muted">Internal tool. Indicative analysis only — not financial, valuation or planning advice.</p>
      </div>
    </main>
  );
}
