"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

interface BackButtonProps {
  /**
   * Fallback URL used when there's no history to go back to (i.e.,
   * the user landed on this page via a fresh tab, a bookmark, or
   * a paste into the address bar). Also the href on the underlying
   * <a> so the link still works without JavaScript.
   */
  fallbackHref: string;
  className?: string;
  children: ReactNode;
}

/**
 * "Back" link that prefers browser history when available and falls
 * back to a static URL otherwise.
 *
 * Rationale: a plain `<Link href="...">` always navigates to the
 * same target regardless of how the user arrived, which is wrong
 * for a "back" affordance — if they came from /players, tapping
 * back should go to /players, not to a hard-coded league standings
 * page.
 *
 * Implementation:
 *   - Renders as a real <a> with `href={fallbackHref}` so SSR is
 *     correct, the link is right-clickable, and the page works
 *     without JS.
 *   - On click in a browser, checks `window.history.length`. If it's
 *     greater than 1 (i.e., there's a previous entry in this tab's
 *     history) we prevent the default navigation and call
 *     `router.back()`. Otherwise the fallbackHref takes over.
 */
export function BackButton({
  fallbackHref,
  className,
  children,
}: BackButtonProps) {
  const router = useRouter();
  return (
    <Link
      href={fallbackHref}
      onClick={(e) => {
        if (
          typeof window !== "undefined" &&
          window.history.length > 1
        ) {
          e.preventDefault();
          router.back();
        }
      }}
      className={className}
    >
      {children}
    </Link>
  );
}
