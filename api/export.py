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
import zipfile
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, quote

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

HEADER_ALIASES = {
    "material": ("material", "materials", "item", "items", "description", "particulars"),
    "vendor": ("vendor", "supplier", "party", "shop"),
    "uom": ("uom", "unit", "units", "u.o.m", "u/m"),
    "qty": ("qty", "quantity", "qty.", "nos"),
    "rate": ("rate", "price", "unit price", "rate/unit"),
    "cash": ("cash",),
    "credit": ("credit", "udhaar", "udhar"),
    "total": ("total", "amount", "amt"),
    "remarks": ("remarks", "remark", "note", "notes", "comments"),
}
DATE_RE = re.compile(r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})")


def _norm_header(v):
    return re.sub(r"\s+", " ", _text(v).lower()).strip(" :")


def _header_map(ws, r):
    """If row r is a column-header row, return {field: column}, else None."""
    cmap = {}
    for c in range(1, min(ws.max_column, 30) + 1):
        h = _norm_header(ws.cell(r, c).value)
        if not h:
            continue
        for field, names in HEADER_ALIASES.items():
            if field not in cmap and h in names:
                cmap[field] = c
                break
    if "material" in cmap and ("qty" in cmap or "rate" in cmap):
        return cmap
    return None


def _row_texts(ws, r):
    return [(c, _text(ws.cell(r, c).value)) for c in range(1, min(ws.max_column, 30) + 1) if _text(ws.cell(r, c).value)]


def _find_date(ws):
    for r in range(1, min(ws.max_row, 6) + 1):
        for c in range(1, min(ws.max_column, 12) + 1):
            v = ws.cell(r, c).value
            if hasattr(v, "strftime"):
                return v.strftime("%d/%m/%Y")
            m = DATE_RE.search(_text(v))
            if m:
                d, mo, y = m.groups()
                y = ("20" + y) if len(y) == 2 else y
                return f"{int(d):02d}/{int(mo):02d}/{y}"
    return ""


def parse_existing(xlsx_bytes):
    """Read site blocks out of an existing purchase sheet.

    Works with sheets made by this app and with hand-made sheets in the same
    style: columns are located by their header names (Material, Vendor, Uom,
    Qty, Rate, Cash, Credit, Total, Remarks), the site name is the banner text
    just above each header row, and a block ends at its TOTAL row.
    """
    wb_f = load_workbook(io.BytesIO(xlsx_bytes), data_only=False)
    wb_v = load_workbook(io.BytesIO(xlsx_bytes), data_only=True)
    ws, wsv = wb_f.active, wb_v.active
    date = _find_date(ws)

    sites = []
    current, cmap = None, None
    for r in range(1, ws.max_row + 1):
        hm = _header_map(ws, r)
        if hm:
            # Site name = nearest row above with a single short text (the banner)
            name = ""
            for up in range(r - 1, max(r - 4, 0), -1):
                texts = _row_texts(ws, up)
                if len(texts) == 1 and not DATE_RE.search(texts[0][1]) and "PURCHASE SHEET" not in texts[0][1].upper():
                    name = texts[0][1]
                    break
                if texts:
                    break
            current = {"site_name": (name or "UNASSIGNED SITE").upper(), "items": []}
            sites.append(current)
            cmap = hm
            continue
        if current is None:
            continue

        texts = _row_texts(ws, r)
        if not texts:
            continue
        if any(t.strip().upper() in ("TOTAL", "GRAND TOTAL", "SITE TOTAL", "TOTAL:") for _, t in texts):
            current, cmap = None, None
            continue

        def raw(field):
            c = cmap.get(field)
            return ws.cell(r, c).value if c else None

        def val(field):
            c = cmap.get(field)
            return wsv.cell(r, c).value if c else None

        material = _text(raw("material"))
        qty = _num(val("qty") if val("qty") is not None else raw("qty"))
        if not material and qty is None:
            continue
        rate = _num(val("rate") if val("rate") is not None else raw("rate"))
        cash_raw, credit_raw = raw("cash"), raw("credit")
        if cash_raw not in (None, ""):
            payment, amount = "Cash", _num(val("cash"))
        elif credit_raw not in (None, ""):
            payment, amount = "Credit", _num(val("credit"))
        else:
            payment, amount = "Credit", None
        # Amount typed by hand without a rate -> derive the per-unit rate.
        if rate is None and qty and amount:
            rate = _num(round(amount / qty, 2))
        current["items"].append(
            {
                "material": material,
                "vendor": _text(raw("vendor")),
                "uom": _text(raw("uom")),
                "qty": qty,
                "rate": rate if rate else None,
                "payment_type": payment,
                "remarks": _text(raw("remarks")),
            }
        )

    sites = [s for s in sites if s["items"]]
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
    cached = {}  # cell ref -> computed value, stored next to each formula
    site_sums = []

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
        s_cash = s_credit = 0
        for it in items:
            ws.cell(r, 1, it["material"])
            ws.cell(r, 2, it["vendor"] or None)
            ws.cell(r, 3, it["uom"] or None)
            ws.cell(r, 4, it["qty"])
            if it["rate"] is not None:
                ws.cell(r, 5, it["rate"])
                amt = _num((it["qty"] or 0) * it["rate"]) or 0
                if it["payment_type"] == "Cash":
                    ws.cell(r, 6, f"=D{r}*E{r}")
                    cached[f"F{r}"] = amt
                    s_cash += amt
                else:
                    ws.cell(r, 7, f"=D{r}*E{r}")
                    cached[f"G{r}"] = amt
                    s_credit += amt
                ws.cell(r, 8, f"=SUM(F{r}:G{r})")
                cached[f"H{r}"] = amt
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
        cached[f"F{r}"], cached[f"G{r}"], cached[f"H{r}"] = s_cash, s_credit, s_cash + s_credit
        site_sums.append((s_cash, s_credit))
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
        g_cash = sum(c for c, _ in site_sums)
        g_credit = sum(c for _, c in site_sums)
        cached[f"F{r}"], cached[f"G{r}"], cached[f"H{r}"] = g_cash, g_credit, g_cash + g_credit
        _style_row(ws, r, fill=FILL_GRAND, font=Font(bold=True, size=12), border=Border(left=THIN, right=THIN, top=THIN, bottom=DOUBLE))
        ws.row_dimensions[r].height = 20

    # Print setup: landscape, fit to one page wide
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_options.horizontalCentered = True

    wb.properties.creator = "Total Constructors"
    wb.properties.title = TITLE
    buf = io.BytesIO()
    wb.save(buf)
    return _inject_cached_values(buf.getvalue(), cached)


def _fmt_num(v):
    v = _num(v) or 0
    return str(int(v)) if float(v).is_integer() else repr(float(v))


def _inject_cached_values(xlsx, cached):
    """openpyxl writes formulas with an empty <v></v>. Excel recalculates them,
    but mobile viewers (WhatsApp / iOS Files / Google preview / some Android
    apps) only show the stored value, so totals looked blank or the file looked
    broken. We store the computed result next to every formula we wrote."""
    src = zipfile.ZipFile(io.BytesIO(xlsx))
    out = io.BytesIO()
    pattern = re.compile(r'<c r="([A-Z]+[0-9]+)"([^>]*)><f>([^<]*)</f><v\s*/?>(?:</v>)?</c>')

    def fill(m):
        ref, attrs, formula = m.group(1), m.group(2), m.group(3)
        attrs = re.sub(r'\s+t="[^"]*"', "", attrs)
        if ref in cached:
            return f'<c r="{ref}"{attrs}><f>{formula}</f><v>{_fmt_num(cached[ref])}</v></c>'
        return f'<c r="{ref}"{attrs}><f>{formula}</f></c>'

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename.startswith("xl/worksheets/sheet") and info.filename.endswith(".xml"):
                data = pattern.sub(fill, data.decode("utf-8")).encode("utf-8")
            dst.writestr(info, data)
    return out.getvalue()


def safe_filename(name, date):
    base = _text(name)
    base = re.sub(r"\.xlsx?$", "", base, flags=re.I)
    base = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "", base).strip(" .")[:120]
    if not base:
        base = "Daily_Purchase_Sheet_" + (re.sub(r"[^0-9]+", "-", date).strip("-") or "sheet")
    return base + ".xlsx"


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
    return data, safe_filename(payload.get("filename"), sheet["date"])


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
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            return self._json(413 if length > MAX_BODY else 400, {"error": "Invalid or too large request."})

        raw = self.rfile.read(length)
        pin = self.headers.get("x-app-pin", "")
        is_form = "application/x-www-form-urlencoded" in (self.headers.get("Content-Type") or "")
        try:
            if is_form:
                # Plain HTML form POST: the browser's own download manager saves the
                # file. Most reliable path on phones and in-app (WhatsApp) browsers.
                form = parse_qs(raw.decode("utf-8"))
                pin = (form.get("pin") or [""])[0]
                payload = json.loads((form.get("payload") or ["{}"])[0])
            else:
                payload = json.loads(raw)
        except Exception:  # noqa: BLE001
            return self._json(400, {"error": "Invalid request body."})

        expected = os.environ.get("APP_PIN", "")
        if expected and not hmac.compare_digest(pin.encode(), expected.encode()):
            return self._json(401, {"error": "Session expired or wrong PIN. Please reload and enter the PIN again."})

        if payload.get("action") == "parse":
            try:
                b64 = _text(payload.get("existing_file"))
                if "," in b64[:100]:
                    b64 = b64.split(",", 1)[1]
                return self._json(200, parse_existing(base64.b64decode(b64)))
            except Exception as exc:  # noqa: BLE001
                return self._json(400, {"error": f"Could not read this .xlsx file: {exc}"})

        try:
            data, filename = generate(payload)
        except ValueError as exc:
            return self._json(400, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            return self._json(500, {"error": f"Excel generation failed: {exc}"})

        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        ascii_name = filename.encode("ascii", "ignore").decode() or "Daily_Purchase_Sheet.xlsx"
        self.send_header(
            "Content-Disposition",
            f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}",
        )
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
