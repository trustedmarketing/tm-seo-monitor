// lib/db.ts — Supabase server client with caching disabled.
// Next.js caches outgoing GET fetches on the server; without this,
// dashboard pages can serve stale database reads indefinitely.
import { createClient } from "@supabase/supabase-js";

export function dbClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      global: {
        fetch: (url, options) => fetch(url, { ...options, cache: "no-store" }),
      },
    }
  );
}
