// api/auth — sign-out only.
//
// WO-003 Stream A. Sign-IN moved to the client (supabase.auth.signInWithPassword
// on /login), because @supabase/ssr writes the session cookies directly. What is
// left server-side is sign-out, which must clear the cookies on a response.
//
// The shared-password grant this file used to implement is gone.
// DASHBOARD_PASSWORD is now unused and should be removed from Vercel.
// ADMIN_PASSWORD is still read by /api/admin as a bearer token for server-side
// writes — that is a separate machine credential, not a human login, and is
// left alone here.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST() {
  const store = cookies();
  const res = NextResponse.json({ ok: true });

  const key = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!key) return NextResponse.json({ error: "not configured" }, { status: 500 });

  const supabase = createServerClient(process.env.SUPABASE_URL!, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) =>
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
    },
  });

  await supabase.auth.signOut();
  return res;
}
