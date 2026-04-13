import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient as createSbClient } from "@supabase/supabase-js";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Server-side Supabase client bound to the user's auth cookies.
 * Use this in Server Components, Route Handlers, and Server Actions to
 * enforce Row Level Security on behalf of the signed-in user.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // `set` cookies outside of a Server Action / Route Handler throws.
            // It's safe to ignore in Server Components where the middleware
            // has already refreshed the session.
          }
        },
      },
    },
  );
}

/**
 * Privileged Supabase client using the service-role key.
 * Bypasses Row Level Security. ONLY use this in trusted server code
 * (cron routes, commissioner admin actions, draft execution) — never
 * expose it to the client.
 */
export function createServiceClient() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
