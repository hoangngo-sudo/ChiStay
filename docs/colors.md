# Colours

Every colour comes from the tokens declared once in `:root` at the top of
`src/style.css`. Components use the token name, never the value.

## Surfaces

| Token | Value | Use |
| --- | --- | --- |
| `--ground` | `oklch(98.2% 0.001 106.4)` | the page behind every panel |
| `--surface` | `oklch(100% 0 0)` | topbar, sidebar, panels, cards, controls, dialogs |
| `--surface-sunken` | `oklch(95.6% 0.003 106.4)` | disabled button fill and border |
| `--surface-hover` | `oklch(96.4% 0.002 106.4)` | hover fill for neutral rows and secondary buttons; pressed fill for inputs |
| `--surface-pressed` | `oklch(93.3% 0.003 106.4)` | nav item while pressed |

## Text

| Token | Value | Use |
| --- | --- | --- |
| `--ink` | `oklch(24.3% 0.008 106.4)` | all body text and headings |
| `--muted` | `oklch(37.8% 0.008 106.4)` | secondary lines, units, captions, inactive nav |
| `--ink-faint` | `oklch(60.5% 0.009 106.4)` | disabled calendar days only |

## Lines

| Token | Value | Use |
| --- | --- | --- |
| `--border` | `oklch(93.3% 0.003 106.4)` | hairlines: panel edges, row dividers, topbar and sidebar edges |
| `--border-strong` | `oklch(79.1% 0.008 106.4)` | control ring on hover, disabled calendar arrows |

## Action (deliberately near-black, not brand-coloured)

| Token | Value | Use |
| --- | --- | --- |
| `--primary` | `oklch(24.3% 0.008 106.4)` | filled primary button, links, selected day, selected match label |
| `--primary-hover` | `oklch(34.4% 0.008 106.4)` | primary button hover |
| `--primary-wash` | `oklch(95.6% 0.003 106.4)` | active nav item, selected match row, days inside the range |
| `--primary-wash-strong` | `oklch(93.3% 0.003 106.4)` | active nav item while pressed |

## Status

| Token | Value | Use |
| --- | --- | --- |
| `--danger` | `oklch(48% 0.169 29.3)` | error text, invalid ring, required asterisk, danger button, delete hover glyph |
| `--danger-line` | `oklch(77.7% 0.057 25.3)` | hairline around the destructive hover state |
| `--danger-wash` | `oklch(95.9% 0.014 22.8)` | error halo (3px) and destructive hover fill |
| `--success` | `oklch(37.8% 0.008 106.4)` | the toast glyph and nothing else. It is ink, not green: a green tick would be the only saturated colour in the app |

## Meaning colours

| Token | Value | Use |
| --- | --- | --- |
| `--incident` | `oklch(85% 0.146 90.5)` | disc behind a crime category glyph |
| `--incident-line` | `oklch(48.1% 0.098 86.5)` | 1.5px ring around that disc |
| `--decision-wash` | `oklch(96% 0.02 238.7)` | "Worth a visit" chip background |
| `--decision-ink` | `oklch(54% 0.162 252.2)` | that chip's text and glyph |
| `--map-ground` | `oklch(95.6% 0.003 106.4)` | map frame behind the tiles |
| `--backdrop` | `rgb(0 0 0 / 0.18)` | dialog backdrop |

## Flowcharts

### What background does this surface get?

```
Is it a region of the page (panel, card, empty state, map frame)?
 ├── Yes → --surface + inset 0 0 0 1px var(--border), no shadow
 └── No, it is something the user presses or types into
      ├── Is it selected / currently active? → --primary-wash
      ├── Is it a neutral row on hover? → --surface-hover
      ├── Is the action destructive, on hover? → --danger-wash
      └── Default → --surface + --ring-raised
```

### What text colour?

```
 ├── Error message or required marker → --danger
 ├── Worth-a-visit chip → --decision-ink
 ├── Disabled calendar day → --ink-faint
 ├── Secondary information, caption, inactive nav → --muted
 └── Everything else → --ink
```

### Which hue is allowed?

1. **Amber** belongs to incident categories. Nothing else may use it.
2. **Red** means error or destructive. Never for emphasis, never for a badge.
3. **Blue** means one thing: the worth-a-visit chip. Do not use it for focus,
   links or information states.
4. **Everything neutral** comes from the ink/surface ramp above. A neutral with
   a different hue bias (a cool grey next to these warm ones) will look dirty.

## Rules

- A new colour needs a new token here with a named role, and a reason the
  existing tokens cannot carry it. Do not hardcode a one-off.
- Error colour is never the only signal: pair `--danger` with an icon and text.
- Disabled states use `--surface-sunken` + `--ink-faint`, not `opacity`. Opacity
  passes contrast on one background and fails on another.
