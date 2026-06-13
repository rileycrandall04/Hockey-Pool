"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Read-only share link for a league, with a one-tap copy button. The absolute
 * URL is built on the client from the current origin so it works across
 * environments (localhost, preview, production) without extra config.
 */
export function ShareLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const path = `/share/${token}`;
  const url =
    typeof window !== "undefined" ? `${window.location.origin}${path}` : path;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — the link is still
      // selectable in the box, so this is a no-op fallback.
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="flex-1 truncate rounded-md border border-puck-border bg-puck-bg px-2 py-1 font-mono text-xs text-ice-200"
      />
      <Button type="button" size="sm" variant="secondary" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
