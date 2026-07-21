import { cookies } from "next/headers";
import { verifyToken } from "@/lib/authToken";
import {
  domainRankOverview, backlinksSummary, rankedKeywords,
  competitorsDomain, keywordSuggestions,
} from "@/lib/dataforseo";

function clean(d: string): string {
  return d.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
}

export async function POST(req: Request) {
  const role = await verifyToken(cookies().get("tm_auth")?.value, process.env.CRON_SECRET!);
  if (role !== "admin") return Response.json({ error: "Admin access required" }, { status: 401 });

  const body = await req.json();
  const loc = body.location_code || 2840;
  const lang = body.language_code || "en";

  try {
    switch (body.action) {
      case "audit": {
        const domain = clean(body.domain);
        const [overview, links, top] = await Promise.all([
          domainRankOverview(domain, loc, lang),
          backlinksSummary(domain),
          rankedKeywords(domain, loc, lang, 25),
        ]);
        return Response.json({ domain, overview, links, topKeywords: top });
      }
      case "competitors": {
        const domain = clean(body.domain);
        const competitors = await competitorsDomain(domain, loc, lang, 15);
        return Response.json({ domain, competitors });
      }
      case "keywords": {
        const keywords = await keywordSuggestions(String(body.seed ?? "").trim(), loc, lang, 40);
        return Response.json({ seed: body.seed, keywords });
      }
      default:
        return Response.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
