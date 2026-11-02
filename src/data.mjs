// The kept categories live with the icons. Importing them here would drag SVG
// imports into plain node, so the caller passes the list in.
const EARTH_RADIUS_MILES = 3958.7613;

// "THEFT" -> "Theft"
export function titleCase(value) {
  const text = String(value || "").toLowerCase();
  return text.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// "2026-10-21" -> "Oct 21, 2026" (or "Oct 21" with other options)
export function formatDay(
  day,
  options = { month: "short", day: "numeric", year: "numeric" },
) {
  if (!day) {
    return "";
  }
  return new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
}

function parseCrimeDate(value) {
  const match =
    /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2}) (AM|PM)$/.exec(
      value || "",
    );
  if (!match) {
    return null;
  }

  const [
    ,
    monthText,
    dayText,
    yearText,
    hourText,
    minuteText,
    secondText,
    period,
  ] = match;
  const month = Number(monthText);
  const day = Number(dayText);
  const year = Number(yearText);
  let hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (hour < 1 || hour > 12 || minute > 59 || second > 59) {
    return null;
  }
  hour = (hour % 12) + (period === "PM" ? 12 : 0);

  const timestamp = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { timestamp, day: `${yearText}-${monthText}-${dayText}` };
}

function parseCoordinate(value, maximum) {
  if (value == null || String(value).trim() === "") {
    return null;
  }
  const coordinate = Number(value);
  if (!Number.isFinite(coordinate) || Math.abs(coordinate) > maximum) {
    return null;
  }
  return coordinate;
}

function normalizeIncident(row) {
  const date = parseCrimeDate(row.Date);
  const latitude = parseCoordinate(row.Latitude, 90);
  const longitude = parseCoordinate(row.Longitude, 180);

  return {
    id: String(row.ID || ""),
    caseNumber: String(row["Case Number"] || ""),
    date,
    block: String(row.Block || ""),
    category: String(row["Primary Type"] || ""),
    description: String(row.Description || ""),
    location: String(row["Location Description"] || ""),
    district: String(row.District || ""),
    latitude,
    longitude,
  };
}

export function prepareIncidents(rows, keptCategories) {
  // Rows whose category has no icon are dropped here, so the rest of the app
  // never has to handle a category it cannot show. The kept list comes from
  // assets.js and is passed in, so this module imports no SVG.
  const incidents = rows
    .map(normalizeIncident)
    .filter((incident) => keptCategories.includes(incident.category));
  const dated = incidents.filter((incident) => incident.date);
  const days = dated.map((incident) => incident.date.day).sort();
  const presentCategories = [
    ...new Set(incidents.map((incident) => incident.category)),
  ].sort();
  const missingCoordinates = incidents.filter(
    (incident) => incident.latitude === null || incident.longitude === null,
  ).length;
  const hasUsableIncidents = incidents.some((incident) => {
    return incident.date && incident.latitude !== null && incident.longitude !== null;
  });

  return {
    incidents,
    categories: presentCategories,
    missingCoordinates,
    hasUsableIncidents,
    firstDay: days[0] || "",
    lastDay: days[days.length - 1] || "",
  };
}

export function defaultFilters(lastDay) {
  if (!lastDay) {
    return { radius: 0.5, startDay: "", endDay: "", category: "" };
  }
  const start = new Date(`${lastDay}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 89);
  return {
    radius: 0.5,
    startDay: start.toISOString().slice(0, 10),
    endDay: lastDay,
    category: "",
  };
}

function distanceMiles(first, second) {
  const radians = Math.PI / 180;
  const latitudeDifference = (second.latitude - first.latitude) * radians;
  const longitudeDifference = (second.longitude - first.longitude) * radians;
  const firstLatitude = first.latitude * radians;
  const secondLatitude = second.latitude * radians;
  const haversine =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDifference / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

export function filterIncidents(incidents, center, filters) {
  if (
    !center ||
    !filters.startDay ||
    !filters.endDay ||
    filters.startDay > filters.endDay
  ) {
    return [];
  }

  return incidents
    .filter((incident) => {
      if (
        !incident.date ||
        incident.latitude === null ||
        incident.longitude === null
      ) {
        return false;
      }
      if (
        incident.date.day < filters.startDay ||
        incident.date.day > filters.endDay
      ) {
        return false;
      }
      if (filters.category && incident.category !== filters.category) {
        return false;
      }
      return distanceMiles(center, incident) <= Number(filters.radius);
    })
    .sort(
      (first, second) =>
        second.date.timestamp - first.date.timestamp ||
        first.id.localeCompare(second.id),
    );
}
