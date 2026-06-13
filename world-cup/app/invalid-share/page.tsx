import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/** Shown when a /share/<token> link points at no (or a regenerated) league. */
export default function InvalidSharePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <Card>
        <CardHeader>
          <CardTitle>This link no longer works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-ice-300">
          <p>
            The share link you followed is invalid or has been replaced. Ask
            the league commissioner for an up-to-date link.
          </p>
          <Link href="/login">
            <Button size="sm">Log in</Button>
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
