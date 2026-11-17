"use client";

import { CheckCircle2, FileSpreadsheet, FileText, FolderOpen, ImageIcon, Loader2, Sparkles, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { b64Bytes, compressImage, fileToBase64, loadList, postJSON } from "@/lib/client";
import { DEFAULT_SITES, STORAGE_KEYS } from "@/lib/constants";
import { canonicalSite, countItems, hydrate } from "@/lib/sheet";
import type { PaymentType, Sheet, UploadFile } from "@/lib/types";

const MAX_TOTAL_BYTES = 4 * 1024 * 1024; // Vercel request body limit is 4.5 MB
const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

export interface ExistingSheet {
  name: string;
  sheet: Sheet; // parsed contents, merged into the editor
}

const isXlsx = (f: File) => /\.xlsx$/i.test(f.name);

interface Props {
  dateISO: string;
  setDateISO: (v: string) => void;
  payment: PaymentType;
  setPayment: (p: PaymentType) => void;
  text: string;
  setText: (v: string) => void;
  files: UploadFile[];
  setFiles: (f: UploadFile[]) => void;
  existing: ExistingSheet | null;
  setExisting: (e: ExistingSheet | null) => void;
  loading: boolean;
  error: string;
  onExtract: () => void;
}

export default function InputDashboard(p: Props) {
  const [processing, setProcessing] = useState(false);
  const [fileError, setFileError] = useState("");
  const [xlsxBusy, setXlsxBusy] = useState(false);
  const [xlsxError, setXlsxError] = useState("");
  const [dragXlsx, setDragXlsx] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const xlsxRef = useRef<HTMLInputElement>(null);

  const totalBytes = p.files.reduce((s, f) => s + b64Bytes(f.data), 0);

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setProcessing(true);
    setFileError("");
    const added: UploadFile[] = [];
    try {
      for (const f of Array.from(list)) {
        if (isXlsx(f)) {
          await addExisting(f); // an Excel file dropped here = "existing sheet"
          continue;
        }
        if (f.type.startsWith("image/")) {
          added.push({ name: f.name, mimeType: "image/jpeg", data: await compressImage(f) });
        } else if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) {
          added.push({ name: f.name, mimeType: "application/pdf", data: await fileToBase64(f) });
        } else {
          setFileError(`${f.name}: only JPG, PNG, WEBP or PDF files are supported.`);
        }
      }
      const next = [...p.files, ...added];
      const size = next.reduce((s, f) => s + b64Bytes(f.data), 0);
      if (size > MAX_TOTAL_BYTES) {
        setFileError("Total upload is over 4 MB. Please remove some files (large PDFs) and try again.");
      }
      p.setFiles(next);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : "Could not read file");
    } finally {
      setProcessing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  async function addExisting(f: File | undefined) {
    if (!f) return;
    setXlsxError("");
    if (!isXlsx(f)) {
      setXlsxError("Please choose an Excel .xlsx file (old .xls files: open in Excel and 'Save As' .xlsx first).");
      return;
    }
    if (f.size > 3 * 1024 * 1024) {
      setXlsxError("This Excel file is too large (max 3 MB).");
      return;
    }
    setXlsxBusy(true);
    try {
      const raw = await postJSON<unknown>("/api/export", { action: "parse", existing_file: await fileToBase64(f) });
      const sheet = hydrate(raw, "", p.payment);
      const known = [...DEFAULT_SITES, ...loadList(STORAGE_KEYS.sites)];
      sheet.sites.forEach((s) => {
        s.site_name = canonicalSite(s.site_name, known);
        s.items.forEach((i) => (i.fromExisting = true));
      });
      if (countItems(sheet) === 0) {
        throw new Error(
          "No items found in this sheet. Make sure it has a header row with 'Material' and 'Qty' columns under each site name.",
        );
      }
      p.setExisting({ name: f.name, sheet });
    } catch (e) {
      setXlsxError(e instanceof Error ? e.message : "Could not read this Excel file");
    } finally {
      setXlsxBusy(false);
      if (xlsxRef.current) xlsxRef.current.value = "";
    }
  }

  const hasNew = p.text.trim().length > 0 || p.files.length > 0;
  const canExtract =
    !p.loading && !processing && !xlsxBusy && (hasNew || !!p.existing) && totalBytes <= MAX_TOTAL_BYTES;

  return (
    <div className="space-y-4">
      {/* Settings row */}
      <section className="card grid gap-4 p-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Sheet date</span>
          <input
            type="date"
            className="field"
            value={p.dateISO}
            onChange={(e) => e.target.value && p.setDateISO(e.target.value)}
          />
        </label>
        <div>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Default payment mode
          </span>
          <div className="inline-flex w-full rounded-lg border border-slate-300 bg-slate-50 p-1">
            {(["Credit", "Cash"] as PaymentType[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => p.setPayment(m)}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                  p.payment === m ? "bg-white text-brand-700 shadow" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">Used when a message doesn&apos;t say cash or credit.</p>
        </div>
      </section>

      {/* Text input */}
      <section className="card p-4">
        <label htmlFor="msgs" className="mb-2 block text-sm font-semibold">
          WhatsApp messages
        </label>
        <textarea
          id="msgs"
          rows={8}
          className="field resize-y font-mono text-[13px] leading-relaxed"
          placeholder={
            "Paste messages here (Roman Urdu / English)…\n\ne.g.\nSCB site: cement 200 bori 1450 udhaar Lucky traders\nGrove residency PPR pipe 1 inch 25 length cash\nRickshaw warehouse se SCB 14000"
          }
          value={p.text}
          onChange={(e) => p.setText(e.target.value)}
        />
      </section>

      {/* File upload */}
      <section className="card p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold">Vendor slips (photos / PDF)</span>
          <span className="text-xs text-slate-500">{(totalBytes / 1024 / 1024).toFixed(2)} MB / 4 MB</span>
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            addFiles(e.dataTransfer.files);
          }}
          className="flex w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600 transition hover:border-brand-500 hover:bg-brand-50"
        >
          {processing ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
          <span className="font-medium">{processing ? "Compressing…" : "Tap to add slips or drag & drop"}</span>
          <span className="text-xs text-slate-400">JPG, PNG, WEBP, PDF — images are auto-compressed</span>
        </button>
        <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => addFiles(e.target.files)} />
        {p.files.length > 0 && (
          <ul className="mt-3 space-y-2">
            {p.files.map((f, i) => (
              <li key={i} className="flex items-center gap-3 rounded-lg border border-slate-200 p-2 text-sm">
                {f.mimeType === "application/pdf" ? (
                  <div className="flex h-10 w-10 items-center justify-center rounded bg-red-50">
                    <FileText className="h-5 w-5 text-red-500" />
                  </div>
                ) : (
                  <img src={`data:${f.mimeType};base64,${f.data}`} alt="" className="h-10 w-10 rounded object-cover" />
                )}
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-xs text-slate-400">{Math.round(b64Bytes(f.data) / 1024)} KB</span>
                <button
                  type="button"
                  aria-label="Remove file"
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                  onClick={() => p.setFiles(p.files.filter((_, k) => k !== i))}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {fileError && <p className="mt-2 text-sm text-red-600">{fileError}</p>}
      </section>

      {/* Existing sheet */}
      <section className="card p-4">
        <div className="mb-2 flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
          <span className="text-sm font-semibold">Append to existing sheet (optional)</span>
        </div>
        {p.existing ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate font-semibold text-emerald-900">{p.existing.name}</p>
                <p className="text-emerald-800">
                  {p.existing.sheet.sites.length} site(s), {countItems(p.existing.sheet)} item(s) found
                  {p.existing.sheet.date && <> · dated {p.existing.sheet.date}</>}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {p.existing.sheet.sites.map((s) => (
                    <span key={s.id} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                      {s.site_name} ({s.items.length})
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-xs text-emerald-700">
                  These rows will appear in the review screen (marked &ldquo;Earlier&rdquo;) and new items are added to
                  matching sites.
                </p>
              </div>
              <button
                type="button"
                aria-label="Remove existing sheet"
                className="rounded p-1 text-emerald-700 hover:bg-emerald-100"
                onClick={() => p.setExisting(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => xlsxRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragXlsx(true);
            }}
            onDragLeave={() => setDragXlsx(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragXlsx(false);
              addExisting(e.dataTransfer.files?.[0]);
            }}
            disabled={xlsxBusy}
            className={`flex w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-5 text-sm transition ${
              dragXlsx
                ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                : "border-slate-300 bg-slate-50 text-slate-600 hover:border-emerald-500 hover:bg-emerald-50"
            }`}
          >
            {xlsxBusy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
            <span className="font-medium">{xlsxBusy ? "Reading sheet…" : "Tap to choose or drop today\u2019s earlier .xlsx"}</span>
            <span className="text-xs text-slate-400">Its sites & items load into the editor so you can add to them</span>
          </button>
        )}
        <input
          ref={xlsxRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => addExisting(e.target.files?.[0])}
        />
        {xlsxError && <p className="mt-2 text-sm text-red-600">{xlsxError}</p>}
      </section>

      {p.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{p.error}</div>
      )}

      <button type="button" className="btn btn-primary w-full py-3 text-base" disabled={!canExtract} onClick={p.onExtract}>
        {p.loading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" /> Reading messages & slips… (can take up to a minute)
          </>
        ) : hasNew ? (
          <>
            <Sparkles className="h-5 w-5" /> Extract & Preview
          </>
        ) : (
          <>
            <FolderOpen className="h-5 w-5" /> Open Existing Sheet for Editing
          </>
        )}
      </button>
      {!hasNew && !p.existing && (
        <p className="flex items-center justify-center gap-1 text-center text-xs text-slate-500">
          <ImageIcon className="h-3.5 w-3.5" /> Paste a message or add at least one slip to start.
        </p>
      )}
    </div>
  );
}
