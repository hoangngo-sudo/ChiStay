# Typography

One family: **DM Sans**, imported from `@fontsource/dm-sans` at weights 400, 500
and 600 in `src/style.css`. Weight 700 is imported but nothing uses it: do not
start using it, and do not add another family.

## The scale

These eight sizes are the whole scale. There is no 15px and no 17px: next to 14
and 16 they read as a mistake.

| Size | Role | Used today in |
| --- | --- | --- |
| 30px | rent, the one display number | `.rent` |
| 24px | rent below 560px | `.rent` in the `max-width: 560px` block |
| 20px | page title, brand, dialog title | `.page-heading h1`, `.brand`, `.dialog-header h2` |
| 18px | heading inside a panel or detail view | `.empty-overview h2`, `.detail-heading h2` |
| 16px | anything typed or picked, card title, panel sub-heading | `input`, `select`, `.card-top h2`, `.form-panel h2`, `.date-field`, `.segments button`, `.records-empty h2` |
| 14px | control text, field labels, secondary body | `.button`, `label` / `.field-label` / `.filter-group legend`, `.nav-item`, `.heading-subtitle`, `.housing-type`, `.record-copy strong`, `.date-day`, `.dialog-context` |
| 13px | dense rows and secondary detail | `.record-copy`, `.match-option`, `.text-button`, `.field-message`, `.toast`, `.source-link`, `.record-detail dl` |
| 12px | captions, metadata, map sublines | `.sort-label`, `.records-header p`, `.record-row time`, `.data-notice`, `.decision`, `.detail-heading p`, `.map-*` sublines |

12px is the floor. Nothing in the app is smaller.

## Weights

| Weight | Use |
| --- | --- |
| 400 | body text, secondary lines, `.muted`, `.segments button`, map sublines |
| 500 | field labels, `.nav-item`, page titles, `.rent`, `.decision`, date panel selects |
| 600 | `.button`, `.brand`, `.text-button`, `<strong>` inside a record or map label |

Hierarchy comes from weight and colour, then size. Do not push a label to 700 to
make it stand out; three weights are the system.

## Rules

1. **Inputs and selects are 16px at every breakpoint.** `@media (any-pointer:
   coarse)` re-forces it because a smaller computed size makes iOS Safari zoom the
   page on focus and lose the user's place in the form.
2. **Numbers that stack or change in place get `font-variant-numeric:
   tabular-nums`.** Applied today on `.rent`, `#date-summary` and `.date-day`.
   A column of rents, or a value that updates while the user watches, wobbles
   with proportional figures. A single typed number does not need it.
3. **Line-height follows the role, not the taste.** `1` for the rent, `1.35–1.4`
   for chips, map labels and dense rows, `1.5–1.6` for paragraphs, and a fixed
   `24px` on `.page-heading h1` and `.form-panel h2` so a one-line and a two-line
   heading occupy the same block.
4. **Measure is capped.** `.empty-overview p` is 42ch, `.data-notice p` is 100ch.
   A paragraph running the full width of `.main` is unreadable at 1440px; if you
   add prose, give it a `max-width` in `ch`.
5. **Sentence case everywhere.** There is no `text-transform` in the file. No
   uppercase labels, no title-case buttons.
6. **No letter-spacing.** DM Sans at these sizes does not need it; adding it to a
   12px caption is the fastest way to make the UI look like a different product.
7. **Icons are inline SVG** rendered through `icon(name, size)` in `src/main.js`,
   which sets the box size in px and inherits `currentColor`. Sizes in use are 16,
   18, 20 and 24. Text uses the scale; icons use those four sizes.

## The icon set

Only these names exist in `icons` in `src/assets.js`. A name that is not on this
list throws `Icon not found`, so check here before typing `data-icon="…"`.

`add-apartment` · `alert` · `bookmark` · `calendar` · `check-circle` ·
`chevron-right` · `trash-2` · `reset` · `saved` · `worth-a-visit` · `x`

In markup the slot is `<span class="local-icon" data-icon="name" data-size="18"
aria-hidden="true"></span>`; `fillIconSlots()` fills every slot on load. In JS
use `icon("name", 18)`. Icons are always `aria-hidden`: the label text carries
the meaning. Crime-category glyphs are separate image files in `incidentIcons`,
not part of this set.
