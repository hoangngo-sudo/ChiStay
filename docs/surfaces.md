# Surfaces, overlays and map furniture

Two tiers, and the choice is about what the thing *is*:

| Tier | Look | Examples |
| --- | --- | --- |
| Region | `--surface`, `inset 0 0 0 1px var(--border)`, no shadow | `.apartment-card`, `.form-panel`, `.empty-overview`, `.records-panel`, `.map-frame` |
| Control | `--surface`, `--ring-raised` | `.button.secondary`, `input`, `.save-choice`, `.segments` |

A region never gets a drop shadow. If a flat region feels weak, the fix is
spacing or hierarchy, not a shadow; a shadow makes it float like a control.

## Shell

`65px` topbar (plus `env(safe-area-inset-top)`), `253px` sidebar (`205px` under
1150px, a horizontal bar under 800px), `.main` padded `24px` top and `36px`
inline. The sidebar is the only navigation: two `.nav-item`s, never a third
level. Every edge is a 1px `--border` line, never a shadow.

## ApartmentCard

One saved apartment. Lives in `.cards` (two columns, 24px gap, one column under
560px).

```html
<article class="apartment-card">
  <img class="card-building" alt="" aria-hidden="true" />
  <div class="card-top">
    <div>
      <h2 data-field="address"></h2>
      <p class="rent" data-field="rent"></p>
    </div>
    <span class="housing-type" data-field="housing-type"></span>
  </div>
  <p class="decision" data-field="decision">…</p>
  <div class="card-actions">…</div>
</article>
```

- 330px minimum height, 22px padding. The illustration is decorative
  (`alt=""`, `aria-hidden`) and has `pointer-events: none` so it never eats a
  click meant for the cards' actions.
- The rent is the loudest thing on the card (30px) because it is the number the
  user compares. A missing rent is `Rent not added` at 16px `--muted`, not `$0`
  and not an empty gap.
- `.decision` is a chip, not text: 12px/500, `--decision-wash`, `--decision-ink`.
  It renders only for the worth-a-visit state; its absence is the other state.
- Actions sit in a fixed `.card-actions` row at the bottom left, so they line up
  across cards regardless of how long the address is.
- The delete button lives in `.card-tray`. Above 560px the tray is
  `display: contents`, so the button simply sits in the action row and nothing
  is revealed. Under 560px the tray is hidden and the button appears in the
  `#card-sheet` dialog instead: a viewport-level sheet attached to the bottom
  edge, with a handle, a heading and the same `.icon-button bordered` delete
  button. A 500ms hold on the card opens it (right click, the Menu key and
  Shift+F10 open it too, from the card's `tabindex="0"`). The hold shows a 2px
  linear progress line on the card's bottom edge; moving more than 10px,
  scrolling, releasing or cancelling the pointer calls it off.
- Sheet motion follows Vaul: enter and exit are 500ms
  `cubic-bezier(0.32, 0.72, 0, 1)` on `transform` with the backdrop fading in
  step, and `@starting-style` supplies the start position. Drag to dismiss
  tracks the finger 1:1 (`is-dragging` removes the easing), the backdrop
  opacity is derived from `--sheet-drag` so the two never drift, and passing
  40% of the height or releasing faster than 500px/s dismisses. The dialog stays
  open during the exit slide and closes on `transitionend`, because closing it
  first would disappear in one frame. Escape, a backdrop tap and the delete
  action all animate the same way.

## Dialog

Two dialogs only: save (choose a decision) and delete (confirm). Native
`<dialog>` with `showModal()`.

```html
<dialog id="save-dialog" class="dialog" aria-labelledby="save-dialog-title">
  <div class="dialog-header">
    <h2 id="save-dialog-title">Save apartment</h2>
    <button class="icon-button" data-action="close-dialog" aria-label="Close">…</button>
  </div>
  <div class="dialog-context">
    <strong id="save-dialog-address"></strong>
    <span id="save-dialog-rent"></span>
  </div>
  …
</dialog>
```

- `min(479px, 100% - 32px)` wide, 24px padding, `--shadow-dialog` on top of the
  control ring. The backdrop is `--backdrop` (18% black).
- Enters at `scale(0.98)` → `1` over 220ms ease-out; leaves in 160ms. Never from
  `scale(0)`: an element should keep a visible shape while it moves.
- The dialog repeats the address it is acting on. A confirmation that does not
  name its subject makes the user cancel to check.
- Destructive actions are on the right of `.dialog-actions`; Cancel is
  `secondary` on the left, and the two are separated by 10px, never adjacent with
  equal weight.

## Toast

One toast, bottom left, announcing a save. `role="status"`, so it is announced
without stealing focus.

- 13px, 14/16px padding, `--ring-raised` + `--shadow-toast`, glyph in `--success`.
- Enters from `translateY(16px)` over 220ms ease-out; leaves towards it by 8px
  in 160ms on an accelerating curve. The exit is quieter than the enter because
  attention has already moved on.
- Both live inside `@media (prefers-reduced-motion: no-preference)` and are
  gated on `.pointer-input`, so a keyboard save does not animate.
- It auto-dismisses after 5s. Never put an action in it: a toast that expires is
  not a place to ask for a decision.

## Map furniture

The map frame is a region (`--map-ground`, hairline). Everything drawn on the
tiles is a neutral chip, never a white card, because white on a light map is
invisible:

- `.map-address-label` — the searched address, one line, ellipsised at 220px.
- `.map-incident-label` — the selected report, three lines: category (14px/600),
  block, date (both 12px at 78% white). Shown only while a record is open.
- `.stack-popup` — the list of reports that share one point, opened by clicking a
  stacked marker.

All three use `rgb(74 74 72 / 0.92)` with white text. These are the only
non-token colours allowed outside shadows, and they are exempt because they sit
over imagery rather than over a surface.

## Empty and status states

`.empty-overview` (no apartments saved) is the model for all of them: a region
with 44/32px padding, a 18px heading, one 14px sentence capped at 42ch, and the
next action as a `primary` button.

```html
<section class="empty-overview">
  <h2>No apartments saved yet</h2>
  <p>Add an apartment you are considering to find nearby reported incidents.</p>
  <button class="button primary" data-action="add">…Add apartment</button>
</section>
```

Rules: name the state, say what to do next, and put the button in the block.
`No apartments saved yet` plus a button, never `No results`. `.records-empty`
and `.data-notice` are the same idea at smaller sizes (16px heading, 13px
body; 12px muted note in `.data-notice`).
