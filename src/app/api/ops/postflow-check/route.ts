// api/ops/postflow-check — verify a client's PostFlow connection.
//
// WO-003 Stream N. Two things can be wrong and they need different fixes: the
// org token (shared across all clients) or the per-client group id. Reporting
// them separately is the whole point of this pattern.
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { readSecret } from "@/lib/vault";
import { ping, listGroups, listAllSocialAccounts } from "@/lib/postflow";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function GET(req: Request) {
  const profile = await getProfile();
  if (profile?.role !== "owner") {
    return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  }

  const clientId = new URL(req.url).searchParams.get("client");
  const db = dbClient();

  const token = await readSecret(db, "postflow");
  const out: Record<string, unknown> = { token_present: !!token };
  if (!token) {
    return NextResponse.json({ ok: false, failed_at: "no_token",
      hint: "vault_rotate_secret('<token>', 'postflow')", ...out });
  }

  // Every group the token can see, so an unset client can be pointed at one
  // without anyone digging through the PostFlow UI for an opaque id.
  try {
    const g = await listGroups(token);
    out.available_groups = g.groups;
    // Only present when parsing found nothing — an empty list and an
    // unrecognised envelope look identical otherwise.
    if (g.rawShape !== undefined) {
      out.groups_raw_response = JSON.stringify(g.rawShape).slice(0, 1200);
      out.groups_note = "No groups parsed. The raw response is above so the shape can be read rather than guessed.";
    }
  } catch (e) {
    out.available_groups_error = (e as Error).message.slice(0, 300);
  }

  // Accounts per group. A group with no connected profile can be published to
  // by nobody, and that is invisible from the group list alone.
  try {
    const accounts = await listAllSocialAccounts(token);
    const byGroup: Record<string, { network: string | null; name: string | null }[]> = {};
    for (const a of accounts) {
      const k = a.groupId ?? "(none)";
      (byGroup[k] ??= []).push({ network: a.network, name: a.name });
    }
    out.accounts_total = accounts.length;
    out.accounts_by_group = byGroup;
  } catch (e) {
    out.accounts_error = (e as Error).message.slice(0, 200);
  }

  const q = db.from("clients").select("id, name, postflow_group_id").eq("active", true);
  const { data: clients } = clientId ? await q.eq("id", clientId) : await q;

  const results = [];
  for (const c of (clients ?? []) as { id: string; name: string; postflow_group_id: string | null }[]) {
    if (!c.postflow_group_id) {
      results.push({ client: c.name, client_id: c.id, ok: false, failed_at: "no_group_id",
        hint: "pick one from available_groups above and set it in the client's Settings tab" });
      continue;
    }
    try {
      const p = await ping(token, c.postflow_group_id);
      const connected = ((out.accounts_by_group as Record<string, unknown[]>) ?? {})[c.postflow_group_id] ?? [];
      results.push({
        client: c.name, ok: true, group_id: c.postflow_group_id,
        posts_last_7d: p.posts,
        connected_accounts: connected.length,
        // Publishing needs a connected profile; collecting does not. A client can
        // look healthy on collection and still be unpublishable.
        can_publish: connected.length > 0,
      });
    } catch (e) {
      results.push({ client: c.name, ok: false, failed_at: "api_error",
        group_id: c.postflow_group_id, error: (e as Error).message.slice(0, 200) });
    }
  }

  return NextResponse.json({ ok: results.some((r) => r.ok), ...out, results });
}
