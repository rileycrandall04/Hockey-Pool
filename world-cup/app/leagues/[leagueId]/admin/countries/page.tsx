import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getUser, loadLeagueAccess } from "@/lib/league-access";
import { isAppAdmin } from "@/lib/admin";
import { NavBar } from "@/components/nav-bar";
import { Flag } from "@/components/flag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Country } from "@/lib/types";

export const dynamic = "force-dynamic";

async function requireAdmin(leagueId: string) {
  const user = await getUser();
  if (!user) redirect("/login");
  const access = await loadLeagueAccess(leagueId, user.id, user.email ?? null);
  if (!access) redirect("/dashboard");
  const svc = createServiceClient();
  if (!(await isAppAdmin(svc, user.id, user.email))) redirect(`/leagues/${leagueId}`);
  return { access, svc };
}

async function saveCountryAction(formData: FormData) {
  "use server";
  const leagueId = String(formData.get("league_id") ?? "");
  const { svc } = await requireAdmin(leagueId);
  const id = Number(formData.get("country_id"));
  const name = String(formData.get("name") ?? "").trim();
  const group = String(formData.get("group_letter") ?? "").trim().toUpperCase() || null;
  const rankRaw = String(formData.get("fifa_rank") ?? "").trim();

  await svc
    .from("countries")
    .update({
      name: name || undefined,
      group_letter: group,
      fifa_rank: rankRaw === "" ? null : Math.trunc(Number(rankRaw)),
      manual_override: true, // protect from the nightly sync
    })
    .eq("id", id);

  revalidatePath(`/leagues/${leagueId}/admin/countries`);
  redirect(`/leagues/${leagueId}/admin/countries?saved=${id}`);
}

export default async function CountriesAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { leagueId } = await params;
  const { saved } = await searchParams;
  const { access, svc } = await requireAdmin(leagueId);
  const { league, displayName, isCommissioner } = access;

  const { data: countryRows } = await svc
    .from("countries")
    .select("*")
    .order("group_letter")
    .order("fifa_rank");
  const countries = (countryRows ?? []) as Country[];

  return (
    <>
      <NavBar displayName={displayName} leagueId={leagueId} draftStatus={league.draft_status} isCommissioner={isCommissioner} />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
        <div className="mb-2 flex items-center justify-between">
          <h1 className="text-xl font-bold text-ice-50">Edit countries</h1>
          <Link href={`/leagues/${leagueId}/admin`} className="text-xs text-ice-400 hover:underline">← Admin</Link>
        </div>
        <p className="mb-4 text-xs text-ice-400">
          Correct any group or FIFA rank. Saving marks a country as
          hand-edited, so the nightly API sync won&rsquo;t overwrite it.
        </p>

        <div className="space-y-1.5">
          {countries.map((c) => (
            <form
              key={c.id}
              action={saveCountryAction}
              className={"flex items-center gap-2 rounded-md border px-2 py-1.5 " + (saved === String(c.id) ? "border-green-500/50 bg-green-500/5" : "border-puck-border bg-puck-bg")}
            >
              <input type="hidden" name="league_id" value={leagueId} />
              <input type="hidden" name="country_id" value={c.id} />
              <Flag code={c.code} url={c.flag_url} />
              <Input name="name" defaultValue={c.name} className="min-w-0 flex-1" />
              <Input name="group_letter" defaultValue={c.group_letter ?? ""} placeholder="Grp" className="w-12 text-center" maxLength={1} />
              <Input name="fifa_rank" type="number" defaultValue={c.fifa_rank ?? ""} placeholder="#" className="w-16 text-center" />
              <Button type="submit" size="sm" variant="secondary">Save</Button>
            </form>
          ))}
        </div>
      </main>
    </>
  );
}
