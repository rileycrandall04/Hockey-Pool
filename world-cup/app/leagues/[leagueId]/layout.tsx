import { Ticker } from "@/components/ticker";

export const dynamic = "force-dynamic";

/** Wraps every league page with a persistent results ticker at the very top. */
export default async function LeagueLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  return (
    <>
      <Ticker leagueId={leagueId} />
      {children}
    </>
  );
}
