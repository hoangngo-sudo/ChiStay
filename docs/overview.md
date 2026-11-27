# Overview: organizing many Chicago Places

Decided 2026-11-26 from the overview prototype, variant **Sections**. The
throwaway prototype (`proto/overview/`) was removed after the decision; this
document and the production screen are the record.

## Shape

- Saved places sit in sections, one per group, each under a disclosure heading
  that collapses its cards.
- `Group by` is a segmented control in the page heading with three choices:
  - **Decision** (default): `Worth a visit`, then `Still deciding`.
  - **Housing type**: `Studio`, `1 bedroom`, `2+ bedrooms`, `Shared bedroom`,
    then `No housing type`.
  - **ZIP code**: ascending, then `No ZIP code`. The ZIP is read from the saved
    address, after the first comma, so a house number is never taken for one.
- Inside every section the shortlist order still applies: worth a visit first,
  then lowest rent, then places without a rent.
- Empty groups are not shown. With nothing saved, the count, `Group by` and the
  sections are hidden and the empty state shows instead.
- Cards keep their original size at every width: two columns with a 24px gap,
  330px minimum height, 30px rent. Three narrower columns were tried above 800px
  and made the cards look too small, so they were reverted.
- The grouping choice is remembered per browser (`chistay-overview-group-v1` in
  `localStorage`). Collapsed sections reset on reload.

## Copy

- Count beside the title: `40 places` / `1 place`.
- Control legend: `Group by`. Options: `Decision`, `Housing type`, `ZIP code`.
- Section heading: the group name followed by its count in `--muted`.

## Accessibility

- Page `h1`, section `h2` (a button with `aria-expanded` and `aria-controls`),
  card address `h3`.
- Collapsed cards use `hidden`, so they leave the tab order.
- After regrouping or collapsing, focus returns to the control that was
  pressed. After a delete, focus goes to the next visible card, then the
  heading, then the empty state's add button.
- The caret turns 200ms with the shared drawer curve, only under
  `prefers-reduced-motion: no-preference`.

## Rejected

- Three-across cards above 800px: the cards became too small to read at a
  glance, so they stay two-up.
- **Find** (search box, All / Worth a visit / Deciding filter, sort menu over
  the existing grid): good for finding one known place, but it kept one large
  card per place and added a toolbar without giving the list any structure.
- **Ledger** (one sortable table row per place): the densest and best for
  comparing rents, but it dropped the card and illustration that the rest of
  the app is built around, and comparing places is Compare's job.
- **Current** (two-column grid, no controls): at 40 places it is a long scroll
  with no way to see the list in parts.
- Not tried, for a later round if sections are not enough: search on top of
  sections, and sorting within a section by something other than the shortlist
  order.
