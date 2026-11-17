import type { Part } from "@google/genai";
import { requirePin } from "@/lib/server/auth";
import { DOMAIN_RULES, SHEET_SCHEMA, aiErrorMessage, generate, parseModelJSON } from "@/lib/server/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

interface Body {
  text?: string;
  date?: string;
  defaultPayment?: "Cash" | "Credit";
  files?: { name?: string; mimeType: string; data: string }[];
}

export async function POST(req: Request) {
  const denied = requirePin(req);
  if (denied) return denied;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const text = (body.text ?? "").trim();
  const files = (body.files ?? []).filter((f) => f && ALLOWED.has(f.mimeType) && typeof f.data === "string" && f.data);
  if (!text && files.length === 0) {
    return Response.json({ error: "Please paste a message or upload at least one slip." }, { status: 400 });
  }
  const date = body.date || "";
  const defaultPayment = body.defaultPayment === "Cash" ? "Cash" : "Credit";

  const parts: Part[] = [
    {
      text:
        `SHEET DATE: ${date}\nDEFAULT PAYMENT MODE: ${defaultPayment}\n` +
        `Extract every purchased item from the inputs below into the purchase sheet JSON.\n` +
        (text ? `\n--- WHATSAPP / TEXT MESSAGES ---\n${text}\n--- END TEXT ---\n` : "") +
        (files.length ? `\n${files.length} attached slip(s)/document(s) follow. Extract all line items from each.\n` : ""),
    },
  ];
  for (const f of files) {
    if (f.name) parts.push({ text: `Attachment: ${f.name}` });
    parts.push({ inlineData: { mimeType: f.mimeType, data: f.data } });
  }

  try {
    const res = await generate({
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: DOMAIN_RULES,
        responseMimeType: "application/json",
        responseSchema: SHEET_SCHEMA,
        temperature: 0.1,
        thinkingConfig: { thinkingBudget: files.length ? 1024 : 512 },
      },
    });
    const data = parseModelJSON(res.text);
    if (!data.date) data.date = date;
    return Response.json(data);
  } catch (e) {
    console.error("extract failed", e);
    return Response.json({ error: aiErrorMessage(e) }, { status: 502 });
  }
}
