"use client";

import { ChevronDown, Plus } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  /** Called when the user commits a value not already in `options` (saved to localStorage by the parent). */
  onNewOption?: (v: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  uppercase?: boolean;
  ariaLabel?: string;
}

/** Searchable dropdown that also accepts free-typed custom values. */
export default function Combobox({
  value,
  onChange,
  options,
  onNewOption,
  placeholder,
  className = "",
  inputClassName = "",
  uppercase,
  ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null); // null = not actively typing
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const q = (query ?? "").trim().toLowerCase();
  const filtered = useMemo(() => {
    const uniq = Array.from(new Set(options.filter(Boolean)));
    return q ? uniq.filter((o) => o.toLowerCase().includes(q)) : uniq;
  }, [options, q]);
  const exact = options.some((o) => o.toLowerCase() === value.trim().toLowerCase());

  const commit = (v: string) => {
    const val = uppercase ? v.toUpperCase() : v;
    onChange(val);
    setQuery(null);
    setOpen(false);
    if (val.trim() && !options.some((o) => o.toLowerCase() === val.trim().toLowerCase())) {
      onNewOption?.(val.trim());
    }
  };

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        className={`field pr-7 ${inputClassName}`}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onChange={(e) => {
          const v = uppercase ? e.target.value.toUpperCase() : e.target.value;
          onChange(v);
          setQuery(v);
          setOpen(true);
          setActive(0);
        }}
        onBlur={() => {
          setOpen(false);
          if (query !== null) commit(value);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (open && query !== null && filtered[active]) commit(filtered[active]);
            else commit(value);
            inputRef.current?.blur();
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      {open && (filtered.length > 0 || (value.trim() && !exact)) && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 z-30 mt-1 max-h-56 w-full min-w-[12rem] overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg"
        >
          {value.trim() && !exact && (
            <li
              className="flex cursor-pointer items-center gap-1 px-3 py-1.5 text-brand-600 hover:bg-brand-50"
              onMouseDown={(e) => {
                e.preventDefault();
                commit(value);
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Use &ldquo;{value.trim()}&rdquo;
            </li>
          )}
          {filtered.map((o, i) => (
            <li
              key={o}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer px-3 py-1.5 ${i === active ? "bg-brand-50 text-brand-700" : "hover:bg-slate-50"}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(o);
              }}
            >
              {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
