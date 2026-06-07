"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { DraftStatus } from "@/lib/types";

interface NavBarProps {
  displayName: string;
  leagueId?: string;
  draftStatus?: DraftStatus;
  isCommissioner?: boolean;
}

/**
 * Top navigation bar with a left-hand dropdown menu. The dropdown closes
 * on route change, Escape, and click-outside.
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onPointer = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
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

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const homeHref = leagueId ? `/leagues/${leagueId}` : "/dashboard";
  const draftLabel = draftStatus === "complete" ? "Teams & standings" : "Draft";
  const draftHref = leagueId ? `/leagues/${leagueId}/draft` : null;

  const isActive = (href: string, exact = false): boolean => {
    if (!pathname) return false;
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  type Item = { href: string; label: string; active: boolean };
  const items: Item[] = [
    { href: homeHref, label: "Standings", active: isActive(homeHref, true) },
  ];
  if (leagueId) {
    items.push({
      href: `/leagues/${leagueId}/schedule`,
      label: "Schedule",
      active: isActive(`/leagues/${leagueId}/schedule`),
    });
    items.push({
      href: `/leagues/${leagueId}/groups`,
      label: "Group tables",
      active: isActive(`/leagues/${leagueId}/groups`),
    });
    items.push({
      href: `/leagues/${leagueId}/countries`,
      label: "Countries",
      active: isActive(`/leagues/${leagueId}/countries`),
    });
    items.push({
      href: `/leagues/${leagueId}/players`,
      label: "Players",
      active: isActive(`/leagues/${leagueId}/players`),
    });
    items.push({
      href: `/leagues/${leagueId}/golden-boot`,
      label: "Golden Boot",
      active: isActive(`/leagues/${leagueId}/golden-boot`),
    });
    items.push({
      href: `/leagues/${leagueId}/rules`,
      label: "Rules",
      active: isActive(`/leagues/${leagueId}/rules`),
    });
    if (draftHref && draftStatus !== "complete") {
      items.push({ href: draftHref, label: draftLabel, active: isActive(draftHref) });
    }
    if (isCommissioner) {
      items.push({
        href: `/leagues/${leagueId}/admin`,
        label: "Admin",
        active: isActive(`/leagues/${leagueId}/admin`),
      });
    }
  }

  const leagueActions: Item[] = [];
  if (leagueId) {
    leagueActions.push({ href: "/dashboard", label: "Switch leagues", active: false });
  }
  leagueActions.push(
    { href: "/leagues/new", label: "Create league", active: isActive("/leagues/new", true) },
    { href: "/leagues/join", label: "Join league", active: isActive("/leagues/join", true) },
  );

  return (
    <header className="border-b border-puck-border bg-puck-card">
      <div className="mx-auto grid max-w-6xl grid-cols-[auto_1fr_auto] items-center gap-2 px-4 py-3">
        <div ref={containerRef} className="relative">
          <button
            type="button"
            onClick={() => setOpen((p) => !p)}
            aria-expanded={open}
            aria-haspopup="menu"
            aria-label={open ? "Close menu" : "Open menu"}
            className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-puck-border bg-puck-bg text-ice-100 transition-colors hover:bg-puck-border"
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
                  <MenuLink key={item.href} href={item.href} active={item.active}>
                    {item.label}
                  </MenuLink>
                ))}
              </nav>
              <div className="border-t border-puck-border py-1">
                {leagueActions.map((item) => (
                  <MenuLink key={item.href} href={item.href} active={item.active}>
                    {item.label}
                  </MenuLink>
                ))}
              </div>
              <div className="border-t border-puck-border p-2">
                <form action="/auth/signout" method="post">
                  <Button type="submit" size="sm" variant="secondary" className="w-full">
                    Sign out
                  </Button>
                </form>
              </div>
            </div>
          )}
        </div>

        <Link
          href={homeHref}
          className="justify-self-center text-lg font-semibold tracking-tight text-ice-50"
        >
          🌍 <span className="hidden sm:inline">World Cup Pool</span>
        </Link>

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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}
