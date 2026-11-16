"use client";

import { FileSpreadsheet, LogOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import InputDashboard, { type ExistingSheet } from "@/components/InputDashboard";
import PinGate from "@/components/PinGate";
import ReviewEditor, { type OptionList } from "@/components/ReviewEditor";
import { getPin, loadList, postJSON, saveToList } from "@/lib/client";
import { DEFAULT_SITES, DEFAULT_UOMS, DEFAULT_VENDORS, STORAGE_KEYS } from "@/lib/constants";
import { dehydrate, hydrate, isoToDMY, todayISO } from "@/lib/sheet";
import type { PaymentType, Sheet, UploadFile } from "@/lib/types";

type Stage = "loading" | "pin" | "input" | "review";

function useOptionList(key: string, defaults: string[], extra: string[] = []): OptionList {
  const [custom, setCustom] = useState<string[]>([]);
  useEffect(() => setCustom(loadList(key)), [key]);
  const add = useCallback(
    (v: string) => {
      saveToList(key, v);
      setCustom(loadList(key));
    },
    [key],
  );
  const options = useMemo(() => {
    const seen = new Set<string>();
    return [...defaults, ...custom, ...extra].filter((o) => {
      const k = o.trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [defaults, custom, extra]);
  return { options, add };
}

export default function Home() {
  const [stage, setStage] = useState<Stage>("loading");
  const [dateISO, setDateISO] = useState(todayISO());
  const [payment, setPayment] = useState<PaymentType>("Credit");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [existing, setExisting] = useState<ExistingSheet | null>(null);
  const [sheet, setSheetState] = useState<Sheet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setStage(getPin() ? "input" : "pin");
  }, []);

  // Vendors/UoMs that appear in the current sheet are offered in dropdowns too.
  const sheetVendors = useMemo(
    () => sheet?.sites.flatMap((s) => s.items.map((i) => i.vendor)) ?? [],
    [sheet],
  );
  const sites = useOptionList(STORAGE_KEYS.sites, DEFAULT_SITES);
  const vendors = useOptionList(STORAGE_KEYS.vendors, DEFAULT_VENDORS, sheetVendors);
  const uoms = useOptionList(STORAGE_KEYS.uoms, DEFAULT_UOMS);

  const setSheet = useCallback((fn: (s: Sheet) => Sheet) => setSheetState((s) => (s ? fn(s) : s)), []);

  const handleAuthError = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (/wrong PIN|Session expired/i.test(msg)) {
      sessionStorage.removeItem(STORAGE_KEYS.pin);
      setStage("pin");
    }
    return msg;
  };

  const extract = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await postJSON<unknown>("/api/extract", {
        text,
        date: isoToDMY(dateISO),
        defaultPayment: payment,
        files,
      });
      const s = hydrate(data, isoToDMY(dateISO), payment);
      if (s.sites.length === 0 || s.sites.every((x) => x.items.length === 0)) {
        throw new Error("No purchase items were found. Please check the message/slips and try again.");
      }
      setSheetState(s);
      setStage("review");
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(handleAuthError(e));
    } finally {
      setLoading(false);
    }
  };

  const fix = async (instruction: string) => {
    if (!sheet) return;
    try {
      const data = await postJSON<unknown>("/api/fix", { sheet: dehydrate(sheet), instruction });
      const next = hydrate(data, sheet.date, payment);
      setSheetState({ ...next, date: next.date || sheet.date });
    } catch (e) {
      throw new Error(handleAuthError(e));
    }
  };

  const exportXlsx = async () => {
    if (!sheet) return;
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-app-pin": getPin() },
      body: JSON.stringify({ sheet: dehydrate(sheet), existing_file: existing?.data ?? null }),
    });
    if (!res.ok) {
      let msg = `Excel export failed (${res.status})`;
      try {
        const j = await res.json();
        if (j?.error) msg = j.error;
      } catch {
        /* non-JSON error */
      }
      throw new Error(handleAuthError(new Error(msg)));
    }
    const blob = await res.blob();
    const name =
      res.headers.get("Content-Disposition")?.match(/filename="?([^"]+)"?/)?.[1] ??
      `Daily_Purchase_Sheet_${sheet.date.replace(/\//g, "-")}.xlsx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  if (stage === "loading") return null;
  if (stage === "pin") return <PinGate onUnlock={() => setStage("input")} />;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600">
            <FileSpreadsheet className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-bold sm:text-base">Total Constructors — Daily Purchase Sheet Generator</h1>
            <p className="text-xs text-slate-500">
              {stage === "input" ? "Step 1 of 2 · Add messages & slips" : `Step 2 of 2 · Review & approve · ${sheet?.date ?? ""}`}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Lock"
            aria-label="Lock app"
            onClick={() => {
              sessionStorage.removeItem(STORAGE_KEYS.pin);
              setStage("pin");
            }}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className={`mx-auto px-4 py-5 ${stage === "review" ? "max-w-7xl" : "max-w-3xl"}`}>
        {stage === "input" && (
          <InputDashboard
            dateISO={dateISO}
            setDateISO={setDateISO}
            payment={payment}
            setPayment={setPayment}
            text={text}
            setText={setText}
            files={files}
            setFiles={setFiles}
            existing={existing}
            setExisting={setExisting}
            loading={loading}
            error={error}
            onExtract={extract}
          />
        )}
        {stage === "review" && sheet && (
          <ReviewEditor
            sheet={sheet}
            setSheet={setSheet}
            defaultPayment={payment}
            sites={sites}
            vendors={vendors}
            uoms={uoms}
            existingName={existing?.name}
            onBack={() => setStage("input")}
            onFix={fix}
            onExport={exportXlsx}
          />
        )}
      </main>
    </div>
  );
}
