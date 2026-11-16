import "server-only";
import { GoogleGenAI, Type, type GenerateContentParameters, type Schema } from "@google/genai";

export const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
// Tried in order when the primary model is overloaded / rate-limited / unavailable.
const FALLBACK_MODELS = ["gemini-3.8-flash", "gemini-flash-latest"];

let client: GoogleGenAI | null = null;
export function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Server is missing GEMINI_API_KEY. Add it in Vercel → Settings → Environment Variables.");
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

export const SHEET_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    date: { type: Type.STRING, description: "DD/MM/YYYY" },
    sites: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          site_name: { type: Type.STRING },
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                material: { type: Type.STRING },
                vendor: { type: Type.STRING },
                uom: { type: Type.STRING },
                qty: { type: Type.NUMBER },
                rate: { type: Type.NUMBER, nullable: true },
                payment_type: { type: Type.STRING, enum: ["Cash", "Credit"] },
                remarks: { type: Type.STRING },
                needs_review: { type: Type.BOOLEAN },
              },
              required: ["material", "vendor", "uom", "qty", "rate", "payment_type", "remarks", "needs_review"],
              propertyOrdering: ["material", "vendor", "uom", "qty", "rate", "payment_type", "remarks", "needs_review"],
            },
          },
        },
        required: ["site_name", "items"],
        propertyOrdering: ["site_name", "items"],
      },
    },
  },
  required: ["date", "sites"],
  propertyOrdering: ["date", "sites"],
};

export const DOMAIN_RULES = `
You work for TOTAL CONSTRUCTORS, a construction company in Karachi, Pakistan. You build the
"DAILY PURCHASE SHEET" from site purchase messages (WhatsApp text in Roman Urdu, English, Hinglish/Urdu mix),
photos of vendor slips/bills, and PDFs.

RULES
1. SITES — Fuzzy-match every site to one of the active sites and use the EXACT spelling below:
   INDUS VALLY SCHOOL, SCB OPS BUILDING, GROVE RESIDENCY, DMC GROUND FLOOR, AKD TOWER, BRENTWOOD, TABBA RESIDENCY.
   (e.g. "indus valley", "IVS" -> INDUS VALLY SCHOOL; "scb", "standard chartered ops" -> SCB OPS BUILDING;
   "grove" -> GROVE RESIDENCY; "dmc" -> DMC GROUND FLOOR; "akd" -> AKD TOWER; "brent wood" -> BRENTWOOD; "tabba" -> TABBA RESIDENCY).
   A genuinely new site is written in UPPERCASE. If no site is mentioned at all, use "UNASSIGNED SITE".
   Group all items of the same site under ONE site object.
2. UNITS (uom) — normalise to exactly one of: Nos, bag, Titan, ltr, pair, Rft, Roll, pkt, KG, Gallon, Length, Cash.
   Examples: bori/bags/bag -> bag; pcs/piece/adad/number/nos -> Nos; litre/liter -> ltr; feet/ft/running feet -> Rft;
   kilo/kg -> KG; packet -> pkt; jora/pair -> pair; lambai/length/pipe length -> Length; titan (tanker/truck load) -> Titan.
   If none fits, choose the closest sensible unit.
3. TRANSPORT / CARRIAGE / RENT (rickshaw, mazda, loader, kiraya, bhara, carriage) — one row:
   material like "Carriage Warehouse to SCB" (describe from -> to if known), uom "Cash", qty 1, rate = the amount.
4. RATE — "rate" is the per-unit price. If only a line total is given, rate = total / qty.
   If NO price/rate/amount is stated, set rate to null (NEVER 0) and needs_review = true.
   needs_review is also true when quantity, material, or site is ambiguous. Otherwise false.
5. PAYMENT — "cash", "naqd", "nakad", "paid", "cash diya" => "Cash"; "credit", "udhaar", "udhar", "account", "khata", "bill pe" => "Credit".
   If not specified use the DEFAULT PAYMENT MODE given by the user.
6. MATERIAL — fix obvious spelling mistakes and use clean Title Case, but keep local Pakistani construction terms
   (e.g. Bajri, Crush, Sariya/Steel Bar, Cement, Rait/Sand, Tiles, Bhusa, Shuttering, Dowel, Teflon Tape, PPR Pipe, Wall Putty).
   Include size/spec in the material (e.g. "PPR Pipe 1\"", "Steel Bar 12mm").
7. VENDOR — shop/supplier name if given, otherwise "".
8. REMARKS — short useful notes only (e.g. who received, bill no.). Otherwise "".
9. Numbers: convert Urdu/English words to numbers ("dhai sau" = 250, "500 ka" means rate/amount 500, "1.5k" = 1500).
10. Never invent items. Ignore greetings, chit-chat and duplicates (the same item repeated in a forwarded message).
11. date — use DD/MM/YYYY. Use the sheet date provided by the user unless told otherwise.
`.trim();

export function parseModelJSON(text: string | undefined) {
  if (!text) throw new Error("AI returned an empty response. Please try again.");
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("AI returned invalid JSON. Please try again.");
  }
}

export function aiErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(msg)) return "Gemini API key is invalid. Check GEMINI_API_KEY in Vercel settings.";
  if (/RESOURCE_EXHAUSTED|429|quota/i.test(msg)) return "Gemini free quota reached for now. Please wait a minute and try again.";
  if (/UNAVAILABLE|503|overloaded/i.test(msg)) return "Gemini is busy right now. Please try again in a few seconds.";
  return msg.length > 300 ? msg.slice(0, 300) + "…" : msg;
}


const isRetryable = (e: unknown) =>
  /UNAVAILABLE|503|overloaded|high demand|RESOURCE_EXHAUSTED|429|NOT_FOUND|404|no longer available|INTERNAL|500/i.test(
    e instanceof Error ? e.message : String(e),
  );

/** generateContent with automatic fallback to other Flash models on overload/quota errors. */
export async function generate(params: Omit<GenerateContentParameters, "model">) {
  const models = Array.from(new Set([MODEL, ...FALLBACK_MODELS]));
  let lastErr: unknown;
  for (const model of models) {
    try {
      return await getClient().models.generateContent({ ...params, model });
    } catch (e) {
      lastErr = e;
      console.warn(`Gemini model ${model} failed, trying next`, e instanceof Error ? e.message.slice(0, 200) : e);
      if (!isRetryable(e)) break;
    }
  }
  throw lastErr;
}
