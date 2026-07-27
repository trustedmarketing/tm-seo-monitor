# Trusted Marketing — WordPress Theme

You are working on a custom WordPress block theme for **Trusted Marketing**, a revenue-first growth agency for $500K–$5M eCommerce and service brands. The site is the agency's own marketing site — it has to be exceptional because it's the proof.

This file is your standing brief. Read it at the start of every session.

---

## Goals

The site exists to prove the agency's positioning: revenue-first, technically sharp, AI-discoverable. Every decision should be measured against four targets:

1. **Lighthouse 95+ mobile, 99+ desktop**, LCP < 1.8s, CLS < 0.05, JS on homepage < 50KB.
2. **AI-discoverable.** Rank in Google AI Overviews, ChatGPT, Perplexity, Gemini. Achieved through clean semantic HTML, JSON-LD on every page type, `/llms.txt`, question-led subheadings.
3. **Path-aware.** Visitors choose eCommerce or Service paths; content variants render server-side based on cookie/URL/page default.
4. **Editorial polish.** Restraint, precision, careful typography. The italic-in-green signature is the one expressive flourish — use it sparingly.

---

## Tech stack (locked, don't change without a reason)

- WordPress 6.5+ on **WP Engine Agency** (live); Local by Flywheel for dev
- PHP 8.1+, strict types where reasonable
- **ACF Pro** for all custom blocks (block.json + render.php + fields.php pattern)
- **Vanilla CSS** with custom properties — no Tailwind, no Sass, no build step
- **Vanilla JS**, deferred — no jQuery, no framework
- Self-hosted **Instrument Serif** (display) + **Inter Variable** (body)
- WP Engine's EverCache + Cloudflare Enterprise (via Global Edge Security) handle perf — don't add cache plugins

What we explicitly do **not** use:
- Tailwind, Bootstrap, or any utility CSS framework
- Sage, Genesis, or any starter theme framework
- React-based custom Gutenberg blocks (ACF Pro blocks only)
- Page builders (Elementor, Divi, etc.)
- WP Rocket / LiteSpeed Cache / W3 Total Cache (EverCache handles it)

---

## Brand identity

### Colors (defined in both `theme.json` and `assets/css/tokens.css`)

| Token | Hex | Use |
|---|---|---|
| Deep Charcoal | `#080808` | Primary dark surface — most marketing surfaces are dark |
| Performance Green | `#C7FF6A` | The accent. Reserved for emphasis, CTAs, italic display words. **Never** body text, **never** large flat backgrounds |
| Midnight Blue | `#0F1A2B` | Deep secondary surface, charts |
| Warm Stone | `#D8DCCE` | Light neutral surface |
| Graphite | `#4A4F55` | Mid neutral, secondary text on light |

### Typography

- **Display:** Instrument Serif. Used at scale (40–128px). **Italic is the brand signature** — used to colorize key revenue/growth nouns in Performance Green.
- **Body/UI:** Inter Variable. 400/500/600/700.
- **Eyebrows:** ALL CAPS, 12px, 0.12em tracking, often with a Performance Green dot before.

### Voice

Clear, commercially sharp, practical, confident. Sounds like an operator who understands growth mechanics — not an account manager.

- "We" for the company, "you/your" for the client. Never "users" or "customers" when talking about the reader.
- **Sentence case** for headlines. ALL CAPS only on eyebrow labels.
- Short, declarative. Pairs and triplets are signature: *"Stop wasting traffic. Start capturing revenue."*
- **Use:** fix, find, build, own, convert, grow, revenue, leaks, friction, ownership, system, compounding, measurable, clarity, signals, data, visibility
- **Avoid:** full-service, innovative solutions, world-class, synergy, cutting-edge, unleash, revolutionize, best-in-class, anything that hides the point
- **No emoji.** Use `·` (middle dot) as separator.

### Visual rules

- Mostly flat. **No gradients on type or buttons.**
- Photography: product-real, color-cast cool/desaturated/high-contrast. No illustration.
- Motion: 120–200ms transitions, 360ms entrances, ease-out `cubic-bezier(0.2, 0.7, 0.2, 1)`. No bounces, no springs, no parallax. Numbers can count up on scroll-in — that's the one expressive motion.
- Hover: green CTAs go to ~92% opacity, light green CTAs deepen to `#8FCC2E`.
- Borders: 1px hairlines. 2px strong only for the green focus ring.
- Shadows: quiet, never colored. Cards on dark use 1px hairline borders, not shadows.
- Corners: mostly square, lightly rounded. Buttons/inputs 8px, cards 12px. Pill radius reserved for status badges.

---

## Architecture

```
trusted-marketing/
├── style.css                 theme metadata only
├── theme.json                design tokens — single source of truth for editor + frontend
├── functions.php             entry point, loads /inc modules in order
├── index.php                 empty, required by WP
├── templates/                FSE templates (HTML)
├── parts/                    template parts (header.html embeds <!-- wp:tm/header /-->)
├── inc/
│   ├── setup.php             theme supports, image sizes, CPTs (tm_case_study, tm_insight)
│   ├── cleanup.php           strip WP bloat (emoji script, generator, RSS clutter, comments)
│   ├── enqueue.php           CSS/JS loading + tm_enqueue_block_assets() helper
│   ├── path-state.php        eCommerce vs Service path persistence, sets body class
│   ├── seo.php               JSON-LD: Organization, WebSite, Article, Service, BreadcrumbList
│   ├── llms-txt.php          serves /llms.txt and /llms-full.txt
│   └── blocks.php            ACF block auto-discovery from /blocks/*
├── blocks/                   ACF Pro blocks, one folder per block
│   └── header/
│       ├── block.json
│       ├── render.php
│       ├── helpers.php       defaults + render helpers (function_exists wrapped)
│       ├── fields.php        ACF field group registration
│       ├── style.css         block-scoped CSS (auto-enqueued when block renders)
│       └── script.js         block-scoped JS (auto-enqueued, deferred)
└── assets/
    ├── css/
    │   ├── tokens.css        design tokens, mirrors theme.json (always loaded)
    │   ├── theme.css         shared component primitives (always loaded)
    │   └── editor.css        block editor only
    ├── js/
    │   ├── path-state.js     in head — sets body class before paint
    │   └── ui.js             deferred — count-up, scroll reveal, sticky nav blur
    ├── fonts/                self-hosted TTFs
    └── images/               logos and OG images
```

---

## Block convention

Every section of the site is one ACF Pro block in `/blocks/[slug]/`. Required files:

```
blocks/[slug]/
  block.json          metadata, registers block as tm/[slug]
  render.php          markup, calls tm_enqueue_block_assets(__DIR__) at top
  fields.php          ACF field group keyed off { 'param' => 'block', 'value' => 'tm/[slug]' }
  style.css           block-scoped CSS (auto-loaded only when block renders on the page)
```

Optional:
```
  helpers.php         render helpers + default content arrays — wrapped in function_exists
  script.js           block-scoped JS (auto-loaded, deferred)
```

`inc/blocks.php` auto-discovers and registers anything in `/blocks/`. Drop a folder in, refresh wp-admin, the block appears in the editor under the **Trusted Marketing** category.

---

## Hard rules (these came from real bugs — don't break them)

1. **Block names are `tm/[slug]`, not `acf/tm-[slug]`.** Modern ACF Pro registers blocks via `block.json` using the name field directly. Template parts reference them as `<!-- wp:tm/header /-->`.

2. **Single-line `<a>` opening tags inside ACF render output.** Multi-line `<a>` tags split across newlines get mangled by `wpautop`-style filters in some contexts. Always:
   ```php
   <a href="..." class="..." data-x="...">
   ```
   Never:
   ```php
   <a
       href="..."
       class="..."
   >
   ```

3. **Helper functions in render templates must be wrapped in `function_exists()`** or kept in a separate `helpers.php` loaded with `require_once`. ACF can re-render blocks multiple times in editor preview — bare function declarations cause "cannot redeclare" fatals.

4. **Use semantic CSS variables**, not raw hex codes. `var(--fg1)`, `var(--accent)`, `var(--bg-elevated)`. The `tm-dark` class flips all of these for dark sections.

5. **No `<form>` tags inside React/Gutenberg artifacts.** Use button onClick handlers. (Doesn't apply to PHP/HTML in the theme.)

6. **No `localStorage` / `sessionStorage` in any client code.** Use cookies (already wired through `tm_path` for the path system) or in-memory state.

7. **Always check `function_exists('get_field')`** before calling ACF functions in render code that might run before ACF loads.

8. **Quote field paths in JSON font filenames carefully.** Inter's variable font filename is `Inter-VariableFont_opsz,wght.ttf` (with comma). The comma is real — match it exactly in `theme.json` and `tokens.css`.

---

## Path system (critical concept)

Visitors land in one of three states: `ecommerce`, `service`, or `none` (no choice yet).

The active path is resolved server-side in `inc/path-state.php` in this priority:
1. `?path=ecommerce|service` URL parameter (sets cookie too)
2. `tm_path` cookie (30-day persistence)
3. Page-level ACF field `default_path`
4. `null`

`tm_get_path()` returns the active path. Body class is added: `tm-path-ecommerce`, `tm-path-service`, or `tm-path-none`.

Blocks that vary by path:
- Use `tm_get_path()` server-side to render the right variant on first paint (no flash)
- Use `data-path="ecommerce"` / `data-path="service"` attributes for variant elements; CSS in `theme.css` hides the inactive one based on body class
- Use `data-path-only` on elements that should only show when a path IS selected
- Use `data-path-select="ecommerce|service"` on clickable elements that should set the path

The path-state JS layer (`assets/js/path-state.js`) handles client-side switching without a page reload.

---

## SEO/GEO/LLM scaffolding

`inc/seo.php` outputs JSON-LD on every page:
- **Organization** + **WebSite** with SearchAction (every page)
- **Article** schema for `tm_insight` and `tm_case_study` posts
- **Service** schema when page has `page_type=service` ACF field or service template
- **BreadcrumbList** on all interior pages

`inc/llms-txt.php` serves `/llms.txt` (short summary) and `/llms-full.txt` (full content) for AI crawlers. Both are auto-generated from posts and pages.

If Rank Math or Yoast is installed, the theme detects it and skips its own Open Graph output. Don't fight the SEO plugin.

---

## Performance discipline

Every block we add must pay for its weight. Before merging:

- Block CSS only loads when the block is on the page (via `tm_enqueue_block_assets()`)
- Block JS is deferred and only loads when the block is on the page
- Images use `loading="eager"` only above-the-fold; everything else is lazy by default
- No third-party scripts without explicit discussion (analytics is Plausible or GA4 via GTM server-side)

Run a Lighthouse check on the dev install after every major block. If we regress below 95 mobile, fix before moving on.

---

## What's built

**Foundation:** scaffold, `theme.json`, tokens, theme.css, path system, JSON-LD, llms.txt, both CPTs registered, FSE templates, header/footer parts.

**Blocks shipped:**
- `tm/header` — sticky nav, logo, primary nav with Services + Who We Help + Insights mega menus, path indicator pill, Book a Call CTA, mobile overlay with dedicated close button.

---

## What's next (in order)

1. **`tm/footer`** — replace the placeholder footer with proper site footer (logo + columns + secondary nav + small print).
2. **`tm/hero`** — homepage hero with the path-aware headline, italic-green emphasis, dual CTA.
3. **`tm/path-selector`** — the eCommerce/Service path selection block (large version on home, distinct from the mega menu version).
4. **`tm/revenue-leak`** — "Where Revenue Hides" three-card section.
5. **`tm/growth-system`** — the integrated services grid with pillars.
6. **`tm/outcomes`** — stat cards + featured case study.
7. **`tm/why-trusted`** — four-pillar grid (Revenue Over Vanity, Own Your Platform, Data-Led, Built for Growth).
8. **`tm/how-it-works`** — methodology timeline.
9. **`tm/thought-leadership`** — featured insights row.
10. **`tm/final-cta`** — closing CTA section.

After homepage blocks are done, build out the page templates: Service page, Industry/Audience page, Case Study, Insight.

---

## Pending fixes to apply (from previous session)

These three small CSS tweaks need to land in `blocks/header/style.css`. Apply them on first session:

**Logo bigger:**
```css
.tm-header__logo img {
	height: 48px;       /* was 36px */
	max-width: 260px;   /* was 220px */
}
```

**Nav items bigger, white default, green on hover:**
```css
.tm-nav__link {
	font-size: 16px;                     /* was 14.5px */
	color: var(--tm-white);              /* was var(--tm-stone-400) */
}
.tm-nav__link:hover { color: var(--tm-performance-green); }  /* was var(--tm-white) */
```

**Active italic-green a touch bigger to match:**
```css
.tm-nav__item.is-current > .tm-nav__link .tm-nav__label {
	font-size: 19px;    /* was 17px */
}
```

---

## Working style

- I work iteratively. Build a block, test on the dev install, refine, move on. Don't hold work waiting for perfection.
- I prefer reviewing each block file-by-file when something is new, but you can apply small tweaks (CSS adjustments, copy edits, bug fixes) directly without asking.
- Match my voice when generating site copy: direct, commercially sharp, no fluff. Use the `Use` and `Avoid` vocabulary lists above.
- Validate before declaring done: PHP syntax (`php -l`), JSON validity, view source for unexpected output, hover-test interactive elements.
- When you hit something the brand brief doesn't cover, ask. Don't invent positioning or messaging.

## Validation commands

```bash
# PHP syntax check
find . -name "*.php" -exec php -l {} \;

# JSON validation
python3 -c "import json; json.load(open('theme.json')); print('valid')"

# Local site root
cd "/Users/thomasmcshane/Local Sites/trusted-marketing/app/public"
```

## Reference docs in this repo

- `assets/fonts/README.md` — required font files and where to source them
- `assets/images/README.md` — logo file conventions
- `blocks/README.md` — block development guide
- `README.md` — full project documentation including setup steps
