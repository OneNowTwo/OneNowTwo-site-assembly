import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "sa_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set (min 16 chars) in production");
    return new TextEncoder().encode("dev-only-insecure-session-secret");
  }
  return new TextEncoder().encode(s);
}

export interface Session {
  email: string;
  userId: string;
}

export async function createSessionToken(s: Session): Promise<string> {
  return new SignJWT({ email: s.email, uid: s.userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (typeof payload.email !== "string" || typeof payload.uid !== "string") return null;
    return { email: payload.email, userId: payload.uid };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};
