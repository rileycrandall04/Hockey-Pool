import Link from "next/link";
import { Button } from "@/components/ui/button";

export function NavBar({ displayName }: { displayName: string }) {
  return (
    <header className="border-b border-puck-border bg-puck-card">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <Link
          href="/dashboard"
          className="text-lg font-semibold tracking-tight text-ice-50"
        >
          🏒 Stanley Cup Pool
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-ice-300 sm:inline">
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
