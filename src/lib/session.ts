import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken, type Session } from "@/lib/auth";

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/** For route handlers: returns the session or a 401 response. */
export async function requireSession(): Promise<Session | NextResponse> {
  const s = await getSession();
  return s ?? NextResponse.json({ error: "Not authenticated" }, { status: 401 });
}

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}
