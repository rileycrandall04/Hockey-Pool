"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Polls the server for fresh data while a match is live by calling
 * `router.refresh()` on an interval. Mounted only when something on the page
 * is in progress, so it idles to nothing the rest of the time. Pauses while
 * the tab is hidden to avoid burning refreshes in the background.
 */
export function LiveRefresher({ intervalMs = 45000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(tick, intervalMs);
    // Refresh immediately when the tab regains focus.
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, intervalMs]);

  return null;
}
