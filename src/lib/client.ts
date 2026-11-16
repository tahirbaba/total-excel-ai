"use client";

import { STORAGE_KEYS } from "./constants";

export function getPin(): string {
  try {
    return sessionStorage.getItem(STORAGE_KEYS.pin) || "";
  } catch {
    return "";
  }
}

/** POST JSON with the session PIN; throws an Error with a readable message on failure. */
export async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-app-pin": getPin() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      if (res.status === 413) msg = "Files are too large. Please upload fewer or smaller files (max ~4 MB total).";
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export function loadList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveToList(key: string, value: string) {
  const v = value.trim();
  if (!v) return;
  try {
    const list = loadList(key);
    if (!list.some((x) => x.toLowerCase() === v.toLowerCase())) {
      localStorage.setItem(key, JSON.stringify([...list, v].slice(-300)));
    }
  } catch {
    /* storage unavailable — ignore */
  }
}

const readAsDataURL = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

export const stripDataUrl = (d: string) => d.slice(d.indexOf(",") + 1);

export async function fileToBase64(file: File) {
  return stripDataUrl(await readAsDataURL(file));
}

/** Resize to max 1200px width and re-encode as JPEG q=0.8 via canvas. */
export async function compressImage(file: File, maxWidth = 1200, quality = 0.8) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(`Could not read image ${file.name}`));
      i.src = url;
    });
    const scale = Math.min(1, maxWidth / img.naturalWidth);
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return stripDataUrl(canvas.toDataURL("image/jpeg", quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Approx decoded byte size of a base64 string. */
export const b64Bytes = (b64: string) => Math.floor((b64.length * 3) / 4);
