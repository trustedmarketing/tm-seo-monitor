// lib/supabaseServer.ts — user-scoped Supabase clients.
//
// WO-003 Stream A. There are now two ways to reach the database and the
// difference matters:
//
//   dbClient()      (lib/db.ts)  service role, bypasses RLS. Collectors, cron,
//                                admin writes. Never behind a user request that
//                                renders client-visible data.
//   userClient()    (here)       the signed-in user's session. Every policy from
//                                migration 012 applies. This is what dashboard
//                                and portal pages read through, so a client user
//                                physically cannot select another client's rows.
//
// Using dbClient() to render a page is how RLS gets quietly bypassed. If a page
// needs data, it uses userClient(). No exceptions on client-facing surfaces.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Roles and the Profile shape live in lib/roles.ts so client components can use
// them without dragging next/headers into the browser bundle. Re-exported here
// because every existing caller imports them from this module.
export { AGENCY_ROLES, isAgency } from "@/lib/roles";
export type { Role, Profile } from "@/lib/roles";
import type { Profile } from "@/lib/roles";

function anonKey() {
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!key) throw new Error("SUPABASE_ANON_KEY missing");
  return key;
}

/** Supabase client bound to the caller's session. RLS applies. */
export function userClient() {
  const store = cookies();
  return createServerClient(process.env.SUPABASE_URL!, anonKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        // Server Components cannot set cookies; middleware refreshes the session
        // instead. Swallowing here is expected, not a silent failure.
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          /* refreshed in middleware */
        }
      },
    },
    global: {
      // Same reasoning as lib/db.ts: Next caches server GETs, which would serve
      // stale dashboard reads indefinitely.
      fetch: (url, options) => fetch(url as RequestInfo, { ...options, cache: "no-store" }),
    },
  });
}



/** The signed-in user's profile, or null when signed out / deactivated. */
export async function getProfile(): Promise<Profile | null> {
  const supabase = userClient();

  // getUser() revalidates against the auth server. getSession() only decodes the
  // cookie, which is spoofable — never use it for an access decision.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("user_profiles")
    .select("id, organization_id, email, full_name, role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (!data || !data.is_active) return null;
  return data as Profile;
}

