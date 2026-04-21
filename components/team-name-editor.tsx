"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { renameTeamAction } from "@/app/leagues/[leagueId]/team-actions";

interface Props {
  teamId: string;
  leagueId: string;
  initialName: string;
  returnUrl: string;
  maxLength: number;
}

/**
 * Displays the team name with a pencil button that swaps in an inline
 * rename form. Used on the teams page next to the viewer's own team
 * (and on every row for commissioners). Submission goes through the
 * shared renameTeamAction; on success the server redirects back to
 * `returnUrl` which re-renders this component with the new name.
 */
export function TeamNameEditor({
  teamId,
  leagueId,
  initialName,
  returnUrl,
  maxLength,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-2">
        <span>{initialName}</span>
        <button
          type="button"
          aria-label="Rename team"
          title="Rename team"
          onClick={() => setEditing(true)}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-ice-400 hover:bg-puck-border/50 hover:text-ice-100"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </button>
      </span>
    );
  }

  return (
    <form
      action={(formData) => startTransition(() => renameTeamAction(formData))}
      className="flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="league_id" value={leagueId} />
      <input type="hidden" name="team_id" value={teamId} />
      <input type="hidden" name="return_url" value={returnUrl} />
      <Input
        ref={inputRef}
        name="team_name"
        defaultValue={initialName}
        maxLength={maxLength}
        required
        disabled={isPending}
        className="w-56"
        aria-label="Team name"
      />
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Saving…" : "Save"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={isPending}
        onClick={() => setEditing(false)}
      >
        Cancel
      </Button>
    </form>
  );
}
