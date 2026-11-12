# Forms and inputs

Every field is 49px tall, `--radius`, `--surface`, `--ring-raised`, 16px text,
`transition: box-shadow 150ms ease`. That is the standard, and the filter row was
raised to it on purpose. Anything shorter (44px, 40px) reads as another product.

## Text field and select

Use for any value the user types or picks. Use `Segments` when there are two to
four short choices and the choice is the point (radius). Use `<select>` when the
list is longer or the options are content (housing type, category).

The housing type select uses a styled picker and option hover states in browsers
that support customizable selects. Other browsers retain the native picker;
the select continues to provide its native form and keyboard behavior.

```html
<!-- Correct: label, then field, then the error slot -->
<label for="rent">Monthly rent <span class="muted">(optional)</span></label>
<div class="input-prefix">
  <span>$</span>
  <input id="rent" name="rent" type="number" min="0" step="1" inputmode="numeric" />
</div>

<!-- Incorrect: placeholder as label (vanishes on typing)
     and a raw error colour outside the system -->
<input placeholder="Monthly rent" style="border: 1px solid #d00" />
```

- Every input has a `<label for>`. Clicking the label focuses the field; that is
  free and it doubles the hit area.
- Placeholders show an example (`e.g. 1234 W Taylor St, Chicago`), never the
  label. `inputmode` and `type` pick the right mobile keyboard.
- `autocomplete` is on for addresses, names and payments, `off` for search-like
  fields.
- Optional fields say `(optional)` in `.muted` inside the label; required fields
  get `<span class="required">*</span>`.
- `.two-fields` puts two fields side by side with `repeat(auto-fit, minmax(172px,
  1fr))` so a narrow panel drops to one column instead of wrapping a label.
### Units and affixes

- A prefix the user does not type goes in `.input-prefix` (`$` before the rent):
  absolutely positioned, so it never eats a click.
- A unit that is read, not typed, goes in the label as a muted parenthetical:
  `Maximum commute time <span class="muted">(minutes)</span>`. Write the unit
  out; there is no `min` or `min.` in the app.
- There is no right-side suffix slot. If a unit must trail the value, it still
  goes in the label; do not add a new absolute-positioned span.
- A muted `(minutes)` and a muted `(optional)` look identical, so never use both:
  write `Maximum commute time (optional, minutes)` in plain text.

## Invalid state

The error is a ring, a halo, an icon inside the field, a message under it, and one
short shake. All five fire together; none is optional.

```html
<label for="address">Street address <span class="required">*</span></label>
<div class="input-with-icon">
  <input id="address" aria-describedby="address-error" aria-invalid="true" required />
  <span class="input-icon" data-icon="alert" data-size="16" aria-hidden="true"></span>
</div>
<p id="address-error" class="field-message" role="alert">
  No Chicago address found. Check the street address and try again.
</p>
```

| Piece | Where it comes from |
| --- | --- |
| ring + halo | `.form-panel input[aria-invalid="true"]` → `0 0 0 1px var(--danger), 0 0 0 3px var(--danger-wash)` |
| icon inside the field | `.input-icon`, shown by `.input-with-icon:has(input[aria-invalid="true"])` |
| message | `.field-message`, `role="alert"`, 13px `--danger` |
| shake | `shakeField()` adds `.is-shaking`; `field-shake` runs 260ms, transform only |
| screen readers | `aria-invalid="true"` plus `aria-describedby` to the message |

- Set `aria-invalid` and the message in one place. `setAddressError()` in
  `src/main.js` is the only writer of `#address-error`; a new field gets its own
  equivalent function, not a second branch inside that one.
- The invalid state is required for every field that can fail validation, not
  only the address: same ring, halo, icon, message slot and shake.
- Clear `aria-invalid` on the first keystroke: a message that survives editing
  tells the user their fix did nothing.
- The message says what to do (`Check the street address and try again`), not
  what failed (`Invalid address`), and it is never the only signal: red plus icon
  plus sentence.
- `padding-right: 40px` is reserved on `.input-with-icon input` at all times, so
  the mark appearing never shifts the text. In a column narrower than about
  220px that reservation is a fifth of the field; drop `.input-with-icon` there
  and let the message carry the mark.
- `required` and this custom state do not combine. Native validation runs before
  `submit`, so an empty required field gets the browser bubble and none of the
  ring, halo or shake. If the custom message must be the one the user sees, drop
  `required` and validate in the submit handler.

## Date field and calendar panel

`.date-field` is a `<button>` styled as a field; the panel is a plain `div`
positioned under it. Not a native `<input type="date">`, because the range picker
needs two endpoints.

```html
<button class="date-field" id="date-toggle" aria-expanded="false" aria-controls="date-panel">
  <span id="date-summary">Select a date range</span>
  <span class="local-icon" data-icon="calendar" data-size="16" aria-hidden="true"></span>
</button>
<div class="date-panel" id="date-panel" hidden>…</div>
```

- Same 49px height, 12px padding and ring as a text field. `aria-expanded`
  drives the popover; the open state is `--ring-raised-hover` (no outline exists).
- The summary uses `tabular-nums` so the two dates do not jitter as they change.
- Day cells are `.date-day` with a 36px circle inside a 40px cell (44px on touch).
  Selected day is a filled `--primary` circle; days inside the range sit on
  `--primary-wash`.

## Segments

A joined row of `.segments > button` for one small choice with two to four
options (search radius). Compare with `<select>`: segments show every option at
once and cost one click; use them only when the options are short labels.

**Segments must sit inside `.filter-group`.** The global pill rule
(`button:not(.filter-group *…)`) gives 9999px corners to any button outside it,
and `.segments` has no `border-radius` of its own, so a segments row placed
anywhere else turns into pills inside a rounded box.

```html
<fieldset class="filter-group">
  <legend>Search radius</legend>
  <div class="segments">
    <button type="button" data-action="radius" data-radius="0.5" aria-pressed="true">0.5 mi</button>
  </div>
</fieldset>
```

- 49px tall to match the fields beside it, `--ring-raised`, one shared radius.
- Selected: `--primary-wash` fill plus `inset 0 -3px var(--primary)` underline,
  and class `selected`. The class paints it; `aria-pressed` is the accessible
  version. Set both, every time.
- `type="button"` on every segment: inside a `<form>` they would submit it.
- `aria-pressed="true"` on exactly one segment. There is no unset state, so the
  first option is the default unless saved data says otherwise. Segments cannot
  be invalid: one is always chosen, so they get no error slot.
- Tab moves through them one by one; arrow-key roving is not implemented.
- The group is `<fieldset class="filter-group">` + `<legend>`: `.filter-group`
  is the fieldset class for any segmented choice, not only filters. `role="group"`
  with an `aria-label` is equivalent for a bare div.

## Match options

`.match-option` rows list the addresses Mapbox returned. 13px text, `--radius-sm`,
`transparent` until selected, then `--primary-wash` + `--primary` with a
`check-circle` glyph closing the row. Unselected rows carry no glyph, so the mark
means "this one". One row at a time: radio-like, never a multi-select.
