import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// WO-003 Stream A. Replaces the shared-password HMAC cookie with real Supabase
// sessions. Two jobs here:
//   1. refresh the auth cookie (Server Components can't write cookies)
//   2. gate routes before they render
//
// Authorization beyond "is this person signed in" is deliberately NOT decided
// here. Which clients a user may see is enforced by RLS (migration 012), so a
// mistake in this file cannot leak data on its own. This layer only decides
// where to send someone.

// The old model had two shared passwords: "admin" and "viewer". Mapping to real
// roles is deliberately not one-to-one. Old "admin" covered both client
// configuration AND everyday pod work (research, logging a change); those are
// now separated, so a pod lead can do their job without holding the keys to
// client credentials.
const OWNER_ONLY = ["/admin"];                            // client config, tokens
const AGENCY_ONLY = ["/dashboard", "/command", "/research"]; // day-to-day pod work

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: { headers: req.headers } });

  const key = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!key) throw new Error("SUPABASE_ANON_KEY missing");

  const supabase = createServerClient(process.env.SUPABASE_URL!, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: { headers: req.headers } });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });

  // getUser() revalidates with the auth server; getSession() would trust a
  // cookie the client controls.
  const { data: { user } } = await supabase.auth.getUser();
  const path = req.nextUrl.pathname;

  if (!user) return redirectTo("/login", req, path);

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  // Authenticated with Supabase but with no profile row, or deactivated: not a
  // member of this application. Treat as signed out rather than falling through
  // to a page that would render empty and look broken.
  if (!profile || !profile.is_active) return redirectTo("/login", req, path, "no_access");

  const isAgency = ["owner", "pod_lead", "specialist"].includes(profile.role);

  // Client users have no business on agency surfaces. Send them to their portal
  // rather than a login screen they are already past.
  if (AGENCY_ONLY.some((p) => path.startsWith(p)) && !isAgency) {
    return NextResponse.redirect(new URL("/portal", req.url));
  }

  if (OWNER_ONLY.some((p) => path.startsWith(p)) && profile.role !== "owner") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return res;
}

function redirectTo(pathname: string, req: NextRequest, next: string, reason?: string) {
  const url = req.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  url.searchParams.set("next", next);
  if (reason) url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/command/:path*",
    "/admin/:path*",
    "/research/:path*",
    "/portal/:path*",
  ],
};
