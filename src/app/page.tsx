"use client";

import { FileSpreadsheet, History, LogOut, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import InputDashboard, { type ExistingSheet } from "@/components/InputDashboard";
import PinGate from "@/components/PinGate";
import ReviewEditor, { type OptionList } from "@/components/ReviewEditor";
import { getPin, loadList, postJSON, saveToList } from "@/lib/client";
import { DEFAULT_SITES, DEFAULT_UOMS, DEFAULT_VENDORS, STORAGE_KEYS } from "@/lib/constants";
import { countItems, defaultFileName, dehydrate, hydrate, isoToDMY, mergeSheets, todayISO } from "@/lib/sheet";
import type { ExportedFile, PaymentType, Sheet, UploadFile } from "@/lib/types";

type Stage = "loading" | "pin" | "input" | "review";

const DRAFT_KEY = "tc_draft_v1";
interface Draft {
  sheet: Sheet;
  fileName: string;
  savedAt: number;
}
const readDraft = (): Draft | null => {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    return d?.sheet?.sites ? d : null;
  } catch {
    return null;
  }
};


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
  const [fileName, setFileName] = useState(defaultFileName(isoToDMY(todayISO())));
  const [fileNameTouched, setFileNameTouched] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    setStage(getPin() ? "input" : "pin");
    setDraft(readDraft());
  }, []);

  // Auto-save the review so a refresh / closed tab doesn't lose work.
  useEffect(() => {
    if (!sheet) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ sheet, fileName, savedAt: Date.now() }));
      } catch {
        /* storage full / unavailable */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [sheet, fileName]);

  // Keep the default file name in sync with the sheet date until the user edits it.
  useEffect(() => {
    if (sheet && !fileNameTouched) setFileName(defaultFileName(sheet.date));
  }, [sheet?.date, fileNameTouched]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const dmy = isoToDMY(dateISO);
      const hasNew = text.trim().length > 0 || files.length > 0;
      let next: Sheet = { date: dmy, sites: [] };
      if (hasNew) {
        const data = await postJSON<unknown>("/api/extract", { text, date: dmy, defaultPayment: payment, files });
        next = hydrate(data, dmy, payment);
        if (countItems(next) === 0 && !existing) {
          throw new Error("No purchase items were found. Please check the message/slips and try again.");
        }
      }
      if (existing) {
        const base = structuredClone(existing.sheet);
        next = mergeSheets(base, { ...next, date: dmy });
      }
      setSheetState(next);
      setFileNameTouched(false);
      setFileName(defaultFileName(next.date));
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

  const exportPayload = () => (sheet ? { sheet: dehydrate(sheet), filename: fileName } : null);

  const exportXlsx = async (): Promise<ExportedFile | null> => {
    const payload = exportPayload();
    if (!payload) return null;
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-app-pin": getPin() },
      body: JSON.stringify(payload),
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
    const blob = new Blob([await res.arrayBuffer()], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const cd = res.headers.get("Content-Disposition") || "";
    const star = cd.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const name = (star && decodeURIComponent(star)) || cd.match(/filename="?([^";]+)"?/)?.[1] || `${fileName}.xlsx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return { blob, name };
  };

  /** Fallback: plain form POST so the phone's own download manager saves the file
   * (works in WhatsApp / Instagram in-app browsers where blob downloads fail). */
  const directDownload = () => {
    const payload = exportPayload();
    if (!payload) return;
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/export";
    form.style.display = "none";
    for (const [k, v] of Object.entries({ payload: JSON.stringify(payload), pin: getPin() })) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = k;
      input.value = v;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
    form.remove();
  };

  const startNew = () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    setDraft(null);
    setSheetState(null);
    setText("");
    setFiles([]);
    setExisting(null);
    setError("");
    setStage("input");
    window.scrollTo({ top: 0 });
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
        {stage === "input" && draft && !sheet && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
            <History className="h-5 w-5 shrink-0 text-amber-600" />
            <span className="min-w-0 flex-1 text-amber-900">
              Unfinished sheet found ({draft.sheet.date}, {countItems(draft.sheet)} items, saved{" "}
              {new Date(draft.savedAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}).
            </span>
            <button
              type="button"
              className="btn btn-primary py-1.5"
              onClick={() => {
                setSheetState(draft.sheet);
                setFileName(draft.fileName || defaultFileName(draft.sheet.date));
                setFileNameTouched(true);
                setStage("review");
              }}
            >
              Continue
            </button>
            <button
              type="button"
              aria-label="Discard draft"
              className="rounded p-1 text-amber-700 hover:bg-amber-100"
              onClick={() => {
                try {
                  localStorage.removeItem(DRAFT_KEY);
                } catch {
                  /* ignore */
                }
                setDraft(null);
              }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
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
            fileName={fileName}
            setFileName={(v) => {
              setFileName(v);
              setFileNameTouched(true);
            }}
            onBack={() => setStage("input")}
            onFix={fix}
            onExport={exportXlsx}
            onDirectDownload={directDownload}
            onStartNew={startNew}
          />
        )}
      </main>
    </div>
  );
}
