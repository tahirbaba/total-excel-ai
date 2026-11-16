# Total Constructors — AI Daily Purchase Sheet Builder

Turns raw WhatsApp messages (Roman Urdu / English / mixed), vendor-slip photos and PDFs into the
**"DAILY PURCHASE SHEET - TOTAL CONSTRUCTORS"** Excel file. You review and correct everything on screen before you download it.

| Layer | Tech |
|---|---|
| UI | Next.js 15 (App Router, TypeScript), Tailwind CSS 4, lucide-react |
| AI | `@google/genai` → `gemini-3.5-flash` (auto-fallback to `gemini-3.8-flash` / `gemini-flash-latest`) with structured JSON output (`/api/extract`, `/api/fix`) |
| Auth | 4-digit PIN (`/api/auth`) checked server-side on every API call |
| Excel | Python serverless function `api/export.py` (openpyxl, stdlib `BaseHTTPRequestHandler`) |
| Hosting | Vercel free tier (zero config — just import the repo) |

## Workflow
1. **PIN gate**: unlock with `APP_PIN`.
2. **Input**: pick the sheet date and default payment mode (Credit/Cash), paste messages, add slips (images are compressed in the browser to 1200 px wide, JPEG quality 0.8), and optionally attach an earlier `.xlsx` to append to.
3. **Review (human-in-the-loop)**: items are grouped into site cards and every field can be edited. Rows with no rate are highlighted yellow; rows missing material or qty are red and block the download. You can type a one-line correction for the AI in Roman Urdu or English. **Approve & Download** generates the `.xlsx` with live Excel formulas.

## Project layout
```
api/export.py                 Python Excel generator (Vercel Python function → /api/export)
requirements.txt              openpyxl (only Python dependency)
src/app/page.tsx              3-state UI (PIN → Input → Review)
src/app/api/{auth,extract,fix}/route.ts
src/components/               PinGate, InputDashboard, ReviewEditor, Combobox
src/lib/                      types, sheet helpers, Gemini prompt + schema
tests/test_export.py          openpyxl unit test
vercel.json                   function config
```

## Local development
```bash
cp .env.example .env.local   # then put your real GEMINI_API_KEY in it
npm install
npm run dev                  # Next.js on :3000
npm run dev:py               # (second terminal) Excel function on :8000 — /api/export is proxied to it in dev
npm run test:py              # Excel generator unit test (needs: pip install openpyxl)
```

## Environment variables
| Name | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio key (free) |
| `APP_PIN` | 4-digit PIN to unlock the app |
| `NEXT_PUBLIC_APP_NAME` | Optional display name |
| `GEMINI_MODEL` | Optional model override |

> Note: Google no longer serves `gemini-2.5-flash` to new API keys, so the app uses the Gemini 3.x Flash family.
