// lib/textDiff.ts — word-level before/after diff.
//
// WO-003 Stream D. For content changes this IS the evidence. Shopify blocks the
// screenshot service across the whole eCommerce book, but a title tag or meta
// description is better evidenced by exact text than by a picture of a page
// where the change is invisible anyway.
//
// Dependency-free on purpose: a diff library is a lot of surface area for
// something that has to be trustworthy. Word-level Myers-style LCS is enough for
// the strings this handles (titles, descriptions, short body edits).

export type DiffOp = { kind: "same" | "add" | "remove"; text: string };

/** Split into words while keeping the whitespace, so output reassembles exactly. */
function tokenize(s: string): string[] {
  return s.match(/\s+|[^\s]+/g) ?? [];
}

/**
 * Longest common subsequence over tokens.
 *
 * O(n·m) is fine here — these are titles and meta descriptions, not documents.
 * Guarded anyway so an unexpectedly large body edit degrades to a whole-value
 * replace rather than hanging a page render.
 */
const MAX_TOKENS = 2000;

export function diffWords(before: string, after: string): DiffOp[] {
  if (before === after) return before ? [{ kind: "same", text: before }] : [];

  const a = tokenize(before);
  const b = tokenize(after);

  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    return [
      ...(before ? [{ kind: "remove" as const, text: before }] : []),
      ...(after ? [{ kind: "add" as const, text: after }] : []),
    ];
  }

  // lcs[i][j] = length of LCS of a[i:] and b[j:]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  const push = (kind: DiffOp["kind"], text: string) => {
    const last = ops[ops.length - 1];
    if (last && last.kind === kind) last.text += text;   // coalesce for readable output
    else ops.push({ kind, text });
  };

  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { push("same", a[i]); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { push("remove", a[i]); i++; }
    else { push("add", b[j]); j++; }
  }
  while (i < a.length) push("remove", a[i++]);
  while (j < b.length) push("add", b[j++]);

  return ops;
}

/** Characters added and removed — a quick honest measure of how big a change is. */
export function diffMagnitude(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const op of ops) {
    if (op.kind === "add") added += op.text.length;
    if (op.kind === "remove") removed += op.text.length;
  }
  return { added, removed };
}

/**
 * Google truncates around 60 chars for titles and 155 for meta descriptions.
 *
 * Surfaced on the card because approving a title that gets cut off in the SERP
 * is a silent failure — it "worked", and the point of the change is lost. These
 * are display-width approximations, not guarantees.
 */
export const SERP_LIMITS = { title: 60, description: 155 } as const;

export function serpWarning(kind: keyof typeof SERP_LIMITS, value: string): string | null {
  const limit = SERP_LIMITS[kind];
  if (value.length <= limit) return null;
  return `${value.length} characters — Google truncates ${kind}s around ${limit}, so the end may not show in results.`;
}
