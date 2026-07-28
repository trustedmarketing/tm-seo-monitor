// lib/platformPlaybook.ts — what each network actually rewards.
//
// WO-004. These are the rules the month planner builds against. They are written
// down here rather than left in a prompt for three reasons: they are arguable and
// should be arguable in review, they change as platforms change, and a rule
// nobody can find is a rule nobody can correct.
//
// ── The honesty rule for this file ───────────────────────────────────────────
// Everything below is either (a) mechanical — a documented format or limit — or
// (b) a defensible operating heuristic. Where it is a heuristic, the comment
// says so. Nothing here should read as a measured fact about a client's audience:
// the only measured facts we have are in social_metrics_daily, and the planner
// weights those ABOVE anything in this file.

export type Network =
  | "instagram" | "facebook" | "linkedin" | "tiktok" | "twitter" | "youtube"
  | "pinterest" | "google_business_profile";

/**
 * PostFlow names some networks differently from the playbook.
 *
 * `linkedin_page` is still LinkedIn; planning for it under a null playbook meant
 * every slot fell back to a plain image on default days, silently losing the
 * format mix and the "no links in the body" rule that make LinkedIn work.
 */
const ALIASES: Record<string, Network> = {
  linkedin_page: "linkedin",
  linkedin_profile: "linkedin",
  facebook_page: "facebook",
  instagram_business: "instagram",
  x: "twitter",
  gbp: "google_business_profile",
  google_my_business: "google_business_profile",
};

export type Format = "image" | "carousel" | "video" | "short" | "text" | "link" | "story";

export type NetworkPlaybook = {
  network: Network;
  label: string;
  /** Sensible posts-per-month range when the client has no stated cadence. */
  cadence: { min: number; max: number };
  /** Format mix as weights. The planner uses these as proportions, not rules. */
  mix: Partial<Record<Format, number>>;
  /** Local windows that tend to carry engagement. Heuristic, not measured. */
  bestDays: number[];      // 0 = Sunday
  /** What this network's algorithm actually rewards, in one line. */
  rewards: string;
  /** Things that measurably hurt reach on this network. */
  avoid: string[];
  captionHint: string;
};

const PLAYBOOK: Record<Network, NetworkPlaybook> = {
  instagram: {
    network: "instagram", label: "Instagram",
    cadence: { min: 12, max: 20 },
    // Carousels earn saves, short video earns reach. A month of only one of them
    // optimises for half the funnel.
    mix: { carousel: 3, short: 3, image: 2, story: 2 },
    bestDays: [2, 3, 4],
    rewards: "Saves and shares far more than likes. Watch-through on video.",
    avoid: [
      "Link-in-bio calls to action with nothing else in the post",
      "Reposting a landscape video without reframing it",
    ],
    captionHint: "First line has to earn the tap on 'more'. Front-load the point.",
  },

  facebook: {
    network: "facebook", label: "Facebook",
    cadence: { min: 8, max: 16 },
    mix: { image: 3, short: 3, text: 2, link: 1 },
    bestDays: [2, 3, 4],
    rewards: "Comments and meaningful replies. Native video over linked video.",
    // Well-documented: outbound links suppress reach relative to native content.
    avoid: ["Outbound links in the post body", "Cross-posted Instagram captions with IG-specific wording"],
    captionHint: "Plainer and slightly longer than Instagram. Ask something answerable.",
  },

  linkedin: {
    network: "linkedin", label: "LinkedIn",
    cadence: { min: 8, max: 12 },
    mix: { text: 4, carousel: 3, image: 2, video: 1 },
    bestDays: [2, 3, 4],
    rewards: "Dwell time and comments in the first hour. Document posts over-index.",
    avoid: ["External links in the post body", "Posting on weekends for B2B audiences"],
    captionHint: "Lead with a specific claim or number. No engagement-bait openers.",
  },

  tiktok: {
    network: "tiktok", label: "TikTok",
    cadence: { min: 12, max: 30 },
    mix: { short: 9, video: 1 },
    bestDays: [2, 3, 4, 5],
    rewards: "Completion rate and rewatches. Volume matters more than on other networks.",
    avoid: ["Repurposed 16:9 footage", "Slow first two seconds"],
    captionHint: "Short. The hook belongs in the first frame, not the caption.",
  },

  twitter: {
    network: "twitter", label: "X",
    cadence: { min: 12, max: 40 },
    mix: { text: 6, image: 3, video: 1 },
    bestDays: [1, 2, 3, 4],
    rewards: "Replies and quote posts. Threads for anything over one idea.",
    avoid: ["Outbound links in the first post of a thread"],
    captionHint: "One idea, stated flat. No wind-up.",
  },

  youtube: {
    network: "youtube", label: "YouTube",
    cadence: { min: 4, max: 12 },
    mix: { short: 7, video: 3 },
    bestDays: [4, 5, 6],
    rewards: "Click-through on the thumbnail, then retention.",
    avoid: ["Titles that hide the subject", "Shorts over 60 seconds"],
    captionHint: "The title does the work. Description carries the detail.",
  },

  google_business_profile: {
    network: "google_business_profile", label: "Google Business Profile",
    // GBP What's New posts expire after 7 days, so a steady low cadence beats
    // bursts — an empty profile between bursts is a worse signal than fewer posts.
    cadence: { min: 4, max: 8 },
    mix: { image: 7, link: 3 },
    bestDays: [1, 3, 5],
    rewards: "Local intent. Posts surface directly in the map pack and on the profile.",
    avoid: [
      "Reposting an Instagram caption verbatim — GBP readers are already looking for you",
      "Posting without an image, which reduces how prominently it renders",
    ],
    captionHint: "Short, local, and specific. Name the service and the area. One clear next step.",
  },

  pinterest: {
    network: "pinterest", label: "Pinterest",
    cadence: { min: 8, max: 25 },
    mix: { image: 7, carousel: 2, video: 1 },
    bestDays: [0, 6],
    rewards: "Saves, and search intent months after posting.",
    avoid: ["Text-heavy images", "Seasonal pins published in-season rather than ahead"],
    captionHint: "Write for search. Say what the thing is plainly.",
  },
};

export function playbookFor(network: string | null | undefined): NetworkPlaybook | null {
  if (!network) return null;
  const raw = network.toLowerCase().trim();
  const k = (ALIASES[raw] ?? raw) as Network;
  return PLAYBOOK[k] ?? null;
}

/** Canonical name for a network as the vendor spelled it. */
export function normaliseNetwork(network: string): string {
  const raw = network.toLowerCase().trim();
  return ALIASES[raw] ?? raw;
}

export function allNetworks(): Network[] {
  return Object.keys(PLAYBOOK) as Network[];
}

/**
 * A default monthly volume when the client has no stated cadence.
 *
 * Deliberately the LOW end of each network's range. A platform that quietly
 * commits an agency to thirty posts a month it never agreed to is worse than one
 * that under-plans and says so.
 */
export function defaultCadence(networks: string[]): number {
  const books = networks.map(playbookFor).filter(Boolean) as NetworkPlaybook[];
  if (books.length === 0) return 12;
  return books.reduce((a, b) => a + b.cadence.min, 0);
}

/**
 * Format mix for a set of slots, as a flat list to deal out.
 *
 * Proportional to the playbook weights, so a 12-post Instagram month lands
 * roughly 3-4 carousels, 3-4 shorts, 2 images and 2 stories rather than twelve
 * of whatever the last winning post happened to be.
 */
export function formatSequence(network: string, slots: number): Format[] {
  const book = playbookFor(network);
  if (!book) return Array<Format>(slots).fill("image");

  const entries = Object.entries(book.mix) as [Format, number][];
  const total = entries.reduce((a, [, w]) => a + w, 0);

  const out: Format[] = [];
  for (const [fmt, weight] of entries) {
    const n = Math.round((weight / total) * slots);
    for (let i = 0; i < n; i++) out.push(fmt);
  }

  // Rounding can over- or under-fill. Trim from the end, pad with the heaviest.
  const heaviest = entries.sort((a, b) => b[1] - a[1])[0]?.[0] ?? "image";
  while (out.length > slots) out.pop();
  while (out.length < slots) out.push(heaviest);

  // Interleave so the month does not open with four carousels in a row.
  const byFormat = new Map<Format, number>();
  for (const f of out) byFormat.set(f, (byFormat.get(f) ?? 0) + 1);

  const spread: Format[] = [];
  while (spread.length < slots) {
    for (const [fmt, n] of byFormat) {
      if (n > 0 && spread.length < slots) {
        spread.push(fmt);
        byFormat.set(fmt, n - 1);
      }
    }
  }
  return spread;
}
