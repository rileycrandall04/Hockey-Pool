"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { TEAM_RENAME_MAX_LEN } from "./team-constants";

/**
 * Rename a team the caller owns (or commissions). The form is expected
 * to POST `league_id`, `team_id`, `team_name`, and a `return_url` that
 * the user should be redirected back to — this lets the same action
 * power the rename form on both the team detail page and the league
 * standings page.
 *
 * The teams-update RLS policy already restricts writes to the owner
 * or league commissioner, so we rely on it rather than re-checking.
 */
export async function renameTeamAction(formData: FormData) {
  const leagueId = String(formData.get("league_id") ?? "");
  const teamId = String(formData.get("team_id") ?? "");
  const rawName = String(formData.get("team_name") ?? "");
  const name = rawName.trim();

  const returnUrl =
    String(formData.get("return_url") ?? "") ||
    `/leagues/${leagueId}/team/${teamId}`;
  const sep = returnUrl.includes("?") ? "&" : "?";

  if (!leagueId || !teamId) {
    redirect(
      `${returnUrl}${sep}rename_error=${encodeURIComponent("Missing team.")}`,
    );
  }
  if (name.length === 0) {
    redirect(
      `${returnUrl}${sep}rename_error=${encodeURIComponent(
        "Team name can't be empty.",
      )}`,
    );
  }
  if (name.length > TEAM_RENAME_MAX_LEN) {
    redirect(
      `${returnUrl}${sep}rename_error=${encodeURIComponent(
        `Team name must be ${TEAM_RENAME_MAX_LEN} characters or fewer.`,
      )}`,
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("teams")
    .update({ name })
    .eq("id", teamId);

  if (error) {
    redirect(
      `${returnUrl}${sep}rename_error=${encodeURIComponent(error.message)}`,
    );
  }

  revalidatePath(`/leagues/${leagueId}`);
  revalidatePath(`/leagues/${leagueId}/team/${teamId}`);
  redirect(
    `${returnUrl}${sep}rename_success=${encodeURIComponent("Team name updated.")}`,
  );
}
