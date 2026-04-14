"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Small kebab-menu popover for row actions.
 *
 * Usage:
 *   <RowMenu>
 *     <Link href="/foo">Edit</Link>
 *     <Link href="/foo#delete">Delete</Link>
 *   </RowMenu>
 *
 * The trigger is a ⋯ button. Tapping it opens a floating panel
 * anchored to the button; the children are the action rows.
 *
 * Closes on: click outside, Escape, or any interaction with a
 * child (the onClick on the panel propagates to close).
 */
export function RowMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => {
          // The parent <li> may be inside a Link; stop propagation so
          // tapping the menu button doesn't also navigate.
          e.preventDefault();
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={open ? "Close actions" : "Open actions"}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-lg text-ice-400 transition-colors hover:bg-puck-border hover:text-ice-100"
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          onClick={() => setOpen(false)}
          className="absolute right-0 top-full z-40 mt-1 min-w-[140px] overflow-hidden rounded-md border border-puck-border bg-puck-card p-1 shadow-lg shadow-black/40"
        >
          {children}
        </div>
      )}
    </div>
  );
}
