// lib/personaContext.ts — WO-006 stream I. Resolves a persona pick (from a
// <select> in a form) into the free-text fields lib/adCreative.ts's
// AdCreativeBrief and lib/adCopy.ts's generateAdCopy() already expect.
// Explicit overrides win — a form (or ops-route caller) that also types a
// custom angle isn't overridden by the persona's stored one.
import type { SupabaseClient } from "@supabase/supabase-js";

export async function resolvePersonaFields(
  db: SupabaseClient,
  personaId: string | null,
  overrides: { personaName?: string | null; angle?: string | null }
): Promise<{ personaName: string | null; angle: string | null }> {
  if (!personaId) {
    return { personaName: overrides.personaName ?? null, angle: overrides.angle ?? null };
  }
  const { data } = await db.from("client_personas").select("name, messaging_angle").eq("id", personaId).maybeSingle();
  return {
    personaName: overrides.personaName ?? data?.name ?? null,
    angle: overrides.angle ?? data?.messaging_angle ?? null,
  };
}
