import "server-only";
import { timingSafeEqual } from "node:crypto";

export function pinMatches(candidate: string | null | undefined): boolean {
  const expected = process.env.APP_PIN || "";
  if (!expected) return false;
  const a = Buffer.from(String(candidate ?? ""));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Returns an error Response when the request's x-app-pin header is wrong, else null. */
export function requirePin(req: Request): Response | null {
  if (!process.env.APP_PIN) {
    return Response.json(
      { error: "Server is missing APP_PIN. Add it in Vercel → Settings → Environment Variables." },
      { status: 500 },
    );
  }
  if (!pinMatches(req.headers.get("x-app-pin"))) {
    return Response.json(
      { error: "Session expired or wrong PIN. Please reload and enter the PIN again." },
      { status: 401 },
    );
  }
  return null;
}
