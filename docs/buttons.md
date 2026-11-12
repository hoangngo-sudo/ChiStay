# Buttons and other pressable things

Every pressable element in the app is a real `<button>`. Never a `div` or a
`span` with a click handler: the button element is what gives keyboard and
screen-reader users an action.

## Radius: pills by default, 6px inside four containers

```css
button:not(.sidebar *, .filter-group *, .records-panel *, .stack-popup-row) {
  border-radius: 9999px;
}
```

So a `.button` in `.main` or a `<dialog>` is a pill, even though `.button` sets
`--radius`: the rule above is more specific and wins. Inside the sidebar, the
filter row, the records panel and the map popup, buttons take 6px corners.

Do not add a `border-radius` to a new button to force a shape. If a button looks
wrong, it is in the wrong container.

## Button

Use for actions that change state or move the user to the next screen.
Navigation that looks like a button is a `NavItem`; a bare inline action inside a
row is a `TextButton`.

Variants: `primary`, `secondary`, `danger`. Nothing else exists. `.button` with
no variant renders as a transparent, unpadded element and is a bug.

- `primary` → the single most important action on the screen. One per view.
- `secondary` → the default. Every other action, including Cancel.
- `danger` → destructive or hard-to-undo, and always inside a confirmation.

```html
<!-- Correct: primary for the one next step -->
<button class="button primary" data-action="add">
  <span class="local-icon" data-icon="add-apartment" data-size="18" aria-hidden="true"></span>
  Add apartment
</button>

<!-- Incorrect: ghost does not exist, and Cancel must never be primary -->
<button class="button ghost">Cancel</button>
```

### Choosing a variant

```
Is it the single most important action on this screen?
 ├── Yes → primary
 └── No
      ├── Does it delete or overwrite something? → danger, inside a dialog
      └── Everything else → secondary
```

### States

| State | What changes |
| --- | --- |
| rest | `--ring-raised` for `secondary`; flat fill for `primary` and `danger` |
| hover | `--primary-hover` (primary), `--surface-hover` (secondary), pointer devices only |
| pressed | `filter: brightness(0.92)` globally, plus `transform: scale(0.98)` where motion is allowed |
| disabled | `--surface-sunken` fill and border, `--ink-faint` text, `cursor: not-allowed` |
| focused | nothing. There is no focus ring in this app |

Press feedback exists so the click feels received. Keep it; it is the only
confirmation a mouse user gets before a network round trip.

## IconButton

An icon with no visible label, for a repeated action in a dense row.

Variants: plain (transparent, `--muted`, sits on a surface) and `.bordered`
(raised like a secondary button). Both are 44×44.

```html
<!-- Correct: label for assistive tech, tooltip for sighted users -->
<button class="icon-button bordered" data-action="delete-apartment"
        aria-label="Delete apartment" title="Delete apartment"></button>

<!-- Incorrect: an icon-only button with no accessible name -->
<button class="icon-button"><svg>…</svg></button>
```

`aria-label` is mandatory. The glyph is decorative, so the SVG is
`aria-hidden="true"`.

## TextButton

An inline, low-emphasis action that belongs to the content around it, such as
going back one level. 44px tall, `--primary` text at 13px/600, no fill.

```html
<button class="text-button back-button" data-action="back-to-records">
  <svg aria-hidden="true">…</svg>
  Back to incidents
</button>
```

Use it for "back" and "show more". Do not use it for a state-changing action;
that is a `secondary` button.

## SaveChoice and SaveSecondary

Dialog-only controls for the save decision. They are not `.button`: they are full
width because the dialog is asking one question.

| Class | Height | Look |
| --- | --- | --- |
| `.save-choice` | 48px | raised row, text left, glyph right |
| `.save-secondary` | 44px | transparent text button under the choices |

```html
<button class="save-choice" data-action="save" data-decision="worth">
  <span>Save as worth a visit</span>
  <span class="local-icon" data-icon="bookmark" data-size="18" aria-hidden="true"></span>
</button>
```

The first choice is always the positive one and sits on top. The escape hatch
("Save without a decision") is `.save-secondary`, never a third `.save-choice`:
three equal rows make none of them the answer.

## NavItem

The two sidebar destinations. Built as `<button class="nav-item">` because they
swap a screen in place; `active` and `aria-current="page"` are set together in
`markNav()`.

```html
<button id="nav-overview" class="nav-item active" data-action="overview" aria-current="page">
  <span class="local-icon" data-icon="bookmark" data-size="20" aria-hidden="true"></span>
  <span>Overview</span>
</button>
```

Rules: 46px minimum height, 14px/500, `--muted` at rest, `--primary` on
`--primary-wash` when active. Never more than two items, never a third level.
