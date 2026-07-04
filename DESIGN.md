---
name: SeniorDev
description: Dark, legible desktop workbench for driving CLI coding agents from Jira tickets — a control room for supervised machine work.
colors:
  bg: "oklch(0.21 0.012 165)"
  surface: "oklch(0.255 0.014 165)"
  surface-2: "oklch(0.305 0.016 165)"
  hairline: "oklch(1 0 0 / 0.08)"
  hairline-strong: "oklch(1 0 0 / 0.14)"
  ink: "oklch(0.95 0.008 95)"
  ink-soft: "oklch(0.82 0.012 120)"
  ink-muted: "oklch(0.70 0.014 140)"
  teal: "oklch(0.78 0.085 168)"
  green: "oklch(0.79 0.11 155)"
  amber: "oklch(0.80 0.115 68)"
  tan: "oklch(0.77 0.045 78)"
  rust: "oklch(0.68 0.15 38)"
typography:
  title:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  mono:
    fontFamily: "Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  sm: "8px"
  md: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
components:
  button-primary:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.bg}"
    rounded: "{rounded.sm}"
    padding: "6px 14px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.sm}"
    padding: "6px 14px"
  button-secondary-hover:
    textColor: "{colors.ink}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
  tab:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.sm}"
    padding: "5px 10px"
  tab-active:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
  modal:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "14px 16px"
  success-card:
    backgroundColor: "oklch(0.33 0.027 157)"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
---

# Design System: SeniorDev

## 1. Overview

**Creative North Star: "The Control Room"**

SeniorDev is a dark, legible operations surface where a developer supervises
machine work. Two tabbed panels — a Jira ticket reader and a live CLI-agent
terminal multiplexer — sit side by side across a full-height split, and every
autonomous run is watchable and traceable: a scrolling log, tool one-liners, PR
cards, a structured recap. The room is dim so the work is bright. Surfaces are a
warm near-neutral charcoal (a faint teal-green cast at chroma ~0.012), text is a
warm off-white, and a single restrained accent — a muted teal — marks the one
action that matters on any given surface. Color is a signal here, never
decoration.

The system reads as **capable, quietly confident, and transparent** — a senior
teammate, not a control panel. It rejects the enterprise dashboard (no card
grids, hero-metric tiles, or gradient accents), the toy (the raccoon "raccourier"
mascot is warmth reserved for moments — splash, empty states, About — never a
theme smeared across the working surface), the maximal IDE (no cluttered
toolbars or config-overload), and the flashy (no choreographed page loads,
glassmorphism, or motion that doesn't convey state). Components carry a
**tactile, confident** weight — firm hovers, hairline definition, a bold accent
where it counts — without ever raising their voice.

Depth is built from **tone before shadow**: three flat charcoal planes
(`bg` → `surface` → `surface-2`) stack by lightness, with hairline borders
drawing the seams and a soft ambient shadow lifting genuinely-raised elements.

**Key Characteristics:**
- Dark warm-charcoal canvas, warm off-white ink, one rare teal accent.
- OKLCH throughout — the palette is authored and reasoned in OKLCH, not hex.
- Flat tonal layering (`bg`/`surface`/`surface-2`) plus hairlines; shadow used sparingly for lift.
- Semantic color vocabulary: teal (primary/active), green (success), amber (attention), rust (error).
- Consumer sans for UI (Segoe UI Variable), Consolas mono for all terminal/log surfaces.
- Density where the task earns it; calm everywhere else.

## 2. Colors

A dark warm-charcoal foundation carrying a single teal accent and a compact
semantic set (green/amber/rust) for state. The palette was derived from a
"raccourier" source scheme — teal `#6cb49c`, amber `#e49c54`, tan `#b49c84`,
charcoal `#545454`, cream `#fcfcfc` — then authored canonically in OKLCH.

### Primary
- **Courier Teal** (`oklch(0.78 0.085 168)`): The one accent. Primary buttons
  (`Open`, `Resume`, PR `Open`), the active resize seam, and focus outlines.
  Muted and desaturated so it signals without shouting — its rarity is the point.

### Secondary
- **Signal Green** (`oklch(0.79 0.11 155)`): Success only — a finished run's status
  line, the "PR ready" card tint and border. Never decorative.
- **Attention Amber** (`oklch(0.80 0.115 68)`): Warning / in-progress attention.
  Reserved; not yet load-bearing across the surface.

### Tertiary
- **Worn Tan** (`oklch(0.77 0.045 78)`): A low-chroma warm neutral for secondary
  emphasis and mascot-adjacent warmth. Quiet by design.
- **Alarm Rust** (`oklch(0.68 0.15 38)`): Errors — the opener's error line, failure
  states. The only high-chroma color in the set; it earns that from scarcity.

### Neutral
- **Room Charcoal — bg** (`oklch(0.21 0.012 165)`): The deepest plane. App
  background, the left content panel, terminal shells.
- **Panel Charcoal — surface** (`oklch(0.255 0.014 165)`): The right panel and
  input fields; one tonal step up from `bg`.
- **Raised Charcoal — surface-2** (`oklch(0.305 0.016 165)`): Active tabs, modals,
  the highest resting plane.
- **Bright Ink** (`oklch(0.95 0.008 95)`): Primary text; warm off-white.
- **Soft Ink** (`oklch(0.82 0.012 120)`): Secondary text, inactive tab labels.
- **Muted Ink** (`oklch(0.70 0.014 140)`): Placeholders, close glyphs, captions.
  Verify it clears 4.5:1 on the plane it sits over before using it for body text.
- **Hairline** (`oklch(1 0 0 / 0.08)`) / **Hairline Strong** (`oklch(1 0 0 / 0.14)`):
  White-alpha borders and seams that read consistently across all three planes.

### Named Rules
**The One Signal Rule.** Teal marks exactly one primary action per surface. If two
teal buttons compete on a screen, one is wrong — demote it to the secondary
(ghost) treatment.

**The Color-Is-State Rule.** Green, amber, and rust may only appear as state
(success / attention / error), never as decoration or brand flavor. State is
never conveyed by color alone — always pair it with text, icon, or shape.

## 3. Typography

**Body Font:** Segoe UI Variable Text (with Segoe UI, system-ui, sans-serif)
**Label/Mono Font:** Consolas (monospace)

**Character:** One consumer sans carries the entire UI — headings, labels, body,
data. No display face; product UI doesn't need the contrast, and a fluid heading
would only look worse in a sidebar. Every terminal and log surface switches to
Consolas mono, kept in a single source of truth (`term-style.ts`) so xterm and the
YOLO log never drift apart.

### Hierarchy
- **Title** (600, 15px, 1.3): Modal and section headers. The ceiling — headings
  stay small and dense; this is a workbench, not a landing page.
- **Body** (400, 14px, 1.55): Default UI text, ticket prose. Cap rendered prose at
  65–75ch; data and compact UI may run denser.
- **Label** (600, 13px, 1.4): Buttons, tab labels, status lines, card labels.
- **Mono** (400, 13px, Consolas): Terminals, the YOLO live log, tool one-liners
  (`▸ Edit src/foo.ts`). The voice of machine output.

### Named Rules
**The Fixed-Scale Rule.** Type sizes are fixed px/rem, never `clamp()`. Users view
at consistent DPI; a fluid heading that shrinks in a panel is a regression, not a
feature.

**The One-Family Rule.** Segoe UI Variable for everything the human reads; Consolas
for everything the machine emits. No third face, no display font in UI chrome.

## 4. Elevation

Depth is built from **tone first, shadow second**. Three flat charcoal planes stack
by lightness — `bg` (0.21) → `surface` (0.255) → `surface-2` (0.305) — and hairline
white-alpha borders draw the seams between them. This tonal layering does most of
the depth work; the interface is flat and calm at rest. A soft ambient shadow is
then reserved to *lift* genuinely-raised elements (active tabs, cards) a notch off
their plane, and a deep structural shadow sets true overlays (modals) apart from
the room behind them.

### Shadow Vocabulary
- **Ambient Lift** (`box-shadow: 0 1px 3px oklch(0 0 0 / 0.3)`): Subtle
  dimensionality on raised-but-inline elements — active tabs, PR/success cards.
  Just enough to read as "above the plane."
- **Overlay** (`box-shadow: 0 20px 60px oklch(0 0 0 / 0.45)`): Modals only. A large,
  soft, deep shadow that unmistakably floats the dialog over a dimmed room
  (`oklch(0 0 0 / 0.5)` scrim).

### Named Rules
**The Tone-First Rule.** Reach for a lighter plane before a shadow. Shadow is for
lift and overlay, not for separating adjacent panels — that's the hairline's job.

## 5. Components

Components feel **tactile and confident**: hairline-defined, firm on hover, with
the teal accent placed deliberately and rarely. `--radius-sm` (8px) is the default
corner; `--radius` (12px) is the larger step for panel-scale surfaces. Transitions
run on `--ease-out` (`cubic-bezier(0.16, 1, 0.3, 1)`), 120ms for state feedback.

### Buttons
- **Shape:** Softly rounded (8px, `--radius-sm`).
- **Primary:** Teal fill, `bg`-color text (dark ink on teal for contrast), no
  border, 600 weight, `6px 14px` padding. Used for the single key action per
  surface (`Open`, `Resume`).
- **Secondary / Ghost:** Transparent fill, `1px solid hairline-strong` border,
  `ink-soft` text; hover lifts text to `ink`. For destructive-adjacent or
  lower-priority actions (`Stop`).
- **Focus:** `outline: 2px solid` (teal or ink), `outline-offset: 2px`. Always
  visible — this is a keyboard-first tool.

### Inputs / Fields
- **Style:** `surface` background, `1px solid hairline-strong` border, 8px radius,
  `6px 10px` padding, `ink` text. Placeholders in `ink-muted`.
- **Focus:** `outline: 2px solid teal`, `outline-offset: 1px`, border fades to
  transparent so the teal ring reads cleanly.

### Tabs
- **Style:** Top-rounded (`8px 8px 0 0`), `surface` background, `ink-soft` label,
  hairline border with no bottom edge, `5px 10px` padding — tabs sit into the
  panel below them.
- **Active:** Lifts to `surface-2` with `ink` text (and Ambient Lift shadow).
- **Close affordance:** `×` in `ink-muted`, brightening on hover.

### Cards / Containers
- **Success (PR) Card:** A green-tinted surface —
  `color-mix(in oklch, var(--green) 14%, var(--surface))` — with a
  green-mixed border and 8px radius; label in `ink` 600 plus a `✅` glyph and a
  teal `Open` button. The one place green tints a surface, and only on success.
- **Cards are earned, never a default grid.** No repeating icon+heading+text tiles.

### Modals
- **Style:** `surface-2` background, `1px solid hairline-strong`, 8px radius,
  `min-width: 420px`, `max-width: min(860px, 92vw)`, `max-height: 88vh`.
- **Structure:** Header (title + `×`) / scrollable body / optional right-aligned
  footer, separated by hairlines. Overlay scrim `oklch(0 0 0 / 0.5)`; Overlay
  shadow (see Elevation). Escape closes only the topmost modal (a stacked confirm
  dialog never drags its parent down).
- **Modal is the last resort.** Exhaust inline / progressive alternatives first;
  reserve modals for config editors, About, and confirm gates.

### Signature: The Resize Seam
The 6px divider between panels is a pointer hit-area only; a centered 1px hairline
carries the seam and lifts to teal (thickening to 2px) on hover / focus / drag.
A `separator` role with live `aria-valuenow` makes it keyboard-operable. This is
the model for motion across the app: a 120ms `--ease-out` state change that
conveys interactivity and nothing more.

### Empty States
Centered mascot art (capped at `min(220px, 55%, 35vh)`) over a muted caption, with
a gentle 0.45s fade-up on entry. Empty states teach the interface and carry the
brand's warmth — they are one of the sanctioned mascot moments.

## 6. Do's and Don'ts

### Do:
- **Do** author every color in OKLCH; the frontmatter values are the source of truth.
- **Do** keep teal to one primary action per surface (The One Signal Rule).
- **Do** convey depth with the tonal planes (`bg`/`surface`/`surface-2`) and
  hairlines first; reach for Ambient Lift only to raise a card or active tab.
- **Do** give every interactive element a visible `outline` focus state — the tool
  is keyboard-first.
- **Do** honor `prefers-reduced-motion` on every animation (the seam and empty
  states already do) with a crossfade or instant fallback.
- **Do** pair state color with text/icon/shape; never rely on color alone.
- **Do** keep type at fixed px sizes and a single sans; Consolas for machine output.
- **Do** verify `ink-muted` body/placeholder text clears 4.5:1 on its plane.

### Don't:
- **Don't** build a generic SaaS dashboard: no card grids, hero-metric tiles, or
  gradient accents.
- **Don't** make it consumer-cute or toy-like — the raccoon is a moment, not a theme.
- **Don't** pile on heavy IDE chrome: no cluttered toolbars, deeply nested panels,
  or config-overload.
- **Don't** add flashy or over-animated flourishes: no choreographed page loads,
  decorative motion, or glassmorphism. Motion conveys state or it doesn't ship.
- **Don't** use `background-clip: text` gradient text, or a colored `border-left`/
  `border-right` > 1px as a stripe accent (shared absolute bans).
- **Don't** use green/amber/rust as decoration — they are state only.
- **Don't** use `clamp()` / fluid type or a display font anywhere in UI chrome.
- **Don't** reach for a modal first; exhaust inline and progressive alternatives.
