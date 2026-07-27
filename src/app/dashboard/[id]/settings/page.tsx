// app/dashboard/[id]/settings/page.tsx — WO-003 Stream M holding page.
// The tab exists so the workspace has the design's shape; the surface behind it
// is not built yet and says so rather than rendering an empty zero.
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabaseServer";
import { ClientHeader } from "@/components/ClientHeader";
import { BeingBuilt } from "@/components/BeingBuilt";
import { workspaceTabs } from "@/lib/workspaceTabs";
import "@/styles/tm-tokens.css";

export const dynamic = "force-dynamic";

export default async function Settings({ params }: { params: { id: string } }) {
  const db = userClient();
  const { data: client } = await db
    .from("clients").select("id, name, domain, tier, client_type").eq("id", params.id).single();
  if (!client) redirect("/dashboard");

  const type = (client as any).client_type ?? null;
  // A tab that does not belong to this client type is not reachable content.
  if (!workspaceTabs(type).some((t) => t.key === "settings")) redirect(`/dashboard/${params.id}`);

  return (
    <main style={{ padding: "40px 32px 64px" }}>
      <div style={{ maxWidth: 1180 }}>
        <ClientHeader id={params.id} name={client.name} domain={client.domain} tier={client.tier}
          clientType={type} active="settings" />
        <BeingBuilt
          title="Client settings"
          reason="Integrations, cadences, guardrails, and who approves what."
          backHref={`/dashboard/${params.id}`}
        />
      </div>
    </main>
  );
}
