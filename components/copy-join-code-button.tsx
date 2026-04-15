"use client";

import { useEffect, useRef, useState } from "react";

interface CopyJoinCodeButtonProps {
  code: string;
  className?: string;
}

/**
 * Small button to copy a league's join code to the clipboard. Shows
 * a short-lived "Copied!" confirmation and falls back to
 * document.execCommand("copy") when the async Clipboard API isn't
 * available (insecure context, older browsers).
 */
export function CopyJoinCodeButton({
  code,
  className,
}: CopyJoinCodeButtonProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function handleCopy() {
    let ok = false;
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(code);
        ok = true;
      } else if (typeof document !== "undefined") {
        // Fallback for environments without the async clipboard API
        // (e.g. http:// origins or older browsers).
        const textarea = document.createElement("textarea");
        textarea.value = code;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        ok = document.execCommand("copy");
        document.body.removeChild(textarea);
      }
    } catch {
      ok = false;
    }

    setStatus(ok ? "copied" : "error");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setStatus("idle"), 1500);
  }

  const label =
    status === "copied"
      ? "Copied!"
      : status === "error"
        ? "Copy failed"
        : "Copy";

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={`Copy join code ${code}`}
      className={
        "inline-flex items-center gap-1 rounded border border-puck-border bg-puck-card px-1.5 py-0.5 text-[10px] font-medium text-ice-200 transition-colors hover:bg-puck-border hover:text-ice-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ice-400 sm:text-xs " +
        (className ?? "")
      }
    >
      {status === "copied" ? <CheckIcon /> : <ClipboardIcon />}
      <span>{label}</span>
    </button>
  );
}

function ClipboardIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
