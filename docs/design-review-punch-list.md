# Design Review — Growth OS Dashboard (v1 export)
**Reviewed:** Growth OS.dc.html · ApprovalCard.dc.html · RecCard.dc.html
**Verdict:** approve the direction and build from it. The items below are gaps to close before engineering, not a redesign.

---

## What the design got right (don't let these regress in build)

- **Second yes on spend.** Creative uploads paused; a separate modal with daily *and* monthly exposure before anything spends. This is the spend guard expressed as interaction design.
- **Decline → reason → 60-day suppression**, with **Muted rules** visible in Settings. This is what keeps the queue from rotting into noise.
- **"Who approves what" matrix in Settings**, including a *Nobody, automatically* tier. The autonomy ladder is now a product surface, not a policy doc.
- **"Staged by {agent}"** attribution on rec cards — good for trust and debugging when a rule misfires.
- **Portal opens on "Is this working?" answered in a sentence.** Correct audience framing.
- **Honest states designed, not bolted on**: "Measuring — 12 days left. We will not guess before then," plus a negative-verdict card with *Draft the note*.
- **Changes log as receipts** with a *Decided by* column.
- **Earned empty state**: "Queue clear. You decided 14 changes today. Median decision time 38 seconds."
- **Mobile rules stated explicitly** (2×2 metrics, 44px targets, serif numeral floor 32px, tap-to-expand instead of hover).

---

## Punch list — must close before build

**1. Undo needs a defined window and must not corrupt measurement.**
Published cards offer *Undo*. Define: Undo is available 60 minutes and reverses cleanly. After that the control becomes **Revert**, which writes a *second* change-ledger entry rather than erasing the first. A change that ran for three days then got reverted is data, not a mistake to hide — measurement depends on it.

**2. Failed-job state is missing.**
The flow is: running → steps → done. Design the fourth outcome: publish fails (WP timeout, Meta rejects the creative, deploy breaks). Needs the actual error, a Retry, and the card must stay in the queue rather than silently disappearing.

**3. Slipped playbook items have no treatment.**
Portal shows "9 of 22 commitments done · 41% of July." Design what a *late* commitment looks like: status chip + one-line reason, owner-set date. A silently incomplete bar is worse than an honest "moved to August — waiting on photos from you."

**4. Client decline round-trip isn't designed.**
Client declines a blog topic or ad photo. Where does it land agency-side? Design the return path: rec reopens with the client's reason attached, visibly distinct from an internal decline.

**5. Role-aware card states.**
The approval matrix implies a Specialist cannot approve a campaign launch. Design the **locked** state on a card above your role: visible, explained ("Pod lead approval required"), with a one-click *Request approval*.

**6. Automatic changes need an audit surface.**
Alt text, internal links, schema, and review requests ship with no human in the loop. They must still be visible — add an **Automatic** filter to the Changes log so nothing the system does is invisible to the team or the client.

**7. Per-module data freshness.**
Organic has "Search Console lands 48 hours behind." Paid is near-real-time, GBP lags ~3 days, social varies. Each module needs its own freshness line, or clients will compare to platform UIs and find mismatches — which is the accuracy gate failing in public.

**8. Bulk approve must not cross clients.**
"Approve all 3" is correctly scoped to low-risk change types. Add the second constraint: bulk actions never span clients without explicit per-client selection (client-isolation rule).

**9. SLA breach needs a consequence, not just a color.**
"4 cards past their 24-hour window" is displayed. Define what happens: notify pod lead at 24h, escalate to attention view at 48h. Otherwise the stale styling is decoration.

**10. "Share this page" on the portal AEO view is a security decision.**
Either it produces a signed, expiring link, or it comes out of v1. Flag to CTO before it's built.

---

## Smaller notes

- Sample data mixes plausible-real and invented client names (Ridgeline HVAC, Harbor Dental, Dana). Standardize on obviously-fictional names for demos so nothing is mistaken for a live account.
- Confirm the QC "Run scan now" has a rate limit — it triggers a crawl that costs money.
- The portal Approvals copy ("either answer is useful") is the right tone; keep that voice for every client-facing empty and error state.
- Frequency ceilings (3.0 prospecting / 5.0 retargeting) are hard-coded in copy — make them per-client settings, since ecom and local service behave differently.
