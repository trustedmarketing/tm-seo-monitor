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

Bloom does not currently have a standard DPA or a published subprocessor list.
Their founder offered to put both in place, and we have asked (see
`docs/bloom-dpa-request-email.md`). They also do not offer IP or trademark
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
   security review.
3. Publish the subprocessor list somewhere a client can be pointed at.

None of this is urgent this week. All of it is much cheaper to do now, at eleven
vendors and thirteen clients, than after the first client asks the question.
