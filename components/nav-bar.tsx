"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { DraftStatus } from "@/lib/types";

interface NavBarProps {
  displayName: string;
  /**
   * Set when the user is currently on a league-scoped page. Enables the
   * Draft/Teams + Standings buttons; without it, only Home + Players
   * are shown (used on the dashboard, player detail, debug, etc.).
   */
  leagueId?: string;
  /**
   * Used to morph the "Draft" button into "Teams" once the draft is
   * complete, and to swap its target URL accordingly.
   */
  draftStatus?: DraftStatus;
}

export function NavBar({ displayName, leagueId, draftStatus }: NavBarProps) {
  const pathname = usePathname();

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

  return (
    <header className="border-b border-puck-border bg-puck-card">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3">
        <Link
          href="/dashboard"
          className="flex-shrink-0 text-lg font-semibold tracking-tight text-ice-50"
          title="Stanley Cup Pool"
        >
          🏒
        </Link>
        <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
          <NavLink href="/dashboard" active={isActive("/dashboard", true)}>
            Home
          </NavLink>
          <NavLink href="/players" active={isActive("/players")}>
            Players
          </NavLink>
          {leagueId && draftHref && (
            <NavLink href={draftHref} active={isActive(draftHref)}>
              {draftLabel}
            </NavLink>
          )}
          {leagueId && (
            <NavLink
              href={`/leagues/${leagueId}`}
              active={isActive(`/leagues/${leagueId}`, true)}
            >
              Standings
            </NavLink>
          )}
        </nav>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className="hidden text-sm text-ice-300 md:inline">
            {displayName}
          </span>
          <form action="/auth/signout" method="post">
            <Button type="submit" size="sm" variant="secondary">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}

function NavLink({
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
      className={
        active
          ? "rounded-md bg-ice-500/20 px-3 py-1.5 text-sm font-semibold text-ice-50 ring-1 ring-ice-500/40"
          : "rounded-md px-3 py-1.5 text-sm text-ice-300 hover:bg-puck-border hover:text-ice-100"
      }
    >
      {children}
    </Link>
  );
}
