# Note to the CLO — vendor data terms in client contracts

**From:** Thomas / CTO · **Date:** 2026-07-28
**Trigger:** Adopting Bloom for creative generation surfaced a gap that will
recur with every vendor we add.

---

## The short version

The Growth OS platform passes client material to third-party vendors as a normal
part of doing the work. That is not new, but it is now systematic and growing, and
our client agreements should say so explicitly rather than leaving it implied.

Three things to build into the contract template going forward.

---

## 1. Permission to use subprocessors, named

Client agreements should state plainly that we use third-party services to
deliver the work, that those services may process client material, and that we
remain accountable for them.

Without that clause we are technically in breach the moment we upload a client's
logo to a generation tool, however routine that is.

## 2. A commitment we actually hold vendors to

The clause should commit us to holding a written data processing agreement with
any vendor that touches client material, covering at minimum:

- **Purpose limitation.** The vendor uses the material to do the job and nothing else.
- **No model training.** This one matters more than it used to. Several vendors in
  our stack are AI tools, and "we may use your content to improve our services" is
  standard language that would let a client's brand assets train someone's model.
  Bloom confirmed in writing that they do not, and that they run on commercial
  APIs that do not train on API data by default. We should require that
  explicitly rather than hoping for it.
- **Breach notification** with a stated timeframe.
- **Deletion on termination**, and a defined export window before deletion.

## 3. Our own subprocessor list

We should maintain one and be able to show it. Clients increasingly ask, and the
honest answer today would take an afternoon to assemble.

Current vendors that touch client material, as a starting point:

| Vendor | What it holds |
|---|---|
| Supabase | Platform database: client performance data, tokens (encrypted) |
| Vercel | Application hosting |
| DataForSEO | Client domains and keywords; crawls client sites |
| Google (GSC, GA4, Ads) | Client analytics and search data |
| Meta | Client ad account data |
| Shopify | Client store data for eCommerce clients |
| PostFlow | Client social content and performance |
| ClickUp | Client task and delivery records |
| Bloom | Client brand assets and generated creative |
| Anthropic | Content drafting, where used |
| ScreenshotOne | Renders client web pages |

Several of these predate the platform. The list is not a new exposure, it is an
existing one written down.

---

## What prompted this specifically

**Updated 2026-07-28, after Bloom declined.** We asked for a DPA and subprocessor
list (`docs/bloom-dpa-request-email.md`). Ray replied that Bloom has neither, and
that after reviewing the work involved they will not be putting them in place in
the near term. He was explicit that he did not want to promise a timeline he
could not meet, and offered a limited path: run the brand-fidelity pass on the
first brands, then revisit before any wider rollout.

That is an honest answer, and it is also a firm no. The adoption decision was
recorded as conditional on the DPA arriving, so the condition is now permanently
unmet and the decision has to be re-made rather than carried forward as if it
had been satisfied.

**Position taken:** proceed with the limited pilot Ray described, under a
constraint of our own — **only assets the client has already published publicly**
go to Bloom. Logos, website imagery, product photography already live on a
storefront. Nothing unreleased, nothing customer-identifiable, nothing
confidential. That is a materially lighter exposure than the DPA question implies,
because the material is already public.

What we do have in writing, from Ray's evaluation answers: customer assets are
not used for model training, and Bloom runs on commercial APIs that do not train
on API data by default. An email is weaker than an agreement, but it is a stated
commitment from the founder rather than an assumption.

**Before any wider rollout**, this needs revisiting with the CLO. A vendor that
cannot provide a DPA at all is a different proposition at thirteen clients than
at two, and it is worth knowing what the alternatives look like before that
decision is forced. They also do not offer IP or trademark
indemnification, which we have accepted as a known risk and mitigated
structurally rather than contractually: every generated creative passes a human
approval before it can run, and ad launches are always human-approved.

That mitigation is real but it is a mitigation, not a transfer of risk. Worth
knowing when the indemnity language in client contracts is next reviewed, since
we are absorbing exposure rather than passing it on.

---

## Suggested next steps

1. Add the subprocessor clause to the standard client agreement template.
2. Make "signed DPA in place" a gate in vendor onboarding, alongside pricing and
   security review. Bloom is the live example of why: the question was asked
   after adoption was already underway, which left us negotiating from a weaker
   position than if it had been asked during evaluation.
3. Publish the subprocessor list somewhere a client can be pointed at.

None of this is urgent this week. All of it is much cheaper to do now, at eleven
vendors and thirteen clients, than after the first client asks the question.
