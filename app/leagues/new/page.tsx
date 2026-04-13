import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NavBar } from "@/components/nav-bar";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { generateJoinCode } from "@/lib/scoring";

async function createLeagueAction(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const name = String(formData.get("name") ?? "").trim();
  const season = String(formData.get("season") ?? "2025-26").trim();
  const draftType = String(formData.get("draft_type") ?? "manual") as
    | "manual"
    | "auto";
  const teamName = String(formData.get("team_name") ?? "").trim();

  if (!name || !teamName) {
    redirect("/leagues/new?error=Name+and+team+name+are+required");
  }

  // Ensure the profile exists (the signup trigger should have done it, but
  // we fall back here so creation never fails for first-time users).
  await supabase
    .from("profiles")
    .upsert(
      { id: user.id, display_name: user.email ?? "Player", email: user.email },
      { onConflict: "id" },
    );

  const joinCode = generateJoinCode();

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .insert({
      name,
      season,
      commissioner_id: user.id,
      join_code: joinCode,
      draft_type: draftType,
    })
    .select("*")
    .single();

  if (leagueError || !league) {
    redirect(
      `/leagues/new?error=${encodeURIComponent(leagueError?.message ?? "Failed to create league")}`,
    );
  }

  // The commissioner also gets a team in the league.
  const { error: teamError } = await supabase.from("teams").insert({
    league_id: league.id,
    owner_id: user.id,
    name: teamName,
  });
  if (teamError) {
    redirect(
      `/leagues/new?error=${encodeURIComponent(teamError.message)}`,
    );
  }

  redirect(`/leagues/${league.id}`);
}

export default async function NewLeaguePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await searchParams;

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  return (
    <>
      <NavBar displayName={profile?.display_name ?? user.email ?? "Player"} />
      <main className="mx-auto max-w-xl px-6 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Create a new league</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createLeagueAction} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="name">League name</Label>
                <Input
                  id="name"
                  name="name"
                  required
                  placeholder="Chel Boys 2026"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="season">Season</Label>
                <Input id="season" name="season" defaultValue="2025-26" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="team_name">Your team name</Label>
                <Input
                  id="team_name"
                  name="team_name"
                  required
                  placeholder="The Enforcers"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="draft_type">Draft type</Label>
                <Select id="draft_type" name="draft_type" defaultValue="manual">
                  <option value="manual">Manual (click to pick)</option>
                  <option value="auto">
                    Auto (best available by playoff points)
                  </option>
                </Select>
              </div>
              {error && (
                <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {error}
                </div>
              )}
              <Button type="submit" className="w-full">
                Create league
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
