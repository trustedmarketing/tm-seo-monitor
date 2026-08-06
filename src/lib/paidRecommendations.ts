// lib/paidRecommendations.ts — WO-006 stream C: paid-media rules engine,
// same pattern as lib/recommendations.ts (pure function over already-fetched
// rows, emitting prioritized Rec[]) but reading campaign ROAS rollups
// instead of keyword/prompt rows. Wired into recSync.ts's
// syncRecommendations() alongside the SEO/AEO builder — same `recommendations`
// table, lifecycle, and 28-day change-ledger measurement.
//
// Scoped to what ad_metrics_daily + campaigns actually support today.
// Explicitly NOT built here (flagged, not silently dropped): search-term
// waste -> negative keywords, and audience overlap — both need collector
// data (search-term reports, audience definitions) this repo doesn't collect
// yet. True frequency-based creative-fatigue detection needs reach data for
// the same reason; the CTR-decline rule below is a proxy, not a replacement.
import type { Rec } from "@/lib/recommendations";
import { ROAS_BENCHMARKS, type CampaignRollup } from "@/lib/paidRollup";

const ORDER: Record<Rec["severity"], number> = { high: 0, medium: 1, low: 2 };

// A campaign spending less than 25% of its benchmark ROAS is a materially
// different problem (probably broken, not just under-optimized) from one
// running at 80% of target — split high vs medium on that basis.
const SEVERE_ROAS_FACTOR = 0.6;
const BUDGET_OVERAGE_FACTOR = 1.25;

export function buildPaidRecommendations(rollups: CampaignRollup[]): Rec[] {
  const recs: Rec[] = [];

  for (const r of rollups) {
    if (r.status === "removed") continue; // nothing actionable on a removed campaign
    const label = r.campaignName ?? r.campaignId;
    const benchmark = ROAS_BENCHMARKS[r.platform];

    // ── 30-day ROAS below the tier benchmark ──
    if (benchmark && r.thirtyDaySpend > 0 && r.thirtyDayRoas != null && r.thirtyDayRoas < benchmark.low) {
      recs.push({
        key: `paid_roas_30d_${r.id}`,
        severity: r.thirtyDayRoas < benchmark.low * SEVERE_ROAS_FACTOR ? "high" : "medium",
        category: "Paid",
        title: `"${label}" 30-day ROAS ${r.thirtyDayRoas.toFixed(2)}× is below the ${benchmark.label} target`,
        detail: `Trailing 30-day return is under the tier benchmark for ${platformLabel(r.platform)}. Review targeting, creative, and bids before increasing spend further.`,
      });
    }

    // ── 7-day dipped below target while the 30-day trailing figure still
    // looks fine — an early warning before the 30-day average catches up. ──
    else if (
      benchmark &&
      r.sevenDaySpend > 0 &&
      r.sevenDayRoas != null &&
      r.sevenDayRoas < benchmark.low
    ) {
      recs.push({
        key: `paid_roas_7d_${r.id}`,
        severity: "medium",
        category: "Paid",
        title: `"${label}" ROAS dipped to ${r.sevenDayRoas.toFixed(2)}× over the last 7 days`,
        detail: `The 30-day trailing average is still above the ${benchmark.label} target, but the last week has slipped below it — worth a look before it drags the 30-day figure down too.`,
      });
    }

    // ── day-prior vs 7-day divergence — a sharp one-day swing worth a look
    // before it becomes a trend. ──
    if (
      r.dayPriorSpend > 0 &&
      r.dayPriorRoas != null &&
      r.sevenDayRoas != null &&
      r.sevenDayRoas > 0 &&
      r.dayPriorRoas < r.sevenDayRoas * 0.5
    ) {
      recs.push({
        key: `paid_day_drop_${r.id}`,
        severity: "low",
        category: "Paid",
        title: `"${label}" yesterday's ROAS (${r.dayPriorRoas.toFixed(2)}×) is well below its 7-day average (${r.sevenDayRoas.toFixed(2)}×)`,
        detail: `One day of underperformance isn't a trend yet, but worth a look if it repeats — check for a tracking gap, a creative that just fatigued, or a competitor promo.`,
      });
    }

    // ── budget pacing — yesterday's spend materially over the set daily budget ──
    if (r.dailyBudget != null && r.dailyBudget > 0 && r.dayPriorSpend > 0) {
      const pacing = r.dayPriorSpend / r.dailyBudget;
      if (pacing >= BUDGET_OVERAGE_FACTOR) {
        recs.push({
          key: `paid_pacing_over_${r.id}`,
          severity: "medium",
          category: "Paid",
          title: `"${label}" spent ${Math.round(pacing * 100)}% of its daily budget yesterday`,
          detail: `Yesterday's spend of $${r.dayPriorSpend.toFixed(0)} ran well over the $${r.dailyBudget.toFixed(0)} daily budget. Confirm this is deliberate (accelerated delivery) rather than budget-band drift.`,
        });
      }
    }

    // ── cleanup nudge — marked active but nothing spent in 30 days ──
    if (r.status === "active" && r.thirtyDaySpend === 0) {
      recs.push({
        key: `paid_zero_spend_${r.id}`,
        severity: "low",
        category: "Paid",
        title: `"${label}" is marked active but has spent nothing in 30 days`,
        detail: `Either delivery is blocked (budget, approval, disapproved ad) or this campaign should be paused/removed to keep the account clean.`,
      });
    }
  }

  return recs.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]).slice(0, 8);
}

function platformLabel(platform: string): string {
  if (platform === "google_ads") return "Google Ads";
  if (platform === "microsoft") return "Microsoft/Bing Ads";
  if (platform === "meta") return "Meta";
  return platform;
}
