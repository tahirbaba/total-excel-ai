"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Loader2,
  Plus,
  Trash2,
  Wand2,
} from "lucide-react";
import { useState } from "react";
import Combobox from "./Combobox";
import { dmyToISO, emptyItem, emptySite, fmt, isRowInvalid, isRowMissingRate, isoToDMY, siteTotals } from "@/lib/sheet";
import type { Item, PaymentType, Sheet, Site } from "@/lib/types";

export interface OptionList {
  options: string[];
  add: (v: string) => void;
}

interface Props {
  sheet: Sheet;
  setSheet: (updater: (s: Sheet) => Sheet) => void;
  defaultPayment: PaymentType;
  sites: OptionList;
  vendors: OptionList;
  uoms: OptionList;
  existingName?: string;
  onBack: () => void;
  onFix: (instruction: string) => Promise<void>;
  onExport: () => Promise<void>;
}

const numOrNull = (v: string): number | null => {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function Badge({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <span className={`inline-flex items-baseline gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
      {label}
      <span className="font-bold tabular-nums">{fmt(value)}</span>
    </span>
  );
}

function ItemRow({
  item,
  update,
  remove,
  vendors,
  uoms,
}: {
  item: Item;
  update: (patch: Partial<Item>) => void;
  remove: () => void;
  vendors: OptionList;
  uoms: OptionList;
}) {
  const invalid = isRowInvalid(item);
  const noRate = isRowMissingRate(item);
  const tone = invalid
    ? "bg-red-50 border-red-300"
    : noRate
      ? "bg-yellow-50 border-yellow-300"
      : "bg-white border-slate-200";
  const amount = item.qty !== null && item.rate !== null ? item.qty * item.rate : null;
  const lbl = "text-[11px] font-medium text-slate-500 md:hidden";

  return (
    <div className={`grid grid-cols-2 gap-2 rounded-lg border p-2 md:grid-cols-[2.2fr_1.4fr_0.9fr_0.8fr_0.9fr_1fr_1.4fr_auto] md:items-center md:gap-1.5 md:rounded-none md:border-x-0 md:border-t-0 md:p-1.5 ${tone}`}>
      <label className="col-span-2 md:col-span-1">
        <span className={lbl}>Material</span>
        <input
          className={`field ${!item.material.trim() ? "border-red-400" : ""}`}
          value={item.material}
          placeholder="Material *"
          onChange={(e) => update({ material: e.target.value })}
        />
      </label>
      <label className="col-span-2 md:col-span-1">
        <span className={lbl}>Vendor</span>
        <Combobox
          value={item.vendor}
          onChange={(v) => update({ vendor: v })}
          options={vendors.options}
          onNewOption={vendors.add}
          placeholder="Vendor"
          ariaLabel="Vendor"
        />
      </label>
      <label>
        <span className={lbl}>UoM</span>
        <Combobox
          value={item.uom}
          onChange={(v) => update({ uom: v })}
          options={uoms.options}
          onNewOption={uoms.add}
          placeholder="UoM"
          ariaLabel="Unit"
        />
      </label>
      <label>
        <span className={lbl}>Qty</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          className={`field text-right tabular-nums ${item.qty === null || item.qty <= 0 ? "border-red-400" : ""}`}
          value={item.qty ?? ""}
          placeholder="Qty *"
          onChange={(e) => update({ qty: numOrNull(e.target.value) })}
        />
      </label>
      <label>
        <span className={lbl}>Rate</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          className={`field text-right tabular-nums ${noRate ? "border-yellow-400 bg-yellow-50" : ""}`}
          value={item.rate ?? ""}
          placeholder="Rate ?"
          onChange={(e) => {
            const rate = numOrNull(e.target.value);
            update({ rate, needs_review: rate === null });
          }}
        />
        {amount !== null && (
          <span className="mt-0.5 block text-right text-[11px] tabular-nums text-slate-500">= {fmt(amount)}</span>
        )}
      </label>
      <label>
        <span className={lbl}>Payment</span>
        <select
          className={`field font-medium ${item.payment_type === "Cash" ? "text-emerald-700" : "text-indigo-700"}`}
          value={item.payment_type}
          onChange={(e) => update({ payment_type: e.target.value as PaymentType })}
        >
          <option value="Credit">Credit</option>
          <option value="Cash">Cash</option>
        </select>
      </label>
      <label className="col-span-2 md:col-span-1">
        <span className={lbl}>Remarks</span>
        <input
          className="field"
          value={item.remarks}
          placeholder="Remarks"
          onChange={(e) => update({ remarks: e.target.value })}
        />
      </label>
      <div className="col-span-2 flex justify-end md:col-span-1">
        <button
          type="button"
          aria-label="Delete item"
          onClick={remove}
          className="rounded-md p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function SiteCard({
  site,
  index,
  setSite,
  removeSite,
  defaultPayment,
  sites,
  vendors,
  uoms,
}: {
  site: Site;
  index: number;
  setSite: (fn: (s: Site) => Site) => void;
  removeSite: () => void;
  defaultPayment: PaymentType;
  sites: OptionList;
  vendors: OptionList;
  uoms: OptionList;
}) {
  const t = siteTotals(site);
  const issues = site.items.filter((i) => isRowInvalid(i)).length;
  const pending = site.items.filter((i) => !isRowInvalid(i) && isRowMissingRate(i)).length;

  return (
    <section className="card overflow-visible">
      <header className="flex flex-col gap-3 rounded-t-xl border-b border-slate-200 bg-slate-100 p-3 sm:flex-row sm:items-center">
        <span className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-bold text-white sm:flex">
          {index + 1}
        </span>
        <Combobox
          className="w-full sm:max-w-xs"
          inputClassName={`font-bold uppercase ${!site.site_name.trim() ? "border-red-400" : ""}`}
          value={site.site_name}
          onChange={(v) => setSite((s) => ({ ...s, site_name: v }))}
          options={sites.options}
          onNewOption={sites.add}
          placeholder="SITE NAME"
          uppercase
          ariaLabel="Site name"
        />
        <div className="flex flex-1 flex-wrap items-center gap-1.5 sm:justify-end">
          <Badge label="Cash" value={t.cash} tone="bg-emerald-50 text-emerald-700" />
          <Badge label="Credit" value={t.credit} tone="bg-indigo-50 text-indigo-700" />
          <Badge label="Total" value={t.total} tone="bg-slate-800 text-white" />
          <button
            type="button"
            aria-label="Delete site"
            title="Delete this site"
            onClick={() => {
              if (site.items.length === 0 || confirm(`Delete ${site.site_name || "this site"} and all its items?`)) removeSite();
            }}
            className="ml-1 rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </header>

      {(issues > 0 || pending > 0) && (
        <div className="flex flex-wrap gap-3 border-b border-slate-100 px-3 py-1.5 text-xs">
          {issues > 0 && <span className="text-red-600">● {issues} row(s) missing material/qty</span>}
          {pending > 0 && <span className="text-yellow-700">● {pending} row(s) need a rate</span>}
        </div>
      )}

      <div className="hidden grid-cols-[2.2fr_1.4fr_0.9fr_0.8fr_0.9fr_1fr_1.4fr_auto] gap-1.5 border-b border-slate-200 bg-slate-50 px-1.5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 md:grid">
        <span>Material</span>
        <span>Vendor</span>
        <span>UoM</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Rate</span>
        <span>Payment</span>
        <span>Remarks</span>
        <span className="w-8" />
      </div>

      <div className="space-y-2 p-2 md:space-y-0 md:p-0">
        {site.items.map((it) => (
          <ItemRow
            key={it.id}
            item={it}
            vendors={vendors}
            uoms={uoms}
            update={(patch) =>
              setSite((s) => ({ ...s, items: s.items.map((x) => (x.id === it.id ? { ...x, ...patch } : x)) }))
            }
            remove={() => setSite((s) => ({ ...s, items: s.items.filter((x) => x.id !== it.id) }))}
          />
        ))}
        {site.items.length === 0 && <p className="p-4 text-center text-sm text-slate-400">No items yet.</p>}
      </div>

      <div className="p-2">
        <button
          type="button"
          className="btn btn-ghost w-full border-dashed py-1.5 sm:w-auto"
          onClick={() => setSite((s) => ({ ...s, items: [...s.items, emptyItem(defaultPayment)] }))}
        >
          <Plus className="h-4 w-4" /> Add Item
        </button>
      </div>
    </section>
  );
}

export default function ReviewEditor(p: Props) {
  const [instruction, setInstruction] = useState("");
  const [fixing, setFixing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const allItems = p.sheet.sites.flatMap((s) => s.items);
  const invalidCount = allItems.filter(isRowInvalid).length;
  const noRateCount = allItems.filter((i) => !isRowInvalid(i) && isRowMissingRate(i)).length;
  const emptySiteName = p.sheet.sites.some((s) => s.items.length > 0 && !s.site_name.trim());
  const hasItems = allItems.length > 0;
  const canApprove = hasItems && invalidCount === 0 && !emptySiteName && !exporting && !fixing;

  const grand = p.sheet.sites.reduce(
    (acc, s) => {
      const t = siteTotals(s);
      return { cash: acc.cash + t.cash, credit: acc.credit + t.credit, total: acc.total + t.total };
    },
    { cash: 0, credit: 0, total: 0 },
  );

  const setSite = (id: string) => (fn: (s: Site) => Site) =>
    p.setSheet((sh) => ({ ...sh, sites: sh.sites.map((s) => (s.id === id ? fn(s) : s)) }));

  const runFix = async () => {
    if (!instruction.trim()) return;
    setFixing(true);
    setError("");
    try {
      await p.onFix(instruction.trim());
      setInstruction("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI correction failed");
    } finally {
      setFixing(false);
    }
  };

  const runExport = async () => {
    setExporting(true);
    setError("");
    setDone(false);
    try {
      await p.onExport();
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Excel download failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4 pb-60 sm:pb-40">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-ghost" onClick={p.onBack}>
          <ArrowLeft className="h-4 w-4" /> Back to inputs
        </button>
        <label className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-slate-600">Date</span>
          <input
            type="date"
            className="field w-auto"
            value={dmyToISO(p.sheet.date)}
            onChange={(e) => e.target.value && p.setSheet((s) => ({ ...s, date: isoToDMY(e.target.value) }))}
          />
        </label>
        <div className="flex flex-wrap gap-1.5 sm:ml-auto">
          <Badge label="Cash" value={grand.cash} tone="bg-emerald-100 text-emerald-800" />
          <Badge label="Credit" value={grand.credit} tone="bg-indigo-100 text-indigo-800" />
          <Badge label="Grand Total" value={grand.total} tone="bg-brand-600 text-white" />
        </div>
      </div>

      {p.existingName && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">
          These items will be merged into <b>{p.existingName}</b> when you download.
        </p>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded border border-yellow-300 bg-yellow-50" /> Rate missing — please check
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded border border-red-300 bg-red-50" /> Material or Qty missing — must fix
        </span>
      </div>

      {p.sheet.sites.map((s, i) => (
        <SiteCard
          key={s.id}
          site={s}
          index={i}
          setSite={setSite(s.id)}
          removeSite={() => p.setSheet((sh) => ({ ...sh, sites: sh.sites.filter((x) => x.id !== s.id) }))}
          defaultPayment={p.defaultPayment}
          sites={p.sites}
          vendors={p.vendors}
          uoms={p.uoms}
        />
      ))}

      <button
        type="button"
        className="btn btn-ghost w-full border-2 border-dashed py-3"
        onClick={() =>
          p.setSheet((sh) => {
            const site = emptySite();
            site.items.push(emptyItem(p.defaultPayment));
            return { ...sh, sites: [...sh.sites, site] };
          })
        }
      >
        <Plus className="h-4 w-4" /> Add New Site
      </button>

      {/* Sticky bottom: AI fix + approval */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur">
        <div className="mx-auto max-w-7xl space-y-2 p-3">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              runFix();
            }}
          >
            <input
              className="field flex-1 py-2"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={fixing}
              placeholder="Koi ghalti hai? Roman Urdu ya English mein likh kar theek karein (e.g., 'Cement ki qty 250 kr do' or 'Grove residency ke sab items cash mein dalo')"
            />
            <button type="submit" className="btn btn-ghost shrink-0 text-brand-700" disabled={fixing || !instruction.trim()}>
              {fixing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              {fixing ? "Updating…" : "Update with AI"}
            </button>
          </form>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex-1 text-xs">
              {error ? (
                <span className="text-red-600">{error}</span>
              ) : !hasItems ? (
                <span className="text-slate-500">Add at least one item to download.</span>
              ) : invalidCount > 0 || emptySiteName ? (
                <span className="flex items-center gap-1 text-red-600">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {invalidCount > 0 && `${invalidCount} row(s) need material and qty. `}
                  {emptySiteName && "Every site needs a name."}
                </span>
              ) : noRateCount > 0 ? (
                <span className="flex items-center gap-1 text-yellow-700">
                  <AlertTriangle className="h-3.5 w-3.5" /> {noRateCount} row(s) have no rate — they&apos;ll be left blank in Excel.
                </span>
              ) : done ? (
                <span className="flex items-center gap-1 text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Downloaded! Check your downloads folder.
                </span>
              ) : (
                <span className="flex items-center gap-1 text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> All rows look good.
                </span>
              )}
            </div>
            <button type="button" className="btn btn-primary py-2.5" disabled={!canApprove} onClick={runExport}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Approve & Download Excel (.xlsx)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
