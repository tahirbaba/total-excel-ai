import { requirePin } from "@/lib/server/auth";
import { DOMAIN_RULES, SHEET_SCHEMA, aiErrorMessage, generate, parseModelJSON } from "@/lib/server/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FIX_RULES = `${DOMAIN_RULES}

CORRECTION MODE
You receive the CURRENT purchase sheet JSON and a short correction instruction from the user
(Roman Urdu, Urdu, or English). Apply ONLY the requested change(s) and return the COMPLETE updated sheet JSON.
- Keep every other site, item, value and ordering exactly as it was.
- "kr do / kar do / set karo / change karo" = set the value. "hata do / delete / remove" = delete.
  "add karo / daal do" = add. "sab items / all items" = apply to every item in the scope mentioned.
- Match materials/sites fuzzily (e.g. "cement" matches "Cement OPC", "grove" matches GROVE RESIDENCY).
- If a rate becomes known set needs_review=false (unless other problems remain); if rate is null keep needs_review=true.
- If the instruction is unclear or matches nothing, return the sheet unchanged.`;

export async function POST(req: Request) {
  const denied = requirePin(req);
  if (denied) return denied;

  let body: { sheet?: unknown; instruction?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const instruction = (body.instruction ?? "").trim();
  if (!instruction) return Response.json({ error: "Please type a correction first." }, { status: 400 });
  if (!body.sheet) return Response.json({ error: "Nothing to correct yet." }, { status: 400 });

  try {
    const res = await generate({
      contents: [
        {
          role: "user",
          parts: [
            { text: `CURRENT SHEET JSON:\n${JSON.stringify(body.sheet)}\n\nCORRECTION INSTRUCTION:\n${instruction}` },
          ],
        },
      ],
      config: {
        systemInstruction: FIX_RULES,
        responseMimeType: "application/json",
        responseSchema: SHEET_SCHEMA,
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    return Response.json(parseModelJSON(res.text));
  } catch (e) {
    console.error("fix failed", e);
    return Response.json({ error: aiErrorMessage(e) }, { status: 502 });
  }
}
