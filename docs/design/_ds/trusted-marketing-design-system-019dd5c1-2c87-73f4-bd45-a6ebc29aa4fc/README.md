# Trusted Marketing — Design System

Revenue-first growth partner for $500K–$5M eCommerce and service brands.
Stop wasting traffic. Start capturing revenue.

This folder is the portable design system for Trusted Marketing — colors,
type, logos, components, voice, and a UI kit you can reach for when
building anything in the brand.

---

## Sources

The system was built from these inputs (all included in `uploads/` for
posterity, or copied into the working folders below):

- **Figma file:** `Trusted Marketing Brand Board.fig` (mounted as a virtual
  filesystem during creation). Single page, 10 frames covering the
  primary lockup, stacked lockup, icon, and a one-color variant — each in
  light/dark contexts.
- **Brand library** (`uploads/00-brand-overview.md` … `07-ai-context-prompt.md`):
  positioning, voice & tone, brand pillars, services architecture,
  messaging assets, and an AI context prompt — the canonical source for
  copy and tone.
- **Logo PNGs** (`uploads/TM - *.png`): primary lockup, icon, and one-color
  variants in light / dark / mono.
- **Brand board screenshot** (`uploads/image.png`, mirrored to
  `assets/brand-board.png`): the single most useful reference for the
  full visual system — palette names + hex, type pairing, brand
  attributes, in-use mockups.

---

## Index — what's in this folder

```
README.md                 ← you are here
SKILL.md                  ← agent skill manifest (Claude Code compatible)
colors_and_type.css       ← all color + type tokens; semantic CSS vars
assets/                   ← logos, icon marks, brand board reference
  logo-primary-lockup.png         (TM — Black × Green, light bg)
  logo-primary-lockup-dark.png    (TM — White × Green, dark bg)
  logo-onecolor-light.png         (TM — One Color, on light)
  logo-onecolor-dark.png          (TM — One Color, on dark)
  icon-black-green.png            (icon mark, light bg)
  icon-white-green.png            (icon mark, dark bg)
  icon-onecolor.png               (icon mark, mono)
  brand-board.png                 (the source brand board)
preview/                  ← design-system tab cards (one HTML per card)
ui_kits/
  marketing-site/         ← marketing/site UI kit (the only product surface
                            represented in the source materials)
```

---

## Brand at a glance

| | |
|---|---|
| **Positioning** | Revenue-first growth partner. Not a "full-service agency." |
| **Audience** | Founder-led $500K–$5M eCommerce (Shopify) and service (WordPress) brands. |
| **Promise** | Find the 30–40% of revenue hiding in existing traffic, data, search, and lifecycle systems. |
| **Tagline candidates** | "Marketing built to drive revenue, not vanity." · "Stop wasting traffic. Start capturing revenue." |
| **Pillars** | Revenue Over Vanity · Own Your Platform · Data-Led Problem Solving · Built for Growth-Stage Brands |

---

## Content fundamentals

How copy is written for Trusted Marketing.

**Voice profile.** Clear, commercially sharp, practical, confident. Sounds
like an operator who understands growth mechanics — not an agency
account manager. Direct, not dramatic. Smart, not academic. Strategic,
not vague.

**Person.** "We" for the company, "you / your" for the client. Never
"users" or "customers" when talking about the reader.

**Casing.** Sentence case for headlines and UI. The only ALL CAPS in the
system are the eyebrow labels (e.g. `PRIMARY LOGO`, `COLOR PALETTE`,
`BRAND ATTRIBUTES`) lifted directly from the brand board. Letter-spacing
on those caps is generous (~0.12em).

**Punctuation.** Short, declarative sentences. Pairs and triplets are a
signature rhythm: *"Stop wasting traffic. Start capturing revenue."* ·
*"Find the leaks. Fix the friction. Build the systems."* · *"Lead
generation · Performance · Results."* Periods do real work.

**Vocabulary — use.** *fix · find · build · own · convert · grow ·
revenue · leaks · friction · ownership · system · compounding ·
measurable · clarity · signals · data · visibility.*

**Vocabulary — avoid.** *full-service · innovative solutions · world-class ·
synergy · cutting-edge · unleash · revolutionize · best-in-class.* Any
phrase that hides the point. Vanity-metric language ("clicks, traffic,
impressions, engagement") is only ever quoted to be challenged.

**Emoji.** No. Not part of the brand. Use a small bullet glyph
(`·` or a green dot) for separators, never a 🚀.

**Writing formula.** Every page or section should follow:
1. Name the business problem.
2. Explain the hidden cost.
3. Show the practical fix.
4. Connect the fix to revenue or ownership.

**Examples (in tone):**

> *We are not here to inflate reports. We are here to grow revenue.*

> *Your website should be an asset you own, not a system you rent.*

> *Most brands do not need more noise. They need clearer signals and
> better execution.*

> *The next stage of growth usually starts by fixing what is already
> underperforming.*

---

## Visual foundations

**Palette.** Five named colors anchor the system, lifted from the Figma
brand board:

| Token | Hex | Use |
|---|---|---|
| Deep Charcoal | `#080808` | Primary dark surface. Most marketing surfaces are dark. |
| Performance Green | `#C7FF6A` | The signature accent. Reserved for emphasis, CTAs, the leaf in the icon, italic display words. Never as a body-text color and never as a large flat background. |
| Midnight Blue | `#0F1A2B` | Deep secondary surface; data viz, charts, alternate dark sections. |
| Warm Stone | `#D8DCCE` | Light neutral surface. Pairs with Deep Charcoal in the icon. |
| Graphite | `#4A4F55` | Mid neutral; secondary text, dividers on light. |

White and black are unrestricted. Every other color is a tint or shade
of these — see `colors_and_type.css` for the full list.

**Type.** Two families.
- **Instrument Serif** for display. Used at scale (40–200px in the
  Figma source). Italic is a brand signature, used to colorize key
  nouns in green (*"systems that __generate leads__, __drive growth__"*).
- **Inter** for everything else — UI, body, eyebrows, navigation,
  buttons. 400 / 500 / 600 / 700.

**Spacing.** 4-pt scale (`--space-1` = 4px through `--space-24` = 96px).
Marketing layouts breathe — section padding tends to `--space-16` to
`--space-24` vertical. UI density is moderate.

**Backgrounds.** Mostly flat. Deep Charcoal is the hero surface for
marketing; white is the hero for app/UI. Warm Stone shows up as a
beige neutral panel. **No gradients on type or buttons.** The only
gradient permitted is a near-imperceptible vignette to add depth to
large dark photo plates.

**Imagery.** Photographic and product-real (the brand board shows
business cards, embroidered hats, phones, laptops, mugs) — not
illustration. Color-cast cool / desaturated / high-contrast. When
charts appear, the trend line is Performance Green on a charcoal
background.

**Animation.** Restrained. 120–200ms transitions on hover/press, 360ms
for entrances. Easing is `cubic-bezier(0.2, 0.7, 0.2, 1)` (a soft
ease-out). No bounces, no springs, no parallax. Numbers can count up
when they enter the viewport — that's the one expressive motion.

**Hover states.** On dark surfaces, accent buttons go from
Performance Green → ~92% opacity. On light surfaces, the green deepens
slightly to `#8FCC2E`. Text links underline-color shifts to green on
hover. Cards lift via shadow, not scale.

**Press states.** 96% scale on tappable buttons (mobile), no scale on
desktop — instead darken by ~6%. Feedback is subtle.

**Borders.** 1px hairlines using `--border` (Stone 200 on light;
Charcoal 700 on dark). Strong borders (2px) only for the green
focus ring.

**Shadows.** Quiet, near-black, never colored. Three steps —
`--shadow-sm`, `--shadow-md`, `--shadow-lg`. Cards on dark surfaces
usually use a 1px hairline border instead of a shadow.

**Corners.** Mostly square or lightly rounded. Buttons & inputs:
`--radius-md` (8px). Cards: `--radius-lg` (12px). The icon mark
itself has hard corners — that's the brand DNA. Pill radius
(`--radius-pill`) is reserved for status badges.

**Transparency / blur.** Sticky nav on dark uses `backdrop-filter: blur(12px)`
+ `rgba(8,8,8,0.7)`. Otherwise, opacity is for state (hover/disabled),
not decoration.

**Layout.** 12-col grid, max content width 1280px on marketing,
1440px on app. Generous left/right gutters. Section headers
left-aligned with eyebrow + display headline + supporting paragraph.

**Cards.** Light card: white bg, 1px Stone 200 border, 12px radius,
no shadow at rest, `--shadow-sm` on hover. Dark card: Charcoal-800
bg, 1px Charcoal-700 border, no shadow.

---

## Iconography

Trusted Marketing does not currently ship an in-house icon set. The
brand board uses simple flat-line glyphs (target, bar chart, shield,
handshake, crown) for the brand-attributes row — minimal, single-stroke,
no fill, no detail.

**Approach used in this system:** **Lucide** — a flat, 1.5–2px stroke
open-source icon set whose visual character is the closest CDN match to
those brand-board glyphs. CDN: `https://unpkg.com/lucide@latest`.
This is a substitution flagged for the user to confirm or replace.

**Rules for use.**
- 1.5px stroke, currentColor — never fill the green into icons.
- Sizes: 16, 20, 24, 32, 48px. Pick one size per surface and stick.
- Icons sit alongside copy as supporting marks — never as decoration.
- Prefer the wordmark over an icon for the brand identity. The icon
  mark (`assets/icon-*.png`) is reserved for app/avatar contexts.

**Emoji.** Not used.
**Unicode separators.** A middle-dot `·` is the canonical separator
(see brand-board: *"LEAD GENERATION · PERFORMANCE · RESULTS"*).

---

## Caveats / substitutions to confirm

- **Inter font.** The brand board labels the body face simply as
  "Inter — Body Copy / UI". Loaded via Google Fonts; if you have a
  licensed cut you'd rather ship, drop it in `fonts/`.
- **Lucide icons.** Substituted for the bespoke flat-line glyphs on the
  brand board. Replace with the original set if available.
- **Hex values.** Five core hex codes were lifted from the brand board
  PNG and cross-checked against the Figma metadata's
  `rgb(197,255,65)`-ish performance green. The board labels it
  `#C7FF6A` — we use that.

---

## Conventions for using this system

- Import `colors_and_type.css` as the first stylesheet on any HTML.
- Use semantic vars (`--fg1`, `--bg`, `--accent`) over raw color names.
- For dark sections, wrap them in `class="tm-dark"` — every semantic
  var flips automatically.
- Stick to the 4-pt spacing scale.
- One accent color. Use Performance Green like a highlighter, not paint.
