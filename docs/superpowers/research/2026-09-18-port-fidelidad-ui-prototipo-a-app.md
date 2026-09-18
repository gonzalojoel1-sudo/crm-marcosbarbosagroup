# Faithfully porting a designed UI into an existing app

**Date:** 2026-09-18
**Scope:** How to move the `prototypes/agenda/index.html` design into `apps/web` (React 18 + TS + Vite, plain global `styles.css`, served at `/hoy`) **without losing the design**. This is the research the port spec will use to judge "does the port match the prototype's intent".
**Rule:** every concrete claim carries a source URL. When a source is secondary or when I could not verify something, it says so explicitly.

---

## 0. TL;DR — and what the repo already tells us

The port lost the design because **the prototype's CSS was treated as a sketch to re-implement, not as the authoritative artifact to carry**. Four failures are visible in the repo right now, before any external research:

1. **Two divergent token sets.** The prototype's own comment says it is the source of truth — `prototypes/agenda/index.html:13` literally reads `/* ── Tokens reales del CRM (copiados de apps/web/src/styles.css) ───────── */` — but the values no longer match the app:
   - prototype `--bg: #100f0d` vs app `apps/web/src/styles.css:2` `--bg: #0c0c0e`
   - prototype `--danger: oklch(0.66 0.155 28)` vs app `--danger: #ff5a5a`
   - prototype `--ok: #0d7c66` vs app `--ok: #34d399`
   This is textbook **token drift from two sources of truth** (see §2). The prototype had already stopped being the app's palette before React even entered the picture.
2. **The brand fonts are never loaded in production.** The prototype loads Fraunces + JetBrains Mono + Outfit from Google Fonts (`prototypes/agenda/index.html:9-11`) and sets `--display` / `--mono` (`:43-44`). The app's entry HTML (`apps/web/index.html`) has **no** `<link>` to Google Fonts and the source tree has **no** `@font-face`. `styles.css:35` asks for `font-family: Outfit, ...`, so the browser silently falls back to `-apple-system`/`Segoe UI`. The display serif and mono never appear. This is the classic "forgot the fonts" failure in §4.
3. **Colours were approximated, not carried.** A subagent reported the palette "falls slightly out of sRGB gamut". That is exactly the failure Strait's colour team documented: naively re-tinting a palette produces colours that are dark, muddy, or outside the reproducible gamut (`#ff5a5a`-style approximations). The prototype's palette is in **`oklch`**, which the DTCG spec now supports natively (§2).
4. **The app is a single global stylesheet.** No CSS Modules, no Tailwind, no CSS custom properties for the new surface — one 3,298-line `styles.css` that becomes the de-facto styling authority. That is precisely the "global styles bleed / CSS as an afterthought" environment described in §1 and §3.

**The one-line answer for #2:** make the prototype's token block a versioned artifact (a `tokens.css` / DTCG JSON) that is the **only** place a colour, font, space, radius, or motion value is defined, and have the app consume it verbatim. Everything else follows from that.

---

## 1. Why ports lose design, and how teams prevent it

### 1.1 Named causes

| # | Named cause | What it looks like | Best source |
|---|---|---|---|
| C1 | **Design tokens are not a single source of truth** | Two copies of the palette drift; one is "the real one" only by convention | Martin Fowler: tokens "serve as a single source of truth"; best practice is to make the **Git repo** the source, not the design tool — https://martinfowler.com/articles/design-token-based-ui-architecture.html |
| C2 | **CSS treated as an afterthought** | New surface re-derived "close enough" styles instead of carrying exact values | Adam Laycock's reply to "CSS is broken": *"CSS needs to be treated as a first class tool, rather than an afterthought, and these problems won't arise"* — https://medium.com/@zamarrowski/css-is-broken-5138773e17a5 (secondary, Medium; but it names the cause) |
| C3 | **Global scope + specificity** | The port's selectors either get overridden by, or leak into, unrelated app styles | Smashing, *Refactoring CSS*: global scope and specificity make new UI cause "bugs and unexpected side-effects in other parts of the app (a regression)" — https://www.smashingmagazine.com/2021/07/refactoring-css-introduction-part1 |
| C4 | **Framework-idiomatic rewriting** | The bespoke HTML/CSS is rebuilt as components, and each component's styles are re-authored in the framework's idiom rather than ported | Airbnb's DLS at React Conf 2019: global selectors caused unpredictable changes and dead CSS bloated bundles; they re-authorised customisation **through component props** — https://www.infoq.com/news/2020/02/airbnb-design-system-react-conf |
| C5 | **No reference to compare against** | "Looks close enough" merges; drift is discovered at a design review months later | SmartUI: "There's a kind of visual regression that doesn't come from code changes. It comes from the gap between what was designed and what actually shipped" — https://dev.to/anglinajhon/visual-regression-testing-a-developers-guide-to-pixel-perfect-releases-4e66 |
| C6 | **No automated visual regression** | A broken port passes the health check because HTTP 200 and a client-side error are indistinguishable | Vitest VRT: baseline screenshot + diff, with "Stable Screenshot Detection" for fonts/animations/layout settling — https://vitest.dev/guide/browser/visual-regression-testing ; Ant Design runs ~6,000 screenshots across 4 themes in CI — https://ant.design/docs/blog/visual-regression |
| C7 | **Colour re-derivation outside gamut** | Hand-picked or algorithmically lightened colours look dull/disconnected and can be out of gamut | Stripe, *Designing accessible color systems*: "simply darkening or lightening can result in dull or muted colors"; they rebuilt the palette in a **perceptually uniform** model because HSL lightness lies, and note impossible colours exist — https://stripe.com/blog/accessible-color-systems |
| C8 | **Brand type never loaded / silent fallback** | The serif and mono vanish; layout reflows because fallback metrics differ | web.dev: font swapping causes CLS when "a web font and its fallback font take up different amounts of space" — https://web.dev/articles/font-best-practices |
| C9 | **Handoff without designers + engineers in the same loop** | Design is assumed "done" and engineering optimises for shipping speed | Linear, *Why is quality so rare?*: "No handoffs, whole team iterates towards 'right'" — https://linear.app/now/why-is-quality-so-rare |
| C10 | **Fragmentation of the system across libraries/tools** | Token, component, icon, and style libraries diverge | Kong: "Trying to combine design tokens, UI components, icons, and styles into one library is a very bad pattern — each of those areas requires a separate library" — https://konghq.com/blog/engineering/lessons-learned-implementing-a-design-system |

### 1.2 Named fixes

| Fix | Mechanism | Source |
|---|---|---|
| **One versioned token artifact, Git as truth** | Tokens live in JSON/CSS in the repo; design tools sync *from* it; a translation tool generates platform output | Fowler — https://martinfowler.com/articles/design-token-based-ui-architecture.html |
| **DTCG token format + translation tool** | Vendor-neutral JSON; Style Dictionary / Terrazzo emit CSS vars, Sass, Swift, etc. | https://www.designtokens.org/ ; https://styledictionary.com/ |
| **Enforce token usage in CI** | A Stylelint plugin flags raw hex/px so the token file stays the only source | Kong — https://konghq.com/blog/engineering/lessons-learned-implementing-a-design-system |
| **Scope the new surface** | CSS Modules / `@layer` / `@scope` isolate the port so global CSS neither bleeds in nor out | §3 below |
| **Visual regression as the port's contract** | Screenshot the prototype and the app at the same viewport/states; diff in CI; the diff is the acceptance test | Vitest VRT — https://vitest.dev/guide/browser/visual-regression-testing ; Ant Design — https://ant.design/docs/blog/visual-regression |
| **Design QA ritual** | Linear's "Quality Wednesdays" (engineers find and fix small defects as real work; e.g. a hover that darkens instantly instead of fading over ~150 ms) | Linear, referenced via the *linearprincipals* guide (secondary aggregator) — https://github.com/tylergibbs1/linearprincipals/blob/main/skills/linear-design-principles/references/ui-ux-craft.md |
| **No handoffs; small teams with judgment** | The same group iterates from concept to completion | Linear — https://linear.app/now/why-is-quality-so-rare |
| **Self-hosted fonts + metric-compatible fallback** | `@font-face`, `font-display`, `size-adjust` to match fallback metrics | §4 |

### 1.3 Recommendation for §1

**Options**

| Option | What it guarantees | What it costs | Source |
|---|---|---|---|
| **Carry the prototype CSS verbatim as the port's styling layer** | Exact values, states, motion survive | You must scope it (§3) and accept prototype's global-ish selectors | Repo evidence + Zalando — https://engineering.zalando.com/posts/2018/07/decoupled-styling-ui-components.html |
| **Re-author styles in the app's conventions** | Idiomatic codebase, uniform conventions | **This is what already failed.** Every re-derivation is a chance to lose a value | Airbnb case — https://www.infoq.com/news/2020/02/airbnb-design-system-react-conf |
| **Token file + generated CSS consumed by both** | One authority; app is a consumer, not a re-implementer | Pipeline setup; discipline | Fowler / DTCG — https://martinfowler.com/articles/design-token-based-ui-architecture.html |
| **Figma as baseline in CI** | Catches design-vs-shipped drift automatically | Tooling dependency; Figma frames must exist for the calendar | SmartUI — https://dev.to/anglinajhon/visual-regression-testing-a-developers-guide-to-pixel-perfect-releases-4e66 |

**Recommendation:** treat the prototype as the **reference implementation**, extract its token block into a single versioned file, and make the React surface consume that file. Add a screenshot diff (prototype vs `/hoy`) as the port's acceptance gate. **Tradeoff:** the port becomes a fidelity exercise rather than a clean rewrite; the app gains a second styling idiom (scoped agenda vs global `styles.css`) until the rest of the app migrates. That is the correct price for this port, given the design is the product.

---

## 2. Design tokens as the single source of truth

**This is the highest-leverage section.** The goal: **one artifact (the prototype's CSS) is the authority the app consumes, and the app never redefines a value.**

### 2.1 Current best practice, and what each approach actually gives you

| Option | What it guarantees | What it costs | Source |
|---|---|---|---|
| **DTCG JSON format (W3C Community Group, stable 2025.10)** | Vendor-neutral JSON, aliases, theming, multi-brand, and **modern colour spaces incl. `oklch`**; designed exactly so "one token file generates platform-specific code" | Requires a translation step; JSON is not directly usable as CSS | Spec: https://tr.designtokens.org/format · Stable release: https://lists.w3.org/Archives/Public/public-design-tokens/2025Oct/0003.html · Glossary: https://www.designtokens.org/glossary |
| **Style Dictionary** | Takes DTCG-ish JSON and outputs CSS custom properties, Sass, JS, iOS/Android; "forward-compatible with DTCG" | Build step + config; naming conventions to maintain | https://styledictionary.com/ |
| **Tailwind v4 `@theme`** | Theme vars *are* CSS custom properties, and also generate utility classes; `@theme inline` controls whether utilities reference the var or inline the value | Introduces Tailwind; `@theme` vars live in `:root`/`:host` and are global unless scoped | https://tailwindcss.com/docs/theme · https://tailwindcss.com/docs/functions-and-directives · `@theme inline` explained by Adam Wathan: https://github.com/tailwindlabs/tailwindcss/discussions/17826 |
| **Hand-written CSS custom properties** | Zero tooling; the single `:root` block is the source; scoping is explicit | No type-checking or generation; drift is only caught by review (or a Stylelint rule) | Primer exposes tokens as CSS vars — https://github.com/primer/primitives · Polaris likewise — https://github.com/Shopify/polaris-tokens |
| **Figma Variables → code** | Design can see/edit tokens; Figma Variables are the UI | Figma is not Git: no real diff/changelog; exports need plugins; creates two sources unless synced bidirectionally | Fowler (Git should be truth, not the design tool) — https://martinfowler.com/articles/design-token-based-ui-architecture.html ; criticism of Figma-as-truth: https://baseframe.dev/blog/why-moving-tokens-away-from-figma (vendor blog, secondary) |

### 2.2 The layered model the mature systems use (and that this port should copy)

GitHub Primer and Shopify Polaris both use **three tiers** and state rules about who may reference whom. This is the structure that prevents a port from "approximating":

- **Base / primitive** tokens map directly to a raw value. Primer: *"Base color tokens … should never be used directly in code or design."* — https://primer.style/product/getting-started/foundations/color-usage
- **Functional / semantic** tokens represent UI patterns (`bgColor-default`, `color.icon.success`). Primer: these are the ones used day-to-day.
- **Component / pattern** tokens are the narrowest.
- Primer builds these with **Style Dictionary** into CSS custom properties: https://github.com/primer/primitives
- Primer's token guide uses RFC-2119 language (`MUST`/`NEVER`) and a colour-pairing matrix, e.g. `--bgColor-default` must pair with `--fgColor-default` and **never** with `fgColor-muted`: https://github.com/primer/primitives/blob/main/DESIGN_TOKENS_GUIDE.md
- Shopify Polaris splits **primitive** vs **semantic** space tokens and says use semantic where it fits: https://polaris-react.shopify.com/design/layout/layout-tokens
- Atlassian: *"Design tokens are a single source of truth to name and store design decisions"* and token names are structured `foundation.property.modifier`: https://atlassian.design/foundations/design-tokens
- Martin Fowler names the same two layers **option tokens** (what options exist) and **decision tokens** (how styles are applied): https://martinfowler.com/articles/design-token-based-ui-architecture.html

### 2.3 The concrete recommendation for this repo

The app has **no Tailwind and no CSS Modules**; it is one global `styles.css`. Given that, the lowest-risk way to make the prototype authoritative is:

1. **Extract the prototype's `:root` block** (`prototypes/agenda/index.html:14-32`) **plus** the `--display` / `--mono` / `--focus` definitions (`:43-44`, `:50`) into a single file, e.g. `apps/web/src/tokens/agenda.css`, and import it once.
2. **Fix the drift**: reconcile it against `apps/web/src/styles.css:1-20` and declare the winner for each differing value. Given the prototype is the designed artifact, its values win for the new surface; shared tokens (`--bg`, `--accent`) should be promoted to the app level so both surfaces agree.
3. **Do not re-express the palette in hex.** The prototype's `--danger` and the event colours are `oklch(...)`; the DTCG spec explicitly supports OkLCH, and Stripe's write-up explains why perceptual models are the right tool. Translating to hex is the approximation that already bit us — https://stripe.com/blog/accessible-color-systems
4. **(Optional, if the app grows)** wrap the same values in DTCG JSON and generate the CSS with Style Dictionary/Terrazzo, so the token file is also machine-checkable. Not required for this port; the hand-written CSS-var file is already a valid single source.

**Tradeoff:** the simple option (one hand-written CSS-var file) gives authority without a build step, but it relies on discipline (a Stylelint rule catches raw `#hex`/`px`, per Kong: https://konghq.com/blog/engineering/lessons-learned-implementing-a-design-system). The DTCG pipeline adds real enforcement and cross-platform reach at the cost of tooling. For a single React surface, **start with the CSS-var file and add Stylelint**; move to DTCG only when a second consumer appears.

---

## 3. Scoping the new surface inside an app with global CSS

The agenda must be immune to `styles.css` and must not leak into `styles.css`. Options, what each actually guarantees, and what it does **not**.

| Option | What it guarantees | What it costs | What it does NOT protect against | Source |
|---|---|---|---|---|
| **CSS Modules** (`*.module.css`) | Class names are **hashed and local by default**; no name collisions; styles are tied to the component | Rename/import churn; only class/id/animations are scoped — **element selectors stay global** unless localised; global styles still apply to the elements | Global CSS (e.g. `body`, `button`, `*`) still reaches module elements; you must use `:global` deliberately | https://github.com/css-modules/css-modules · local scope: https://github.com/css-modules/css-modules/blob/master/docs/local-scope.md |
| **Cascade layers** `@layer` | Explicit precedence order; unlayered styles always beat layered normal styles; a simpler selector in a later layer beats a more specific one earlier | Must declare layer order up front; `!important` ordering is **inverted** (early layers win); a port inside a layer loses to unlayered global CSS unless you control the order | It does **not** isolate selectors — it only ranks them. Global unlayered rules still win over layered ones | MDN `@layer` — https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40layer · Guide: https://developer.mozilla.org/en-US/docs/Learn/CSS/Building_blocks/Cascade_layers |
| **`@scope`** | Limits matching to a DOM subtree (scope root, optional limit); scoped selectors **cannot escape the subtree**; donut scoping excludes nested areas; uses `:where(:scope)` so bare selectors add **zero** specificity | Relatively new (Baseline-dec 2025 for `CSSScopeRule`); `&` specificity differs by engine/version; needs a scope root element | Does **not** stop global CSS from matching inside the scope (a global `button {}` still applies); it constrains *your* selectors, not other stylesheets | MDN — https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40scope · Chrome — https://developer.chrome.com/docs/css-ui/at-scope · `CSSScopeRule` Baseline 2025: https://developer.mozilla.org/en-US/docs/Web/API/CSSScopeRule |
| **Shadow DOM** | Strongest encapsulation: global selectors **don't select inside** a shadow tree, and scoped selectors don't select outside; "selectors and their associated style definitions don't bleed between scopes" | React doesn't render into shadow roots for free; styling from outside needs `::part`/CSS custom properties; fonts must be re-declared inside; portals/goal focus interactions get harder | Inherited properties (font, color, CSS custom properties) **do** cross the shadow boundary; typing/focus management is your problem | MDN CSS scoping — https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scoping |
| **`data-` attribute namespace** (e.g. `[data-agenda] .ev { … }`) | Namespaces your selectors so they can't accidentally match app markup; cheap; works today everywhere | Adds a wrapper/attribute and mildly raises specificity; verbose selectors | Global element styles (`button`, `a`, `*`, `body`) still apply inside; the app's `:focus-visible` etc. still reach it | MDN cascade (specificity) — https://developer.mozilla.org/en-US/docs/Web/CSS/Cascade |
| **`iframe`** | Total isolation: separate document, no cascade bleed either way; content cannot affect host layout | Heavy; font/CSS duplication; a11y, focus, routing, and theming all break; bad for an in-page app | Nothing inside can be styled or measured by the host without `postMessage`; not viable for a primary app surface | (No first-party spec needed; standard iframe isolation) |

**Layer-order interaction to be aware of:** unlayered normal styles always beat layered normal styles (MDN). So if the app's 3,298-line `styles.css` is unlayered and the agenda is put in `@layer agenda`, the global file wins. To use layers safely you must **first** wrap the existing `styles.css` in a layer (e.g. `@layer legacy`) with a declared order, or keep the agenda unlayered too.

**Recommendation:** use **CSS Modules for the agenda's component CSS** as the primary boundary (it is the least invasive and works in Vite out of the box), **plus a `[data-agenda]` root attribute** for the handful of global-looking rules (variables, `:focus-visible`, scrollbars) so they cannot leak. Add `@layer` only if and when `styles.css` is itself layered. **Tradeoff:** CSS Modules means the ported selectors get hashed names and must be attached via `className={styles.x}`, so the prototype's CSS needs a mechanical rename pass; the payoff is that neither surface can silently restyle the other. Shadow DOM is overkill here — inherited font/colour would still leak and React integration is real work.

---

## 4. Brand typography in a React/Vite app

### 4.1 What "forgot" the fonts, and what actually goes wrong

- **Silent substitution:** a `font-family: Outfit, ...` with no loaded `@font-face` just renders the fallback. There is no error. The design's display serif and mono metrics never appear (web.dev: browsers use the fallback if the face isn't loaded — https://web.dev/articles/font-best-practices).
- **Layout shift (CLS):** if/when the webfont does load, fallback and webfont have different metrics, so text reflows: *"layout shifts occur when a web font and its fallback font take up different amounts of space"* — https://web.dev/articles/font-best-practices
- **FOIT vs FOUT:** `font-display: block`/`auto` can render invisible text (FOIT); `swap` shows fallback then swaps (FOUT). FOUT is generally preferred over FOIT — https://web.dev/articles/optimize-webfont-loading
- **Optical sizing lost:** Fraunces is a variable font with an `opsz` axis. The prototype uses `font-optical-sizing: auto` (`prototypes/agenda/index.html:105`); if the variable face isn't served with an `opsz` range, that line does nothing. MDN: optical sizing is on by default for fonts with an `opsz` axis; small sizes get thicker strokes/larger serifs, large sizes more contrast — https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/font-optical-sizing · variable-font axes: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Fonts/Variable_fonts

### 4.2 Options

| Option | What it guarantees | What it costs | Source |
|---|---|---|---|
| **Self-hosted WOFF2 variable fonts** | One file per family covers all weights; no third-party dependency; fastest after first load; `opsz` axis available | You host and version the files; subsetting is on you | web.dev: "Self-host your web fonts"; WOFF2 best compression; variable fonts replace many files — https://web.dev/learn/performance/optimize-web-fonts |
| **`@font-face` + `font-display`** | Explicit control of block/swap/failure periods | Must pick a policy per family | https://web.dev/articles/optimize-webfont-loading |
| **Preload critical fonts** | Font discoverable early, before the stylesheet is parsed | Over-preloading competes with render-critical resources | https://web.dev/articles/optimize-webfont-loading · https://web.dev/articles/preload-critical-assets |
| **`size-adjust` / metric-matched fallback** | Reduces CLS by making the fallback occupy similar space | Requires computing/choosing fallback metrics | web.dev (font swapping and CLS) — https://web.dev/articles/font-best-practices |
| **Google Fonts CDN link (what the prototype does)** | Zero hosting work | Third-party connection setup; less control; **must be copied into the app shell or it silently doesn't load** | web.dev notes third-party font files "require separate connection setups" — https://web.dev/articles/font-best-practices |
| **Subsetting** | Much smaller files when only Latin/Spanish glyphs are needed | Build step; risk of missing glyphs | https://web.dev/articles/reduce-webfont-size |

### 4.3 Recommendation

Self-host the three families as **variable WOFF2** under `apps/web/public/fonts/`, declare them with `@font-face` (`font-display: swap` for UI/mono; `swap` or `optional` for the display serif), preload the display face, and set Fraunces' weight/`opsz` ranges so `font-optical-sizing: auto` works. Provide `size-adjust` on the fallback to blunt CLS. **Do not rely on the prototype's Google Fonts `<link>`** — the app's `index.html` does not have it, and the Vite build (`gen-shell.mjs`) would need to carry it anyway. **Tradeoff:** a small amount of build/hosting work buys deterministic rendering and removes a network dependency; the alternative (CDN link) is faster to wire but is exactly the thing that was forgotten.

---

## 5. The craft checklist: what a naive calendar port drops

The port must reproduce these **visual** details from the prototype. The prototype's own values are cited by line; external references show what "good" looks like.

### 5.1 Geometry & layout

| Detail | Prototype value | Why it matters / reference |
|---|---|---|
| Card radius | side/mini `14px` (`:72`), event `12px` (`:202`), compact `9px` (`:216`) | Radius is a system, not one value. Linear keeps 2–6 px dominant with pills reserved for badges — https://www.design-extractor.com/gallery/linear-638bvy |
| Padding scale | nav `5px 6px` (`:80`), buttons `5px 11px` (`:110`), event `7px 10px` (`:202`) | One-off paddings accumulate into noise; Primer has control/stack tokens for exactly this — https://github.com/primer/primitives/blob/main/DESIGN_TOKENS_GUIDE.md |
| Sticky header + sticky gutter | `.colhead` `position: sticky; top: 0` (`:126`), `.gutter` `position: sticky; left: 0` (`:134`) | The gutter is part of the axis, not the event — see repo research `docs/superpowers/research/2026-09-16-calendario-ux-competidores.md` §2.3 |
| Zoom/density model | `.zoomctl`, `data-compact`, "Zoom-Amplio" default | Google's 2026 density modes (Responsive/Comfortable/Compact) and Notion Calendar's "Zoom Hours" — https://support.google.com/calendar/answer/15619910 · https://cronhq.notion.site/Calendar-view-options-329f8bc37d8f4c509f7fd56a220a584e |

### 5.2 Overlap lanes (the maths a port flattens)

The prototype groups overlapping events and assigns the first free lane, then widths by lane count:

```
laneEnds = []; assign = Map()
for each event e (sorted): while lane busy -> l++; laneEnds[l] = e.min + e.dur; assign.set(e, l)
lanes = laneEnds.length
width = calc(100% / var(--lanes,1) - 8px)   /* :155-156, code :755-762 */
```

This is the standard "group overlapping events, greedy column assignment, expand to max width" algorithm — https://stackoverflow.com/questions/11311410/visualization-of-calendar-events-algorithm-to-layout-events-with-maximum-width . Google orders overlaps by start time (later start on top) — https://support.google.com/calendar/thread/203429627/google-calendar-display-of-overlapping-events . A naive port that uses `flex-wrap` or a fixed width loses the lane maths and the per-lane insets.

### 5.3 Time gutter & "now"

| Detail | Prototype | Reference |
|---|---|---|
| Hour labels typography | mono, `11px`, `tabular-nums`, letter-spacing (`:136`, `:142`) | Tabular numerals keep digits aligned; Stripe uses `tnum` for data — https://designmd.cc/benchmarks/stripe |
| "Now" line | `.nowline` 1.5 px bar + 8 px knob (`:147-149`), `now = 15*60 + 42` (`:1482`) | The "now" indicator is a distinct visual layer above events (`z-index: 5`) |
| Block content rules at short heights | `data-compact`: flex-row, `padding 5px 9px`, radius `9px`, title `order:2`, single line, `12.5px` (`:216-219`) | Google shows time only above ~1 h; BusyCal has an explicit "single-line event" toggle; Apple switches on zoom — see competitor research §2.2 |

### 5.4 States, focus, motion

| Detail | Prototype | Reference |
|---|---|---|
| Focus ring | two-colour shadow + `outline-offset: 2px`, `#fe4100` at 5.45:1 (`:50-56`) | Focus visibility must survive any background; this is the detail axe-core does **not** fully cover (repo spec §5) |
| Hover transitions | `140ms ease-out` on background/border (`:83`, `:111`, `:312`) | Linear's standard is 100–200 ms, "nothing bouncy, nothing springy" (secondary aggregator) — https://github.com/soulcore-dev/soul-design-md/blob/main/designs/linear/DESIGN.md |
| Selected/compact shadow | `box-shadow 150ms ease-out, filter 150ms ease-out` (`:204`) | State transitions should be animated, not instant — Linear's "Quality Wednesdays" origin story is literally a hover that darkened instantly instead of fading (~150 ms) — https://github.com/tylergibbs1/linearprincipals/... |
| Reduced motion | `@media (prefers-reduced-motion: reduce)` (`:486`) | Primer: "MUST respect prefers-reduced-motion… provide instant alternatives" — https://github.com/primer/primitives/blob/main/DESIGN_TOKENS_GUIDE.md |

### 5.5 Palette & colour

- Prototype event colours are `oklch(L C H)` with a curated hue per category (`:535-539`) and a measured WCAG contrast. **Carry the `oklch` values, do not convert.** DTCG supports OkLCH; Stripe's write-up explains perceptual uniformity and gamut limits — https://stripe.com/blog/accessible-color-systems
- Focus colour `#fe4100` is annotated `5.45:1 sobre el fondo` (`:50`) — the port must keep the measured pair, not a re-picked accent.
- Colour must not be the only differentiator (WCAG 1.4.1). Amie's own redesign added left-border patterns and category prefixes because event colour alone excluded colour-blind users — https://dribbble.com/shots/27431387-Amie-Calendar-UX-Dashboard-Redesign (agency teardown, secondary).

### 5.6 Competitor craft sources

- **Amie:** 15-scale event colour system as primary navigation; entry animations 0.3 s with 0.05 s staggers, scale 0.75→1.0; 60 px grid row; flat heading scale — https://blakecrosley.com/guides/design/amie (secondary) and https://www.theverge.com/2024/1/24/24048981/amie-calendar-app-ios-mac-web (press).
- **Vimcal:** marketed as "world's fastest calendar"; keyboard-first. Docs cover scheduling, not grid craft (noted as unverifiable) — https://vimcal.com/
- **Fantastical / Notion Calendar / Apple / BusyCal / Google:** exhaustive, sourced teardown already in the repo: `docs/superpowers/research/2026-09-16-calendario-ux-competidores.md`.
- **Mobbin** is the best screenshot reference library for Amie/Notion Calendar states (e.g. https://mobbin.com/explore/screens/05c4146b-77d3-486d-809d-d8173d8aa4d6); it is a paid subscription, so I did not screenshot individual states.

**Recommendation for §5:** turn this list into a **fidelity checklist** in the port spec, one line per item, each with the prototype line number as the expected value. The acceptance test is a side-by-side of prototype vs `/hoy` at the same viewport and the same fixture data.

---

## 6. Recommended path (decision)

1. **Authority:** extract the prototype's tokens into one versioned file; the app consumes it; no value is redefined anywhere else. (§2)
2. **Isolation:** agenda CSS as CSS Modules + `[data-agenda]` root; do not let `styles.css` reach in or the agenda leak out. (§3)
3. **Fonts:** self-hosted variable WOFF2 with `@font-face`, preload, and metric-matched fallback. (§4)
4. **Fidelity gate:** screenshot diff prototype vs `/hoy` in CI (Vitest VRT or Playwright + pixelmatch) before declaring the port done. (§1)
5. **Checklist:** the §5 items become the spec's acceptance criteria, each tied to a prototype line.

**Tradeoff, stated plainly:** this makes the port deliberately slower and less "idiomatic" than a rewrite, and it leaves the app with a second styling idiom until `styles.css` is migrated. The alternative — re-deriving against existing conventions — is the exact process that already lost the design once.

---

## 7. Method and limitations

- **Primary sources:** W3C/DTCG spec and release notes, MDN, web.dev, Chrome for Developers, Tailwind docs, Style Dictionary, Primer/Polaris/Atlassian docs, Stripe engineering, Linear's own blog.
- **Secondary sources** (flagged where used): InfoQ's coverage of Airbnb's React Conf talk, Medium/Smashing opinion pieces, design-token aggregator sites, agency teardowns, the linearprincipals GitHub aggregator.
- **Could not verify / not public:** the exact px/hour and overlap-column cap of Google Calendar, Notion Calendar, and Amie (not published); Vimcal's grid craft (docs don't cover it); Amie's exact grid implementation (only design-commentary sources exist); Linear's redesign post was read via a secondary aggregator, not fetched directly from `linear.app/now`; individual Mobbin screenshots (paid).
- This report intentionally contains **no code**. The next artifact should be the port spec's fidelity checklist derived from §5.
