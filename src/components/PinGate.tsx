"use client";

import { Loader2, Lock } from "lucide-react";
import { useRef, useState } from "react";
import { APP_NAME, STORAGE_KEYS } from "@/lib/constants";

export default function PinGate({ onUnlock }: { onUnlock: () => void }) {
  const [digits, setDigits] = useState(["", "", "", ""]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const submit = async (pin: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || "Wrong PIN");
      sessionStorage.setItem(STORAGE_KEYS.pin, pin);
      onUnlock();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wrong PIN");
      setDigits(["", "", "", ""]);
      refs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const setDigit = (i: number, v: string) => {
    const clean = v.replace(/\D/g, "");
    if (clean.length > 1) {
      // pasted full PIN
      const arr = clean.slice(0, 4).split("");
      const next = [0, 1, 2, 3].map((k) => arr[k] ?? "");
      setDigits(next);
      if (next.every(Boolean)) submit(next.join(""));
      return;
    }
    const next = [...digits];
    next[i] = clean;
    setDigits(next);
    if (clean && i < 3) refs.current[i + 1]?.focus();
    if (next.every(Boolean)) submit(next.join(""));
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
          <Lock className="h-7 w-7 text-brand-600" />
        </div>
        <h1 className="text-lg font-bold">{APP_NAME}</h1>
        <p className="mt-1 text-sm text-slate-500">Enter your 4-digit PIN to continue</p>
        <form
          className="mt-6 flex justify-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (digits.every(Boolean)) submit(digits.join(""));
          }}
        >
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              value={d}
              onChange={(e) => setDigit(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
              }}
              inputMode="numeric"
              type="password"
              autoComplete="off"
              autoFocus={i === 0}
              disabled={loading}
              aria-label={`PIN digit ${i + 1}`}
              className="h-14 w-12 rounded-lg border border-slate-300 text-center text-2xl font-bold outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          ))}
        </form>
        <div className="mt-4 h-5 text-sm">
          {loading ? (
            <span className="inline-flex items-center gap-1 text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking…
            </span>
          ) : (
            error && <span className="text-red-600">{error}</span>
          )}
        </div>
      </div>
    </main>
  );
}
