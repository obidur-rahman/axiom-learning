# DESIGN.md — Axiom Learning

Design system derived from AXL-DESIGN-001. Mode: **Operate** — scanability,
consistency, and calm outrank expression; craft lives in the details.

## Principles
1. One main action per screen; it is always `bg-accent`.
2. Show the reason: every Bridge/Skipped node explains itself (`NEEDED_BY`,
   `EXCLUDED`, `LOW_WEIGHT`) and list the core topics that need it.
3. Calm and clear: few colors, generous space, thin borders, small shadows.
4. Never color alone: node/table states pair color + shape + label.
5. Show sources: citations as small tags; general content marked explicitly.
6. Short text: short sentences, direct address, no unneeded praise.

## Visual language: Axiom Aurora (Catppuccin)

- **Catppuccin palette.** Latte (`#eff1f5` / `#e6e9ef`) for light and Mocha
  (`#1e1e2e` / `#181825`) for dark. Panels, cards, the rail and popovers are
  translucent with a single top highlight and a `backdrop-filter` blur; depth
  comes from one border plus one soft shadow, never a border under a wide glow.
  Three low-opacity blooms tint the ambient canvas.
- **Soft edges.** Default radii are 11px (controls) and 18px (cards), with
  pills for chips, tracks and status tags. The sharp variant is the opt-out
  (`data-corners='sharp'`), not the default.
- **Selectable accent.** Nine pastel presets — blue, mauve, green, teal,
  peach, red, pink, yellow, sapphire — each with its own Latte and Mocha pair
  and a matching contrast foreground. Mauve is the default. `data-accent` on
  `<html>` drives primary actions, selection, focus rings and the active nav
  edge across every surface. Meaning colors stay separate: blue core, amber
  bridge, green known, rose danger.
- **Typography.** Geist with Noto Sans Bengali; body 15.5px / 1.55, slide body
  16.5px / 1.68, headings tight and balanced. Numerals are tabular in stats,
  progress and counts.
- **Micro-motion only.** 150-240ms ease-out on hover, focus, switch, tab, slide
  and progress state; a shimmer skeleton; an indeterminate gradient bar for
  running jobs; slide transitions are a quiet 7px rise. No page-load
  choreography, and every animation collapses under Reduce motion or the OS
  setting.
- **Tokens for the whole choice.** `data-accent`, `data-glass`, `data-corners`,
  `data-density` and `data-reduce-motion` on `<html>` are applied from stored
  preferences before first paint, so the shell, cards, controls and motion
  change together with no flash.
- **Component layer.** shadcn/ui components on Base UI primitives (Switch,
  Select, Progress, Tabs, Tooltip, Slider) styled by the Catppuccin tokens; no
  second visual vocabulary.
- **Browser surfaces.** Themed selection, caret, scrollbars and an accent
  focus ring.
- Headings carry themselves: no kicker/eyebrow above a page heading.
- Node status still pairs color with label (principle 4 unchanged).

## Tokens (CSS custom props in apps/desktop/src/app/globals.css)
- Theme: resolved `data-theme` is `light` (Latte) or `dark` (Mocha); the
  stored preference is `light`, `dark` or `system`. A pre-paint script applies
  it, so there is no flash of the wrong theme.
- Appearance switches: `data-accent` (nine presets), `data-glass` (on/off,
  backdrop blur), `data-corners` (sharp/round), `data-density`
  (comfortable/compact), `data-reduce-motion`.
- Surfaces: `panel`/`card` (rgba + top highlight + blur), `panel-raised`
  (inputs, popovers), `surface` (nested rows, chips), `panel-solid` and
  `rail-solid` for the glass-off fallback.
- Surfaces: `bg` (page) / `surface` (cards) / `border` (hairlines, 1px).
- Text: `text` (primary) / `text-muted` (secondary). Body 15.5px, lh 1.55.
- Type: Geist + Noto Sans Bengali (Bangla), `font-sans` stacks both.
- Meaning colors: core=blue, bridge=amber, known=green, skipped=muted gray,
  warning=amber, danger=red. Motion: 150–240ms transitions only, all killed
  under prefers-reduced-motion.

## App shell and navigation
- Sidebar (258px, full height, flush with the window edge, translucent Latte
  or Mocha rail): brand, a "Workspace" group (Dashboard, Courses, Settings),
  live job activity (indeterminate bar while a build runs), provider status
  (ready/missing/desktop-only), then the profile chip and theme switch pinned
  to the bottom. Active item uses `aria-current="page"`, an accent-tinted
  surface and a 3px accent edge; nav items and the theme switch carry shadcn
  tooltips. Labels are always visible.
- Below `md` the sidebar becomes a sticky top bar with horizontal nav, so the
  desktop window can still be resized small.
- Content column is capped at 6xl and uses cards on the canvas; the course
  workspace keeps its tab strip inside the shell.

## Settings
Anchored cards with a sticky section nav. Every control is functional:
- **Appearance:** Light/Dark/System previews, nine accent swatches, translucent
  surfaces, sharp corners, compact density, reduce motion.
- **Behaviour:** default course tab, show percentages, exam countdown,
  citation pages, skipped topics in the plan, confirm-delete, build toasts.
- **Profile:** display name, language, initials avatar.
- **Study:** lesson depth (shadcn Select), bridge depth (shadcn Slider), tutor
  starts in Guide me, auto-mark strong practice results.
- **Materials:** rebuild roadmap after upload, store embeddings, flag
  low-confidence pages.
- **AI provider:** local/hosted, base URL, chat/embed models, key (OS store),
  probe, auto-detect fills the server's advertised chat/embed IDs, capability
  summary. Desktop requests use Tauri's HTTP client, so LM Studio, Ollama and
  vLLM work without enabling browser CORS.
- **Data:** storage facts, full JSON export.
- **Account:** local-first explanation, cloud marked unavailable.
- **About:** build facts.

## Components inventory
- **Node badge**: dot + label; core solid fill, bridge light fill + dashed edge,
  skipped no fill + dotted, known light fill + check glyph.
- **Weight bar / progress bar**: 6px track, accent fill proportional, labelled
  with `role="progressbar"`.
- **Lesson slide deck**: one teaching section per slide, numbered slide strip,
  previous/next controls, arrow-key navigation, progress bar, and a Read all
  fallback. Markdown/KaTeX render inside slides, tutor bubbles and practice.
- **Citation tag**: `file.png · p.3` chip; tap opens source text popover.
- **Status pill**: queued/reading/ready/failed — dot + label always.
- **Stat card**: 26px value, 12px label, muted hint.
- **Theme option**: preview swatch + label, selected via `aria-pressed`.
- **Switch**: 42x24 pill, accent when on, label always beside it.
- **Buttons**: primary accent; secondary hairline on surface; destructive text-danger.

## States (each main screen ships all six)
Loading · empty (with the action to fix it) · error · limit reached · offline ·
success. Empty states name the substance, never just "no data".

## Accessibility floor
WCAG 2.2 AA contrast; 44px min tap targets; full keyboard path (arrow keys move
between roadmap nodes, Enter opens, Delete asks with the dependents named);
icons get labels; text size respects user settings; reduced motion honored.

## Refinements
Better than standard when cheap: skeleton loads; live status without reload
(job polling); instant local edits (<1s for 200 nodes); quiet confidence in
hover/focus transitions, nothing bouncing.
