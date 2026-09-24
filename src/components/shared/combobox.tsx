"use client";

import { useId, useMemo, useRef, useState } from "react";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  keywords?: string;
}

/** Searchable single-select with keyboard support. */
export function Combobox({
  id,
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  className,
  invalid,
}: {
  id?: string;
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 100);
    return options
      .filter((o) => `${o.label} ${o.description ?? ""} ${o.keywords ?? ""}`.toLowerCase().includes(q))
      .slice(0, 100);
  }, [options, query]);

  function choose(v: string) {
    onChange(v);
    setOpen(false);
    setQuery("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setActive(0);
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-invalid={invalid || undefined}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-left text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDownIcon className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) min-w-64 p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (filtered[active]) choose(filtered[active].value);
            }
          }}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          aria-controls={listId}
          aria-activedescendant={filtered[active] ? `${listId}-${active}` : undefined}
          className="h-9 w-full border-b bg-transparent px-3 text-base outline-none placeholder:text-muted-foreground sm:text-sm"
        />
        <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto p-1">
          {filtered.length === 0 && <li className="px-2 py-2 text-sm text-muted-foreground">{emptyText}</li>}
          {filtered.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o.value === value}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o.value)}
              className={cn(
                "flex cursor-default items-start gap-2 rounded-sm px-2 py-1.5 text-sm",
                i === active && "bg-accent",
              )}
            >
              <CheckIcon className={cn("mt-0.5 size-4 shrink-0", o.value === value ? "opacity-100" : "opacity-0")} />
              <span className="min-w-0">
                <span className="block truncate">{o.label}</span>
                {o.description && <span className="block truncate text-xs text-muted-foreground">{o.description}</span>}
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
