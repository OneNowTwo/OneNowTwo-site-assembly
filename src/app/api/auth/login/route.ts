import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

const bodySchema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter an email and password." }, { status: 400 });

  const expectedEmail = process.env.AUTH_EMAIL?.trim().toLowerCase();
  const hash = process.env.AUTH_PASSWORD_HASH?.trim();
  if (!expectedEmail || !hash) {
    return NextResponse.json({ error: "Login is not configured: set AUTH_EMAIL and AUTH_PASSWORD_HASH." }, { status: 503 });
  }
  const email = parsed.data.email.trim().toLowerCase();
  const passwordOk = await bcrypt.compare(parsed.data.password, hash);
  if (email !== expectedEmail || !passwordOk) {
    return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
  }

  const user = await prisma.user.upsert({
    where: { email },
    create: { email, lastLoginAt: new Date() },
    update: { lastLoginAt: new Date() },
  });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken({ email, userId: user.id }), sessionCookieOptions);
  return res;
}
