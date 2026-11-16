"""
Vercel Python Serverless Function: POST /api/export

Builds the "DAILY PURCHASE SHEET - TOTAL CONSTRUCTORS" workbook with openpyxl.

Request JSON:
    {
      "sheet": {"date": "DD/MM/YYYY", "sites": [{"site_name": str, "items": [...]}]},
      "existing_file": "<optional base64 .xlsx to merge into>"
    }
Headers:
    x-app-pin: must equal the APP_PIN environment variable (when APP_PIN is set).

Response: the .xlsx file (binary).

Uses the standard-library BaseHTTPRequestHandler (no FastAPI) to keep the
bundle tiny and cold starts fast. Only dependency: openpyxl.
"""

import base64
import hmac
import io
import json
import os
import re
from http.server import BaseHTTPRequestHandler

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

TITLE = "DAILY PURCHASE SHEET - TOTAL CONSTRUCTORS"
HEADERS = ["Material", "Vendor", "Uom", "Qty", "Rate", "Cash", "Credit", "Total", "Remarks"]
WIDTHS = {"A": 35, "B": 20, "C": 10, "D": 10, "E": 12, "F": 14, "G": 14, "H": 15, "I": 22}
NUM_FMT = "#,##0"
NUM_COLS = (4, 5, 6, 7, 8)  # D..H
MAX_BODY = 6 * 1024 * 1024

GRID = Side(style="thin", color="BFBFBF")
THIN = Side(style="thin", color="000000")
DOUBLE = Side(style="double", color="000000")
GRID_BORDER = Border(left=GRID, right=GRID, top=GRID, bottom=GRID)
FILL_BANNER = PatternFill("solid", start_color="D9D9D9", end_color="D9D9D9")
FILL_HEADER = PatternFill("solid", start_color="F2F2F2", end_color="F2F2F2")
FILL_TOTAL = PatternFill("solid", start_color="F9F9F9", end_color="F9F9F9")
FILL_GRAND = PatternFill("solid", start_color="D9D9D9", end_color="D9D9D9")
BOLD = Font(bold=True)
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
WRAP = Alignment(vertical="center", wrap_text=True)
WRAP_RIGHT = Alignment(horizontal="right", vertical="center", wrap_text=True)


# --------------------------------------------------------------------------- helpers

def _num(v):
    """Convert to a number (int when whole) or None."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        n = float(v)
    else:
        s = re.sub(r"[^0-9.\-]", "", str(v))
        if s in ("", "-", ".", "-."):
            return None
        try:
            n = float(s)
        except ValueError:
            return None
    return int(n) if n.is_integer() else n


def _text(v):
    return "" if v is None else str(v).strip()


def normalize_item(raw):
    rate = _num(raw.get("rate"))
    if rate == 0:
        rate = None
    pt = _text(raw.get("payment_type")).capitalize()
    return {
        "material": _text(raw.get("material")),
        "vendor": _text(raw.get("vendor")),
        "uom": _text(raw.get("uom")),
        "qty": _num(raw.get("qty")),
        "rate": rate,
        "payment_type": pt if pt in ("Cash", "Credit") else "Credit",
        "remarks": _text(raw.get("remarks")),
    }


def normalize_sheet(raw):
    raw = raw or {}
    sites = []
    for s in raw.get("sites") or []:
        name = _text(s.get("site_name")).upper() or "UNASSIGNED SITE"
        items = [normalize_item(i) for i in (s.get("items") or []) if isinstance(i, dict)]
        sites.append({"site_name": name, "items": items})
    return {"date": _text(raw.get("date")), "sites": sites}


# --------------------------------------------------------------------------- merge mode

def parse_existing(xlsx_bytes):
    """Read site blocks back out of a previously generated sheet."""
    wb = load_workbook(io.BytesIO(xlsx_bytes), data_only=False)
    ws = wb.active
    date = ""
    first = _text(ws.cell(1, 1).value)
    m = re.search(r"(\d{1,2}/\d{1,2}/\d{4})", first)
    if m:
        date = m.group(1)

    sites = []
    current = None
    max_row = ws.max_row
    r = 1
    while r <= max_row:
        a = ws.cell(r, 1).value
        a_txt = _text(a)
        next_a = _text(ws.cell(r + 1, 1).value) if r < max_row else ""
        rest_empty = all(ws.cell(r, c).value in (None, "") for c in range(2, 10))

        # Site banner: text in A only, followed by the column header row.
        if a_txt and rest_empty and next_a.lower() == "material":
            current = {"site_name": a_txt.upper(), "items": []}
            sites.append(current)
            r += 2
            continue

        e_txt = _text(ws.cell(r, 5).value).upper()
        if e_txt in ("TOTAL", "GRAND TOTAL") or a_txt.upper() == "GRAND TOTAL":
            current = None
            r += 1
            continue

        if current is not None and (a_txt or ws.cell(r, 4).value not in (None, "")):
            qty = _num(ws.cell(r, 4).value)
            rate = _num(ws.cell(r, 5).value)
            f_val = ws.cell(r, 6).value
            g_val = ws.cell(r, 7).value
            if f_val not in (None, ""):
                payment = "Cash"
                amount = f_val
            elif g_val not in (None, ""):
                payment = "Credit"
                amount = g_val
            else:
                payment, amount = "Credit", None
            # Manually typed amount without a rate -> derive the rate.
            if rate is None and qty and not (isinstance(amount, str) and amount.startswith("=")):
                amt = _num(amount)
                if amt:
                    rate = _num(amt / qty)
            current["items"].append(
                {
                    "material": a_txt,
                    "vendor": _text(ws.cell(r, 2).value),
                    "uom": _text(ws.cell(r, 3).value),
                    "qty": qty,
                    "rate": rate,
                    "payment_type": payment,
                    "remarks": _text(ws.cell(r, 9).value),
                }
            )
        r += 1

    return {"date": date, "sites": sites}


def merge_sheets(existing, new):
    """Merge new items into matching sites (by name), append unknown sites."""
    merged = {"date": new.get("date") or existing.get("date"), "sites": []}
    index = {}
    for s in existing["sites"] + new["sites"]:
        key = re.sub(r"\s+", " ", s["site_name"]).strip().upper()
        if key in index:
            index[key]["items"].extend(s["items"])
        else:
            block = {"site_name": key, "items": list(s["items"])}
            index[key] = block
            merged["sites"].append(block)
    return merged


# --------------------------------------------------------------------------- workbook

def _style_row(ws, r, fill=None, font=None, border=GRID_BORDER):
    for c in range(1, 10):
        cell = ws.cell(r, c)
        if fill:
            cell.fill = fill
        if font:
            cell.font = font
        cell.border = border
        if c in NUM_COLS:
            cell.number_format = NUM_FMT
            cell.alignment = WRAP_RIGHT
        else:
            cell.alignment = WRAP


def build_workbook(sheet):
    wb = Workbook()
    ws = wb.active
    ws.title = "Purchase Sheet"

    for col, w in WIDTHS.items():
        ws.column_dimensions[col].width = w

    # Header block
    ws["A1"] = f"Date: {sheet['date']}"
    ws["A1"].font = BOLD
    ws["A1"].alignment = Alignment(vertical="center")
    ws["B1"] = TITLE
    ws.merge_cells("B1:I1")
    ws["B1"].font = Font(bold=True, size=14)
    ws["B1"].alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 24

    r = 3  # row 2 is left blank
    site_total_rows = []

    for site in sheet["sites"]:
        items = [i for i in site["items"] if i["material"] or i["qty"] is not None]
        if not items:
            continue

        # Site banner
        ws.cell(r, 1, site["site_name"].upper())
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=9)
        for c in range(1, 10):
            cell = ws.cell(r, c)
            cell.fill = FILL_BANNER
            cell.font = BOLD
            cell.alignment = CENTER
            cell.border = Border(
                top=THIN, bottom=THIN, left=THIN if c == 1 else None, right=THIN if c == 9 else None
            )
        ws.row_dimensions[r].height = 20
        r += 1

        # Column headers
        for c, h in enumerate(HEADERS, start=1):
            cell = ws.cell(r, c, h)
            cell.font = BOLD
            cell.fill = FILL_HEADER
            cell.alignment = CENTER
            cell.border = GRID_BORDER
        r += 1

        start = r
        for it in items:
            ws.cell(r, 1, it["material"])
            ws.cell(r, 2, it["vendor"] or None)
            ws.cell(r, 3, it["uom"] or None)
            ws.cell(r, 4, it["qty"])
            if it["rate"] is not None:
                ws.cell(r, 5, it["rate"])
                if it["payment_type"] == "Cash":
                    ws.cell(r, 6, f"=D{r}*E{r}")
                else:
                    ws.cell(r, 7, f"=D{r}*E{r}")
                ws.cell(r, 8, f"=SUM(F{r}:G{r})")
            ws.cell(r, 9, it["remarks"] or None)
            _style_row(ws, r)
            ws.cell(r, 3).alignment = CENTER
            r += 1
        end = r - 1

        # Site total
        ws.cell(r, 5, "TOTAL")
        ws.cell(r, 6, f"=SUM(F{start}:F{end})")
        ws.cell(r, 7, f"=SUM(G{start}:G{end})")
        ws.cell(r, 8, f"=SUM(H{start}:H{end})")
        _style_row(ws, r, fill=FILL_TOTAL, font=BOLD, border=Border(left=GRID, right=GRID, top=THIN, bottom=DOUBLE))
        ws.cell(r, 5).alignment = CENTER
        site_total_rows.append(r)
        r += 2  # one blank row before next site

    # Grand total
    if site_total_rows:
        refs = lambda col: ",".join(f"{col}{tr}" for tr in site_total_rows)
        ws.cell(r, 1, "GRAND TOTAL")
        ws.cell(r, 6, f"=SUM({refs('F')})")
        ws.cell(r, 7, f"=SUM({refs('G')})")
        ws.cell(r, 8, f"=SUM({refs('H')})")
        _style_row(ws, r, fill=FILL_GRAND, font=Font(bold=True, size=12), border=Border(left=THIN, right=THIN, top=THIN, bottom=DOUBLE))
        ws.row_dimensions[r].height = 20

    # Print setup: landscape, fit to one page wide
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_options.horizontalCentered = True

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def generate(payload):
    """Pure function: request payload -> (xlsx bytes, filename)."""
    sheet = normalize_sheet(payload.get("sheet") or payload)
    existing_b64 = payload.get("existing_file")
    if existing_b64:
        if "," in existing_b64[:100]:
            existing_b64 = existing_b64.split(",", 1)[1]
        try:
            existing = parse_existing(base64.b64decode(existing_b64))
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"Could not read the existing .xlsx file: {exc}") from exc
        sheet = merge_sheets(existing, sheet)
    if not sheet["date"]:
        sheet["date"] = ""
    data = build_workbook(sheet)
    safe_date = re.sub(r"[^0-9]+", "-", sheet["date"]).strip("-") or "sheet"
    return data, f"Daily_Purchase_Sheet_{safe_date}.xlsx"


# --------------------------------------------------------------------------- HTTP handler

class handler(BaseHTTPRequestHandler):  # Vercel looks for a class named `handler`
    def _json(self, status, obj):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._json(200, {"ok": True, "service": "excel-export"})

    def do_POST(self):
        expected = os.environ.get("APP_PIN", "")
        if expected and not hmac.compare_digest(self.headers.get("x-app-pin", ""), expected):
            return self._json(401, {"error": "Session expired or wrong PIN. Please reload and enter the PIN again."})

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            return self._json(413 if length > MAX_BODY else 400, {"error": "Invalid or too large request."})

        try:
            payload = json.loads(self.rfile.read(length))
            data, filename = generate(payload)
        except ValueError as exc:
            return self._json(400, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            return self._json(500, {"error": f"Excel generation failed: {exc}"})

        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    # Local dev server: `npm run dev:py` (Next dev rewrites /api/export here)
    from http.server import HTTPServer

    port = int(os.environ.get("PORT", "8000"))
    print(f"Excel export dev server on http://127.0.0.1:{port}/api/export")
    HTTPServer(("127.0.0.1", port), handler).serve_forever()
