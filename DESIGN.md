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

## Visual language (restyled after the 2025 floating-panel reference)

- Light theme is the face of the app: soft gray canvas, a floating rounded
  panel for content, and a dark graphite icon rail on the left with a rotated
  vertical label (`Axiom 2025 Nav`). Dark theme stays under `data-theme=dark`.
- Surfaces: `bg` canvas < `panel` (main card, 20px radius, soft shadow) <
  `panel-raised` (inputs, grouped list cards) < `surface` (nested chips).
- Accent is graphite (`#2e2d2b`) for primary buttons and active states;
  green (`known`) is reserved for success/count chips. Inside panels the old
  vars (`bg-surface`, `border`, `text`, …) keep their names, so nested
  components inherit the new look without changes.
- Chips (`.chip` class) carry counts and metadata: 999px radius, raised
  background, inner highlight.
- Headings: 32px semibold, tight tracking; section labels are small
  uppercase, tracking-wide, muted.
- Tabs: underline style under a hairline (active gets a dark bar), not pills.
- Node status still pairs color with label (principle 4 unchanged).

## Tokens (CSS custom props in apps/desktop/src/app/globals.css)
- Theme: dark first (`data-theme="dark"` default, FR-004), light override only.
- Surfaces: `bg` (page) / `surface` (cards) / `border` (hairlines, 1px).
- Text: `text` (primary) / `text-muted` (secondary). Body ≥ 16px, lh 1.5–1.6.
- Type: Inter + Noto Sans Bengali (Bangla), `font-sans` stacks both.
- Meaning colors: core=accent blue, bridge=amber, known=green, skipped=muted
  gray, warning=amber, danger=red. Radius: 10px cards/buttons. Motion: 150–250ms
  transitions only, all killed under prefers-reduced-motion.

## Components inventory
- **Node badge**: dot + label; core solid fill, bridge light fill + dashed edge,
  skipped no fill + dotted, known light fill + check glyph.
- **Weight bar**: 4px track, accent fill proportional.
- **Citation tag**: `file.png · p.3` chip; tap opens source text popover.
- **Status pill**: queued/reading/ready/failed — label + icon always.
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
