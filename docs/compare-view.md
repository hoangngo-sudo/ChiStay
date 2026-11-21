# Compare Chicago Places

Decided 2026-11-21 from the second prototype round, variant **Bands**. The
throwaway prototype routes were removed after the decision; this document and
the production screen are the record.

## Shape

- Every saved Chicago Place is one band, one after another.
- A band has three columns with the same widths across the page:
  1. Place identity, visit decision, rent, housing type, total incidents, and
     the three most reported categories.
  2. Ten daily incident bars on one shared scale, plus the busiest day.
  3. The three newest incidents and a "View all incidents" action.
- The date window, radius, and category filter are identical for every place.
  The compare screen has no filter controls of its own.
- The full incident list stays on the place's own incident screen. Compare is a
  comparison surface, not a replacement for browsing one place.

## Copy

- Screen title: `Compare Chicago Places in 10 days`.
- Window subtitle: `Oct 12-21, 2026 · 0.5 mi`.
- Section name (screen reader only): `Chicago Places, one after another`.
- Column headers: `Chicago Place`, `Daily incidents`, `Newest incidents`.
- Total: `24 incidents in 10 days`.
- Chart axis: first and last day dates under the bars.
- Chart caption: `Busiest day: 4 incidents`.
- Recent list label: `3 newest of 258`.
- Action: `View all incidents`.

## Reading rules

- Bands follow the same order as the overview: worth a visit first, then
  cheapest rent, with unknown rent last. This screen does not repeat the order
  caption; the overview's sort label explains the same order.
- The daily chart is one image to assistive technology and carries the exact
  ten daily counts in its label. The first and last days are printed
  under the bars for sighted readers; the hover titles are not the only route.
- The page subtitle is a live status region. It reads `Loading incidents`, or
  `Locating saved places` for older saved items without coordinates, then the
  ready window (`Oct 12-21, 2026 · 0.5 mi`). With no saved places the subtitle
  is hidden; the empty state carries the message.
- The overview card shows no incident count. The count lives here, where it
  can be read against other places. The date range and radius saved with a
  visit decision are still restored when that place is reopened.
- `View all incidents` is underlined at rest (1px, 3px offset). The band is a
  dense block of numbers and the action has no icon, so the line is what marks
  it as a control rather than another caption.
- On a phone the band stacks. The address and meta pills sit in one column and
  `View all incidents` sits under them, not beside the last pill. The page
  title balances its lines and the subtitle wraps as one sentence, so neither
  breaks in the middle of a phrase.

## Navigation

Three items: `Overview`, `Add Chicago Place`, `Compare`.

- On phones the add item shows `Add place` visibly and keeps
  `aria-label="Add Chicago Place"`, so the row stays one line at 320px instead
  of wrapping.
- 13px labels, 8px inline padding, 6px icon gap below 560px. Never wrap a nav
  label below 800px.
- The active item keeps the existing primary wash.

## Rejected

- **Matrix**: strongest at-a-glance comparison, but the actual incidents are
  separated from the place columns, so it does not read as "one after another".
- **Timeline**: the most literal "all incidents at one time", but it loses place
  grouping, which makes a place's overall picture harder to read.
- **Round 1 Ledger, Dossiers, Columns**: the Ledger hid detail, the Dossiers
  turned into a long stack of similar cards, and the Columns were too cramped.
- **Counts-only overview**: a single number per card cannot show what kind of
  incidents are nearby, so the compare screen remains necessary.
