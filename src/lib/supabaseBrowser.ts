// lib/supabaseBrowser.ts — browser Supabase client (sign-in / sign-out only).
//
// The cookies this writes are what middleware and userClient() then read, so the
// session is shared between browser and server rather than kept in JS memory.
// Note: no localStorage anywhere in this app — @supabase/ssr is cookie-based,
// which is both the house rule and what makes server-side RLS reads possible.
import { createBrowserClient } from "@supabase/ssr";

export function browserClient() {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!key) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY missing");
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
}
