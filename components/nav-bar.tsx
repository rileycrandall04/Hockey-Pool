"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { DraftStatus } from "@/lib/types";

interface NavBarProps {
  displayName: string;
  /**
   * Set when the user is currently on a league-scoped page. Enables
   * the Draft/Teams + Standings items inside the dropdown; without
   * it, only Home + Players are shown.
   */
  leagueId?: string;
  /**
   * Used to morph the "Draft" item into "Teams" once the draft is
   * complete, and to swap its target URL accordingly.
   */
  draftStatus?: DraftStatus;
  /**
   * Set when the viewing user is the commissioner of the current
   * league. Adds an Admin item to the dropdown pointing at
   * /leagues/{leagueId}/admin.
   */
  isCommissioner?: boolean;
}

/**
 * Top navigation bar.
 *
 * Layout:
 *   [☰ menu]          🏒 Stanley Cup Pool           [spacer]
 *
 * The menu button top-left opens a dropdown containing:
 *   - Home
 *   - Players
 *   - Draft / Teams   (only if leagueId + draftStatus present)
 *   - Standings       (only if leagueId present)
 *   - Signed-in identity label
 *   - Sign out button
 *
 * The dropdown closes on route change, Escape, and click-outside.
 */
export function NavBar({
  displayName,
  leagueId,
  draftStatus,
  isCommissioner = false,
}: NavBarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on Escape and click-outside.
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  // Close when the route changes (user tapped a link inside the menu).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const draftLabel = draftStatus === "complete" ? "Teams" : "Draft";
  const draftHref = leagueId
    ? draftStatus === "complete"
      ? `/leagues/${leagueId}/teams`
      : `/leagues/${leagueId}/draft`
    : null;

  const isActive = (href: string, exact = false): boolean => {
    if (!pathname) return false;
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  type Item = { href: string; label: string; active: boolean };
  const items: Item[] = [
    {
      href: "/dashboard",
      label: "Home",
      active: isActive("/dashboard", true),
    },
    {
      href: "/players",
      label: "Players",
      active: isActive("/players"),
    },
  ];
  if (leagueId && draftHref) {
    items.push({
      href: draftHref,
      label: draftLabel,
      active: isActive(draftHref),
    });
  }
  if (leagueId) {
    items.push({
      href: `/leagues/${leagueId}`,
      label: "Standings",
      active: isActive(`/leagues/${leagueId}`, true),
    });
  }
  if (leagueId && isCommissioner) {
    items.push({
      href: `/leagues/${leagueId}/admin`,
      label: "Admin",
      active: isActive(`/leagues/${leagueId}/admin`),
    });
  }

  // Always-visible "create a league" + "join a league" entries so the
  // dashboard can stay a clean list with no action buttons of its own.
  const leagueActions: Item[] = [
    {
      href: "/leagues/new",
      label: "Create league",
      active: isActive("/leagues/new", true),
    },
    {
      href: "/leagues/join",
      label: "Join league",
      active: isActive("/leagues/join", true),
    },
  ];

  return (
    <header className="border-b border-puck-border bg-puck-card">
      <div className="mx-auto grid max-w-6xl grid-cols-[auto_1fr_auto] items-center gap-2 px-4 py-3">
        {/* Left: menu button + dropdown */}
        <div ref={containerRef} className="relative">
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            aria-haspopup="menu"
            aria-label={open ? "Close menu" : "Open menu"}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-puck-border bg-puck-bg text-ice-100 transition-colors hover:bg-puck-border"
          >
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>

          {open && (
            <div
              role="menu"
              className="absolute left-0 top-full z-50 mt-1.5 w-56 overflow-hidden rounded-md border border-puck-border bg-puck-card shadow-lg shadow-black/40"
            >
              <div className="border-b border-puck-border px-3 py-2 text-xs text-ice-400">
                Signed in as{" "}
                <span className="block truncate text-sm text-ice-100">
                  {displayName}
                </span>
              </div>
              <nav className="py-1">
                {items.map((item) => (
                  <MenuLink
                    key={item.href}
                    href={item.href}
                    active={item.active}
                  >
                    {item.label}
                  </MenuLink>
                ))}
              </nav>
              <div className="border-t border-puck-border py-1">
                {leagueActions.map((item) => (
                  <MenuLink
                    key={item.href}
                    href={item.href}
                    active={item.active}
                  >
                    {item.label}
                  </MenuLink>
                ))}
              </div>
              <div className="border-t border-puck-border p-2">
                <form action="/auth/signout" method="post">
                  <Button
                    type="submit"
                    size="sm"
                    variant="secondary"
                    className="w-full"
                  >
                    Sign out
                  </Button>
                </form>
              </div>
            </div>
          )}
        </div>

        {/* Center: logo (links back to dashboard) */}
        <Link
          href="/dashboard"
          className="justify-self-center text-lg font-semibold tracking-tight text-ice-50"
        >
          🏒{" "}
          <span className="hidden sm:inline">Stanley Cup Pool</span>
        </Link>

        {/* Right: empty spacer that matches the menu button width so
            the centered logo sits in the true middle of the bar. */}
        <div className="h-10 w-10" aria-hidden="true" />
      </div>
    </header>
  );
}

function MenuLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      className={
        active
          ? "block bg-ice-500/20 px-3 py-2 text-sm font-semibold text-ice-50"
          : "block px-3 py-2 text-sm text-ice-200 hover:bg-puck-border hover:text-ice-100"
      }
    >
      {children}
    </Link>
  );
}

function MenuIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}
