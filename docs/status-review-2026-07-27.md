# Status Review — Growth OS, 2026-07-27
**To:** CTO (build) + COO (delivery) · **From:** build session
**Covers:** WO-003 approval through Wave 1 completion, plus the Bloom decision.

**Headline:** Wave 1 shipped and the hard gate is closed — client isolation is now
enforced by Postgres rather than by application code. The build is ahead of where
the feasibility review expected it. **The risks that surfaced today are almost all
delivery risks, not build risks**, and one of them has been live for five days.

---

## CTO — build

### Shipped to production today

| | State | Proven how |
|---|---|---|
| **Auth + per-client RLS** (012) | ✅ live | Two real accounts; a client user sees 1 client / 201 rankings, an owner sees 2 / 300; asking directly for the other client's UUID returns **zero rows** |
| **Audit log + approvals** (014) | ✅ live | `UPDATE` and `DELETE` rejected by trigger, as service_role. The probe row is permanently in staging's log |
| **Agency shell + client_type** (013) | ✅ live | UI matches the design; tabs derive from client type |
| **Screenshot service** | ⚠️ code complete | Mock path tested; live vendor round-trip **not** verified — see risk 2 |

Migrations 012–014 applied to staging *and* production. 145 unit tests, 11 staging
tests. The RLS coverage guard is not a hard-coded list: any table with a
`client_id` and no policy fails the build, so the two tables added later were
caught automatically.

### One security defect, found and fixed same-day

Push review caught an **open redirect** in the login `next` parameter: the check
asked whether `next` pointed at `/portal` but never whether it pointed at this
site. `/login?next=https://evil.com` would have signed a user in legitimately and
then handed them to an attacker — credible phishing precisely because the sign-in
is genuine. Live roughly ten minutes on a private dashboard. Fixed, 19 regression
tests covering absolute, protocol-relative, backslash and lookalike-host forms.

**Worth noting for governance:** this was caught by automated review, not by the
author. That is the control working, and it is an argument for keeping it.

### Risk 1 — Shopify may block before/after capture 🚨

Verified against the vendor's own request log: `getsaltydog.com` returned **429**
to three consecutive capture attempts while `stripe.com` captured fine from the
same account in the same minute. Shopify is rate-limiting the capture service.

This is **not** a configuration problem. The Approval Card's central promise is a
*visual* before/after, and the client blocking captures is both our eCommerce
flagship and the portal pilot. Mitigations shipped (browser UA, backoff on
429/5xx, an error that names the site rather than the vendor). If the block is
persistent rather than throttling, **Stream D needs a designed fallback** — a
rendered diff, staging-only capture, or text-based before/after.

Decide while designing the card, not after. Cheap to test: run the vendor
playground against the store a few times and see whether it *ever* succeeds.

### Risk 2 — the live screenshot path is unverified

Sensitive Vercel variables cannot be read back by design, so the vendor
round-trip cannot be tested from a developer machine. An owner-only ops route now
runs it server-side and reports which hop failed. Not yet exercised.

### Open decision before Wave 2 — platform fork

The review sequenced the first execution path as **WordPress**. The portal pilot
is **Salty Dog, which is Shopify**. Either build the Shopify adapter first (one
client end to end, matching the pilot, reordering the review) or do WordPress on
Masterpiece (follows the review, splits the first proof across two clients).

**Recommend Shopify on Salty Dog** — "prove it on one client before touching a
second" is the discipline the spec asks for, and splitting the first proof loses
exactly that. WordPress additionally needs WP Engine staging and per-site
application passwords, which have not been started.

---

## COO — delivery

### The finding that matters most: a collector failed for five days and nobody looked

The GA4 conversions collector had errored on **every run since 22 July** — the
service account was never granted Viewer on Salty Dog's property. Fixed today.

The important part is not the bug. **The dashboard was showing it.** The attention
rail displayed *"Collection failed · Salty Dog · conversions"* the whole time. This
was not a blind spot in the tooling; it was an unowned surface.

Plan §8 already says: *"the cross-client attention view has a named daily owner.
Unowned queues rot."* **That owner was never assigned.** This is the first concrete
evidence of the cost, and it arrived before a single client had a login.

**Recommendation:** assign the attention-view owner this week, before the approval
queue exists. A queue with an SLA and no owner will fail the same way, only with
client-visible consequences.

### The onboarding runbook is not being followed

Two independent symptoms, same root cause:

- **Salty Dog** was missing its GA4 grant — Appendix A step 5, skipped.
- **DAPS.FIT** is on the **Dominate** tier with no store, no ad accounts, nothing
  collected since 24 July, and now no client type. It looks onboarded and is not.

Both are invisible until someone looks at the data rather than the client list.
**Recommendation:** treat Appendix A as a checklist with a completion record per
client, not a description. The platform should show which steps are outstanding.

### The accuracy gate is about to be tested, and we should not wait for a client to test it

AEO shows **0%** for Salty Dog. That is real data — 121 prompt checks, zero
mentions, zero citations — not a display bug. It is either a genuine finding (an
opportunity, and the section the plan says clients find most novel in QBRs) or a
false negative in detection.

**This must be spot-checked before it appears on any client screen.** One wrong
number in front of a client costs more than the dashboard has earned, and this is
exactly the class of number the accuracy gate exists for. It is a ten-minute check:
ask ChatGPT the tracked question and see whether Salty Dog appears.

### Call tracking has now surfaced three times in one day

It gates the portal headline metrics, the local-client Overview revenue slot, and
the Automation tab. Choosing an eCommerce pilot took it off the critical path for
*delivery* — it did not answer it.

**It remains the only open decision with no deadline and no owner.** For most of
the portfolio (local service), *Calls · Cost per job · Jobs booked* cannot be
computed at all. The honest fallback is GBP calls plus form conversions, with
cost-per-job removed from the design — which is a design change, not a config one.

### Client-facing readiness

A real client-domain account (`tom@getsaltydog.com`) now exists and lands on an
honest holding page: signed in, nothing shown, no invented numbers. That is the
right behaviour, and it is worth being deliberate about **not** sharing those
credentials until the portal has something on it. A first impression of "nothing
to see yet" is worse than no login.

---

## Where the five external blockers stand

| | Status |
|---|---|
| Meta system-user token | ✅ Was already live — the review's claim was stale |
| PostFlow API | ✅ Full REST API confirmed; token vaulted and verified readable |
| GBP API access | ✅ **Submitted 27 Jul** — one application per GCP project, not per client. Response ~10 Aug |
| Google Ads Basic access | ⏳ Explorer token vaulted; upgrade not submitted. Two ~2-min account-linking steps outstanding |
| Call tracking | ⛔ **Not decided.** See above |

Three of five closed or submitted in a day. The GBP scope turned out far smaller
than assumed — one form, then a per-client Manager invite.

## Bloom — decided

**Adopt for subset.** Every blocking gate cleared in writing: agency/client use
explicitly permitted (the ToS was silent), no model training (they run on
commercial APIs that do not train by default), ownership retained, 4:5 supported.

**Two conditions:** request the DPA + subprocessor list (none exist; the founder
offered to put them in place), and start month-to-month at $340 rather than
committing $3,672 annually before the fidelity spike finishes.

**One risk accepted, on the record:** no IP or trademark indemnity. Mitigated
structurally — every creative passes a human approval card and ad launches are
always human-approved — but that is a mitigation, not a transfer, and whoever
signs client contracts should know it is there.

⚠️ **Pricing detail that changes planning:** each aspect ratio is a separately
billed asset. 2,000 credits is roughly **660 three-ratio concepts/month**, not
2,000. Budget in assets, not concepts.

---

## Joint recommendation — what to do next

1. **Assign the attention-view owner.** This week, before the approval queue
   exists. Today proved the cost while the stakes were still internal.
2. **Answer the call-tracking question**, or explicitly accept the reduced local
   headline and change the design to match. It has been open since the plan.
3. **Spot-check the AEO 0%** before it reaches a client screen.
4. **Decide the Wave 2 platform fork** so the right adapter gets built.
5. **Make Appendix A a tracked checklist**, and finish or reclassify DAPS.FIT.

Items 1, 3 and 5 are delivery discipline and cost almost nothing. They are also
the three most likely to embarrass us in front of a client if left.
