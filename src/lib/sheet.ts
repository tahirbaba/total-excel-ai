import type { Item, PaymentType, RawSheet, Sheet, Site } from "./types";

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export function emptyItem(payment: PaymentType): Item {
  return {
    id: uid(),
    material: "",
    vendor: "",
    uom: "Nos",
    qty: null,
    rate: null,
    payment_type: payment,
    remarks: "",
    needs_review: true,
  };
}

export function emptySite(name = ""): Site {
  return { id: uid(), site_name: name, items: [] };
}

/** Normalise untrusted JSON (from AI) into the editable client state. */
export function hydrate(raw: unknown, fallbackDate: string, defaultPayment: PaymentType): Sheet {
  const r = (raw ?? {}) as Partial<RawSheet>;
  const sites = Array.isArray(r.sites) ? r.sites : [];
  return {
    date: typeof r.date === "string" && /^\d{2}\/\d{2}\/\d{4}$/.test(r.date) ? r.date : fallbackDate,
    sites: sites.map((s) => ({
      id: uid(),
      site_name: String(s?.site_name ?? "").trim().toUpperCase(),
      items: (Array.isArray(s?.items) ? s.items : []).map((it) => {
        const rate = toNum(it?.rate);
        const pt: PaymentType =
          it?.payment_type === "Cash" || it?.payment_type === "Credit"
            ? it.payment_type
            : defaultPayment;
        return {
          id: uid(),
          material: String(it?.material ?? "").trim(),
          vendor: String(it?.vendor ?? "").trim(),
          uom: String(it?.uom ?? "").trim(),
          qty: toNum(it?.qty),
          rate: rate === 0 ? null : rate,
          payment_type: pt,
          remarks: String(it?.remarks ?? "").trim(),
          needs_review: Boolean(it?.needs_review) || rate === null || rate === 0,
        };
      }),
    })),
  };
}

/** Strip client ids before sending to the server. */
export function dehydrate(sheet: Sheet): RawSheet {
  return {
    date: sheet.date,
    sites: sheet.sites.map((s) => ({
      site_name: s.site_name.trim().toUpperCase(),
      items: s.items.map(({ id: _id, ...rest }) => ({
        ...rest,
        needs_review: rest.rate === null,
      })),
    })),
  };
}

export const isRowInvalid = (it: Item) => !it.material.trim() || it.qty === null || it.qty <= 0;
export const isRowMissingRate = (it: Item) => it.rate === null;

export function siteTotals(site: Site) {
  let cash = 0;
  let credit = 0;
  for (const it of site.items) {
    if (it.rate === null || it.qty === null) continue;
    const amt = it.qty * it.rate;
    if (it.payment_type === "Cash") cash += amt;
    else credit += amt;
  }
  return { cash, credit, total: cash + credit };
}

export const fmt = (n: number) =>
  n.toLocaleString("en-PK", { maximumFractionDigits: 2 });

export function todayISO() {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isoToDMY(iso: string) {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

export function dmyToISO(dmy: string) {
  const [d, m, y] = dmy.split("/");
  return y && m && d ? `${y}-${m}-${d}` : todayISO();
}
