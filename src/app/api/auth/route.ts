import { pinMatches } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!process.env.APP_PIN) {
    return Response.json(
      { ok: false, error: "APP_PIN is not configured on the server." },
      { status: 500 },
    );
  }
  let pin = "";
  try {
    pin = String((await req.json())?.pin ?? "");
  } catch {
    /* empty body */
  }
  // Small delay to slow down brute-force guessing.
  await new Promise((r) => setTimeout(r, 400));
  if (!pinMatches(pin)) {
    return Response.json({ ok: false, error: "Wrong PIN" }, { status: 401 });
  }
  return Response.json({ ok: true });
}
