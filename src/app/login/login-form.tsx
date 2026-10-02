"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui";

export function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => null))?.error ?? "Sign in failed");
      return;
    }
    router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/map");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-[3px] border border-line bg-white p-5">
      <label className="block">
        <span className="mb-1 block text-[11.5px] font-medium text-muted">Email</span>
        <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-9 w-full rounded-[3px] border border-line px-2.5 outline-none focus:border-brand" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11.5px] font-medium text-muted">Password</span>
        <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-9 w-full rounded-[3px] border border-line px-2.5 outline-none focus:border-brand" />
      </label>
      {error && <p className="text-[12px] text-bad">{error}</p>}
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
