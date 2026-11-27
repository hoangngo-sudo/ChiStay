# Screens, control choice and copy

## Screen wrapper

Every screen is a `<section id="screen-…">` inside `<main class="main">`, toggled
with the `hidden` attribute by `showScreen()`, then a `.page-heading` with one
`<h1>`, then the content.

```html
<section id="screen-overview" hidden>
  <div class="page-heading">
    <h1>Your Chicago Places</h1>
  </div>
  …
</section>
```

- Exactly one `<h1>` per screen. `showScreen()` sets `document.title` from it and
  focuses it, so a screen without an `h1` breaks the title and the focus move.
- Name the screen after what the user does, not the data (`Your Chicago
  Places`, not `Apartments`).
- A panel holding two or more sections needs a `.form-panel h2` per section. A
  panel with one section may omit the `h2`; do not restate the `h1` under it.
- A screen with one panel uses `.form-panel`. A screen with a list of cards uses
  `.cards`. The compare screen is the one exception: its `.compare-panel` and
  `.compare-band` exist because it is a comparison table, not a card list. Do
  not reuse them for another screen.
- Persistent screen furniture (topbar, sidebar) lives outside `#screen-*`.

## Which control

```
How many options, and how often does the user change this?
 ├── 2–4 short options, change is the point → Segments (one click, all visible)
 ├── 5+ options, or options are content → <select>
 ├── A number the user knows → text field, type="number", inputmode="numeric"
 ├── Yes / no → the field exists or it does not; do not add a checkbox for one flag
 └── Anything typed → text field with a <label>
```

A bounded number is still a text field. Segments of 15/30/45/60 would pretend the
user's answer is one of four values; a number field takes 37.

## Vertical rhythm inside a form

Three numbers, three jobs. Do not average them.

| Gap | Where |
| --- | --- |
| 16px | one field group to the next (`.two-fields` margin-top, stacked fields) |
| 18px | last field to the action row (`.form-actions` margin-top) |
| 24px | a panel section to an unrelated block (`.match-section`, `.page-heading`) |

## Width

- A single-column form runs the width of its `.form-panel`; do not cap the field
  with a new `max-width`.
- Pair fields with `.two-fields` when they are a pair (two numbers of the same
  kind, a value and its unit). Unrelated settings stack: a three-option row next
  to an unrelated number reads as one control group.
- A panel that is the only thing on the screen and would exceed roughly 720px of
  content gets two columns from `.two-fields` or a two-column grid, never
  full-width 40-character inputs.
- Panels themselves are capped by the layout, not by the panel: `.empty-overview`
  is 630px, the verify form column is 456fr in a 456/708 grid.
- Prose gets a `ch` cap (42ch or 100ch); form fields never do.

## Errors and the action button

- The five-part invalid state (ring, halo, icon inside the field, message, shake)
  applies to every field that can fail validation, not only the address. Each
  field gets its own message slot, `role="alert"`, wired with `aria-describedby`.
- Validate on submit, then clear the error on the first keystroke. Validating on
  every keystroke tells a user their half-typed address is wrong.
- **Do not disable the primary action to express invalidity.** Submit, then show
  the field error. Disable only while a save is in flight, and re-enable it after.
- One error at a time per field, one sentence, in the field's own slot.

## Copy

- Sentence case, no uppercase, no exclamation marks, no "Oops".
- Name the state and the next action: `No Chicago Place to be saved yet` +
  `Add Chicago Place`, not `No results`.
- Errors say what to do (`Check the street address and try again`), not what
  failed internally (`Invalid input`, `Error 422`).
- Units sit in the label as a muted parenthetical: `Maximum commute time
  (minutes)`. Write the unit out; `min` and `min.` are not used anywhere.
- Optional fields take `<span class="muted">(optional)</span>`; required fields
  take `<span class="required">*</span>`. Never both in one form.
- When every field on a form is required, mark none of them: a page of asterisks
  says nothing. Mark the exceptions instead.
- A toast announces a completed save in the past tense (`Chicago Place
  saved`). The sentence is passed to `showToast()`, so a new save gets its own
  sentence naming what was saved. It never asks a question, because it expires
  in 5s.
- While a save is in flight the primary button is disabled and keeps its label.
  There is no spinner and no "Saving…" state in this app.

## Compare screen

The compare screen puts every saved Chicago Place in one panel, one band after
another. Each band shares the same three columns: place details and totals, ten
daily bars on one scale, and the three newest incidents. The 10-day window,
radius and categories are fixed for every place, so the bands are directly
comparable.

- Use `.compare-panel` for the outer region and `.compare-band` for each place.
- Use `.compare-band-head` for the sticky column labels. It is visual only and
  is hidden on phones.
- Bands follow the shortlist order. This screen does not repeat the order
  caption; the overview's sections keep the same order inside each group.
- The daily chart is a `role="img"` with the ten daily counts in its
  accessible label. Print the first and last day under the bars. The header's
  hover titles are not the only route to the values.
- The page subtitle is a live `role="status"` region for loading, locating older
  saved places, error and ready states. With no saved places it is hidden; the
  empty state carries the message.
- Keep the `.compare-record` rows non-interactive. The band's `View all
  incidents` action opens the place's own incident screen for the full list.
- Do not add filters to this screen. A different window or radius per place
  would break the comparison.
- The decided shape and rejected alternatives live in
  [compare-view.md](compare-view.md).

## What these docs do not cover

Storage, persistence keys, routing, Mapbox setup and the CSV snapshot are
engineering, not interface. If a task needs one of those, read `README.md` and
`src/main.js`; do not invent a convention from this folder.

## Adding a screen

1. Read `docs/surfaces.md` and pick an existing region type.
2. Reuse `.page-heading`, `.form-panel` or `.cards` before adding a class.
3. Add a new commented section in `src/style.css` after the last screen section,
   and say which screen it is; do not append rules to another screen's block.
4. Add the `hidden` section to `index.html`, then one branch in `showScreen()`.
5. Register the screen in the `screens` lookup at the top of `src/main.js`,
   otherwise `showScreen()` cannot toggle it.
