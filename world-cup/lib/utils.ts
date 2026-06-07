import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a number for display, trimming a trailing .0 (e.g. 5, 5.5). */
export function fmtPoints(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// The pool runs on Mountain Time. America/Denver handles MDT/MST automatically.
export const POOL_TZ = "America/Denver";
/** UTC offset for Mountain during the World Cup window (June–July = MDT). */
export const POOL_TZ_OFFSET = "-06:00";

/** Today's date (YYYY-MM-DD) in Mountain Time. */
export function poolToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: POOL_TZ });
}

/** Format a kickoff timestamp as a Mountain-Time clock time (e.g. "1:00 PM"). */
export function fmtKickoff(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: POOL_TZ,
  });
}

/** Short Mountain-Time date (e.g. "Jun 14"). */
export function fmtShortDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: POOL_TZ,
  });
}
