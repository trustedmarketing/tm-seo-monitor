// lib/roles.ts — who someone is, with no server dependencies.
//
// Split out of supabaseServer.ts when the sidebar became a client component:
// importing `isAgency` from there pulled in `next/headers` and failed the build.
// The types and the role predicate are plain data with no reason to live behind
// a server-only module — only the Supabase client itself does.
//
// supabaseServer re-exports these so existing imports keep working.

export type Role = "owner" | "pod_lead" | "specialist" | "client";

export type Profile = {
  id: string;
  organization_id: string | null;
  email: string | null;
  full_name: string | null;
  role: Role;
  is_active: boolean;
};

export const AGENCY_ROLES: Role[] = ["owner", "pod_lead", "specialist"];

/**
 * Agency side or client side.
 *
 * This decides chrome only. Data access is decided by RLS in Postgres — if this
 * function were wrong, a client would see a different nav, not different data.
 */
export function isAgency(profile: Profile | null): boolean {
  return !!profile && AGENCY_ROLES.includes(profile.role);
}
