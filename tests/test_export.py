"""Quick unit test for api/export.py — run: python3 tests/test_export.py"""
import base64
import io
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))
from openpyxl import load_workbook  # noqa: E402

import export  # noqa: E402

MOCK = {
    "sheet": {
        "date": "16/11/2026",
        "sites": [
            {
                "site_name": "SCB OPS BUILDING",
                "items": [
                    {"material": "Cement", "vendor": "Lucky", "uom": "bag", "qty": 200, "rate": 1450,
                     "payment_type": "Credit", "remarks": "", "needs_review": False},
                    {"material": "Carriage Warehouse to SCB", "vendor": "", "uom": "Cash", "qty": 1, "rate": 14000,
                     "payment_type": "Cash", "remarks": "", "needs_review": False},
                    {"material": "Wall Putty", "vendor": "", "uom": "bag", "qty": 10, "rate": None,
                     "payment_type": "Cash", "remarks": "rate pending", "needs_review": True},
                ],
            },
            {
                "site_name": "grove residency",
                "items": [
                    {"material": "PPR Pipe 1\"", "vendor": "Al Noor", "uom": "Length", "qty": 25, "rate": 850,
                     "payment_type": "Cash", "remarks": "", "needs_review": False},
                ],
            },
        ],
    }
}


def main():
    data, name = export.generate(MOCK)
    assert name == "Daily_Purchase_Sheet_16-11-2026.xlsx", name
    path = os.path.join(tempfile.mkdtemp(), name)
    with open(path, "wb") as f:
        f.write(data)
    try:
        ws = load_workbook(path).active
        assert ws["A1"].value == "Date: 16/11/2026"
        assert ws["B1"].value == export.TITLE and "B1:I1" in ws.merged_cells
        assert ws["A3"].value == "SCB OPS BUILDING" and "A3:I3" in ws.merged_cells
        assert [ws.cell(4, c).value for c in range(1, 10)] == export.HEADERS
        # Credit row
        assert ws["F5"].value is None and ws["G5"].value == "=D5*E5" and ws["H5"].value == "=SUM(F5:G5)"
        # Cash row
        assert ws["F6"].value == "=D6*E6" and ws["G6"].value is None
        # Null-rate row stays blank
        assert all(ws.cell(7, c).value is None for c in (5, 6, 7, 8))
        # Site total
        assert ws["E8"].value == "TOTAL" and ws["F8"].value == "=SUM(F5:F7)" and ws["H8"].value == "=SUM(H5:H7)"
        assert ws["F8"].border.bottom.style == "double"
        # Second site (row 9 blank)
        assert ws["A9"].value is None and ws["A10"].value == "GROVE RESIDENCY"
        assert ws["E13"].value == "TOTAL"
        assert ws["A15"].value == "GRAND TOTAL" and ws["H15"].value == "=SUM(H8,H13)"
        assert ws["D5"].number_format == "#,##0"
        assert ws.column_dimensions["A"].width == 35

        # Merge mode: add to an existing site + a new site
        more = {
            "sheet": {"date": "16/11/2026", "sites": [
                {"site_name": "SCB OPS BUILDING", "items": [
                    {"material": "Sand", "vendor": "", "uom": "Titan", "qty": 2, "rate": 9000, "payment_type": "Cash", "remarks": ""}]},
                {"site_name": "AKD TOWER", "items": [
                    {"material": "Tiles", "vendor": "", "uom": "Nos", "qty": 40, "rate": None, "payment_type": "Credit", "remarks": ""}]},
            ]},
            "existing_file": base64.b64encode(data).decode(),
        }
        merged = export.parse_existing(data)
        assert len(merged["sites"]) == 2 and len(merged["sites"][0]["items"]) == 3
        assert merged["sites"][0]["items"][0]["payment_type"] == "Credit"
        assert merged["sites"][0]["items"][1]["payment_type"] == "Cash"
        data2, _ = export.generate(more)
        ws2 = load_workbook(io.BytesIO(data2)).active
        names = [ws2.cell(r, 1).value for r in range(1, ws2.max_row + 1)]
        assert names.count("SCB OPS BUILDING") == 1
        assert "AKD TOWER" in names and "Sand" in names and "GROVE RESIDENCY" in names
        scb_items = names[names.index("SCB OPS BUILDING") + 2: names.index("SCB OPS BUILDING") + 6]
        assert scb_items == ["Cement", "Carriage Warehouse to SCB", "Wall Putty", "Sand"], scb_items
        print("OK: export.py generates valid .xlsx with formulas; merge mode works")
    finally:
        os.remove(path)
        os.rmdir(os.path.dirname(path))


if __name__ == "__main__":
    main()
