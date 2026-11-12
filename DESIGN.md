# ChiStay design system

Rules for anyone writing markup or CSS in this repo. Every value here traces to
`src/style.css`. If the value you want is not in this file, it does not exist yet:
ask before inventing one.

## Character

Near-monochrome, dense, quiet. White surfaces on a warm off-white ground, one ink
colour for text and primary actions, and colour only where it carries meaning:
incident categories (amber), errors (red), the worth-a-visit chip (blue). No
gradients, no drop-shadowed cards, no accent colour on a neutral control.

## Read these when

| File | Open it for |
| --- | --- |
| [docs/screens.md](docs/screens.md) | adding a screen, choosing a control, copy |
| [docs/colors.md](docs/colors.md) | any colour, token, or new state |
| [docs/typography.md](docs/typography.md) | any size, weight, or number |
| [docs/buttons.md](docs/buttons.md) | anything the user presses |
| [docs/forms.md](docs/forms.md) | anything typed into, picked, or filtered |
| [docs/surfaces.md](docs/surfaces.md) | cards, panels, dialogs, toasts, map labels |

## Hard rules

1. **Semantic tokens only.** `var(--surface)`, `var(--danger)`. Never a raw hex,
   never a new `oklch()` inside a component rule. Why: one edit has to fix every
   surface, and a literal is how a palette drifts into six near-whites.
   The only allowed literals are alpha layers in shadows (`rgb(0 0 0 / 0.08)`),
   colours painted over map tiles (`.map-*`, `.stack-popup-*`), and the chevron
   SVG data URL inside `select`.
2. **Two radii, plus four named shapes.** `--radius` (6px) for controls and
   panels, `--radius-sm` (5px) for chips and rows nested inside a panel; the
   nested radius is always the smaller one. The named exceptions are the button
   pill (`9999px`, see `docs/buttons.md`), `50%` circles for day cells and the
   crime disc, the date panel's `10px`, and the range ends' `20px`. Do not add a
   fifth.
3. **Two elevations.** Controls are raised: `--ring-raised` at rest,
   `--ring-raised-hover` on hover and while open. Panels, cards and empty states
   are flat: `inset 0 0 0 1px var(--border)`, no shadow. Never give a panel a
   drop shadow; it reads as a floating control.
4. **There is no focus outline.** `:focus-visible { outline: none }` is
   deliberate and global. State comes from the ring, the red error halo and the
   shake. Do not add an outline back, and do not add a blue focus colour.
5. **Floors:** 12px for text, 44px for anything tappable, 16px for the computed
   font-size of an input or select on touch, 3:1 contrast for any non-text cue.
6. **Motion is state or one-shot, never decorative.** 150ms colour and shadow,
   220ms to appear, 160ms to leave, 260ms error shake. All of it lives inside
   `@media (prefers-reduced-motion: no-preference)`; a motion without a
   reduced-motion path is a bug.
7. **One filled pill per view.** Two `primary` buttons on one screen means the
   screen has no next step.

## Spacing

There is no spacing scale token. Use the steps the file already uses:

`2 · 4 · 6 · 8 · 10 · 12 · 16 · 20 · 24 · 30 · 32 · 44`

Odd values exist where a component needed optical correction (`5` in `.decision`,
`7` in `.text-button`, `9` in `.match-option`, `11` in `.date-field` padding,
`14` in `.toast`). Reuse the existing one; do not invent a new odd number.

- Space siblings with `gap` on the parent, never `margin-bottom` on each child:
  margin leaves a trailing gap after the last item.
- Panel padding is 20–24px; card padding is 22px; page padding is 24px top and
  36px inline on desktop.

## Structure

`src/style.css` is one file, ordered: tokens, resets, shell (topbar, sidebar,
main), shared controls (button, icon button, text button), screen 1 (cards),
screen 2 (form, inputs, matches), screen 3 (filters, records, map), overlays
(toast, dialogs), then `@media` blocks. Add a rule in the section it belongs to.

## Out of scope

Storage, persistence keys, routing, Mapbox setup and the CSV snapshot are
engineering. These docs rule the interface only; read `README.md` and
`src/main.js` for the rest instead of inventing a convention from this folder.
