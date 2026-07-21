// lib/clickup.ts — ClickUp REST client (Stream 5: recs → tasks → shipped).
// Resilient like lib/slack.ts: no-op + log when CLICKUP_TOKEN is unset, and every
// call is try/caught so a ClickUp outage never sinks a collection run. MOCK_APIS=1
// short-circuits before any network call, so tests and staging never spend real
// ClickUp API calls or create real tasks.
import { mockApis } from "@/lib/apiMock";

const API_BASE = "https://api.clickup.com/api/v2";

// The prefix is REQUIRED on every task this client creates — staging/dev syncs
// must never be mistaken for a real, client-authorized ClickUp task.
export const STAGING_PREFIX = "[STAGING TEST] ";

export type RecSeverity = "high" | "medium" | "low";

export interface ClickUpTaskInput {
  title: string;
  detail?: string | null;
  severity: RecSeverity;
}

export interface ClickUpTask {
  id: string;
  url: string;
}

// ClickUp priority scale: 1 urgent, 2 high, 3 normal, 4 low.
const PRIORITY_BY_SEVERITY: Record<RecSeverity, number> = {
  high: 2,
  medium: 3,
  low: 4,
};

// Deterministic fake task for MOCK_APIS=1 / tests — no network, no state.
function mockTask(name: string): ClickUpTask {
  const id = `mock-${Buffer.from(name).toString("hex").slice(0, 16)}`;
  return { id, url: `https://app.clickup.com/t/${id}` };
}

export async function createTaskFromRec(
  listId: string,
  rec: ClickUpTaskInput
): Promise<ClickUpTask | null> {
  const name = `${STAGING_PREFIX}${rec.title}`;

  if (mockApis()) return mockTask(name);

  const token = process.env.CLICKUP_TOKEN;
  if (!token) {
    console.warn("[clickup] CLICKUP_TOKEN unset — would have created task:", name);
    return null;
  }
  if (!listId) {
    console.warn("[clickup] no list id provided — would have created task:", name);
    return null;
  }

  try {
    const res = await fetch(`${API_BASE}/list/${listId}/task`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({
        name,
        description: rec.detail ?? "",
        priority: PRIORITY_BY_SEVERITY[rec.severity],
      }),
    });
    if (!res.ok) {
      console.error("[clickup] create task HTTP", res.status);
      return null;
    }
    const json = (await res.json()) as { id?: string; url?: string };
    if (!json.id) {
      console.error("[clickup] create task response missing id");
      return null;
    }
    return { id: json.id, url: json.url ?? `https://app.clickup.com/t/${json.id}` };
  } catch (e) {
    console.error("[clickup] create task failed:", (e as Error).message);
    return null;
  }
}
