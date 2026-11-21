# ChiStay

ChiStay is a vanilla HTML, CSS, and JavaScript prototype for finding reported incidents near the Chicago Place you are looking for. The interface is based on this design layout from Paper: [Link here](https://app.paper.design/file/01M4GQNZVM7ZQ5S69YXS2C7B52/p-1-0).

## Run locally

1. Install Node.js 20.19 or later in the 20.x series, or Node.js 22.12 or later.
2. Run `npm ci` in this folder to install the versions in the lockfile.
3. Create `.env.local` using `.env.example` as a guide.
4. Set `VITE_MAPBOX_TOKEN` to your own Mapbox public access token.
5. Run `npm run dev` and open the local address shown in the terminal.

Each collaborator configures their token locally. Git ignores `.env` files except `.env.example`; do not commit real tokens. Restart the development server after changing `.env.local`.

Use `npm test` to run the data tests and `npm run build` to create a production build in `dist/`.

## Data

The app reads the supplied `Crimes_20261029.csv` file. It is a historical snapshot of police districts 001, 010, 012, and 018. Incident locations in the data file are approximate. Records without coordinates cannot be included in radius results.

Chicago Place details are saved in the browser's local storage. The saved record includes the coordinates, so the Compare screen does not need to geocode a place again. An older saved place without coordinates is looked up once the first time it is opened or compared. The record also keeps the date range and radius from the visit decision, so reopening the place restores that window. Labels for the same street address are treated as one place (`W` and `West`, `St` and `Street`, and the city, state and ZIP are ignored), so re-adding an address updates its card instead of creating a duplicate.

## Compare

A confirmed address is added to the list immediately. The Compare screen shows every saved Chicago Place one after another with the same 10-day window and 0.5-mile radius. Each band has the total, the three most reported categories, a daily incident chart, and the three newest incidents. The full incident list stays on the place's own screen. The overview card shows the address, rent, housing type and visit decision, not a count.
