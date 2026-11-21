import Papa from "papaparse";
import csvUrl from "../Crimes_20261029.csv?url";
import {
  defaultFilters,
  filterIncidents,
  filtersForDays,
  formatDay,
  prepareIncidents,
  titleCase,
} from "./data.mjs";
import { createMap, findAddress } from "./map.js";
import {
  apartmentIllustration,
  categories,
  icons,
  incidentIcons,
} from "./assets.js";

// Page elements we look up once
const screens = {
  overview: document.querySelector("#screen-overview"),
  verify: document.querySelector("#screen-verify"),
  explore: document.querySelector("#screen-explore"),
  compare: document.querySelector("#screen-compare"),
};

const navOverview = document.querySelector("#nav-overview");
const navAdd = document.querySelector("#nav-add");
const navCompare = document.querySelector("#nav-compare");

const toast = document.querySelector("#toast");
const toastMessage = document.querySelector("#toast-message");
let toastTimer;

// The state of the app
//
// This is the only place that remembers what the user is doing.
const storageKey = "chistay-apartments-v1";
const savedLocations = new Map();

const STREET_SUFFIXES = {
  street: "st",
  avenue: "ave",
  road: "rd",
  boulevard: "blvd",
  drive: "dr",
  place: "pl",
  court: "ct",
  lane: "ln",
  terrace: "ter",
  parkway: "pkwy",
  circle: "cir",
  highway: "hwy",
  square: "sq",
  trail: "trl",
  saint: "st",
};
const DIRECTION_WORDS = {
  north: "n",
  south: "s",
  east: "e",
  west: "w",
};
const ORDINAL_WORDS = {
  first: "1st",
  second: "2nd",
  third: "3rd",
  fourth: "4th",
  fifth: "5th",
  sixth: "6th",
  seventh: "7th",
  eighth: "8th",
  ninth: "9th",
  tenth: "10th",
};

// Mapbox can return "925 W Taylor St, Chicago, IL" and "925 West Taylor
// Street, Chicago 60612" for the same building. Compare a normalized key so
// the shortlist keeps one card, while the saved label stays as first seen.
function normalizeAddress(address) {
  let text = String(address || "").toLowerCase();
  text = text.replace(/[.,]/g, " ");
  text = text.replace(/\b(chicago|illinois|il|usa|united states)\b/g, " ");
  text = text.replace(/\b\d{5}(?:-\d{4})?\b/g, " ");
  text = text.replace(/\b(north|south|east|west)\b/g, (word) => {
    return DIRECTION_WORDS[word];
  });
  text = text.replace(/\b(street|avenue|road|boulevard|drive|place|court|lane|terrace|parkway|circle|highway|square|trail|saint)\b/g, (word) => {
    return STREET_SUFFIXES[word];
  });
  text = text.replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/g, (word) => {
    return ORDINAL_WORDS[word];
  });
  return text.replace(/\s+/g, " ").trim();
}

function findApartmentIndex(address) {
  const key = normalizeAddress(address);
  return state.apartments.findIndex((saved) => {
    return normalizeAddress(saved.address) === key;
  });
}

// Older storage can contain two labels for one address. Keep the first
// occurrence and merge the fields the user may have set on either copy.
function mergeDuplicateApartments(apartments) {
  const indexByAddress = new Map();
  const merged = [];

  apartments.forEach((apartment) => {
    const key = normalizeAddress(apartment.address);
    const existingIndex = indexByAddress.get(key);

    if (existingIndex === undefined) {
      indexByAddress.set(key, merged.length);
      merged.push(apartment);
      return;
    }

    const existing = merged[existingIndex];
    merged[existingIndex] = {
      ...existing,
      rent: existing.rent || apartment.rent,
      housingType: existing.housingType || apartment.housingType,
      decision:
        existing.decision === "worth" || apartment.decision === "worth"
          ? "worth"
          : existing.decision || apartment.decision || "undecided",
      latitude: Number.isFinite(existing.latitude) ? existing.latitude : apartment.latitude,
      longitude: Number.isFinite(existing.longitude) ? existing.longitude : apartment.longitude,
      filters: existing.filters || apartment.filters,
    };
  });

  return merged;
}

const state = {
  screen: "overview",
  apartments: loadApartments(),
  apartment: null, // the apartment being added or viewed
  matches: [], // every address Mapbox found for the typed text
  match: null, // the address the user picked
  data: null, // the incident snapshot, once the CSV is parsed
  dataError: "",
  filters: null,
  selectedId: "", // the incident open in the detail view
  toast: "",
  map: null,
};

// Saved apartments to localStorage

function loadApartments() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(saved)) {
      return [];
    }
    const cleaned = saved.filter((item) => {
      return item && typeof item.address === "string";
    });
    const merged = mergeDuplicateApartments(cleaned);
    if (merged.length !== cleaned.length) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(merged));
      } catch {
        // Keep the in-memory merge; the next successful save will persist it.
      }
    }
    return merged;
  } catch {
    // If the saved text is not valid JSON we start with an empty list.
    return [];
  }
}

function persistApartments() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state.apartments));
    return true;
  } catch {
    state.toast = "Unable to save on this device. Check browser storage settings.";
    return false;
  }
}

// A saved place can answer the radius filter only once it has coordinates.
// Places added from an address search get them immediately; older saved items
// pick them up the first time they are opened or compared.
function hasLocation(place) {
  return Number.isFinite(place.latitude) && Number.isFinite(place.longitude);
}

// A confirmed address belongs on the list right away, without waiting for the
// visit-decision dialog. Re-finding an address updates its details but keeps
// the decision the user already made.
function rememberApartment(apartment, match) {
  const addressKey = normalizeAddress(apartment.address);
  const previous = [...state.apartments];
  const existingIndex = findApartmentIndex(apartment.address);

  let added = false;

  if (existingIndex === -1) {
    state.apartments.push({
      ...apartment,
      decision: "undecided",
      latitude: match.latitude,
      longitude: match.longitude,
    });
    added = true;
  } else {
    const existing = state.apartments[existingIndex];
    state.apartments[existingIndex] = {
      ...existing,
      rent: apartment.rent || existing.rent,
      housingType: apartment.housingType || existing.housingType,
      latitude: match.latitude,
      longitude: match.longitude,
    };
  }

  if (!persistApartments()) {
    state.apartments = previous;
    showToast(state.toast);
    return false;
  }

  savedLocations.set(addressKey, match);
  renderOverview();

  if (added) {
    state.toast = "Chicago Place added to your shortlist";
    showToast(state.toast);
    hideToastLater();
  }

  return added;
}

// Small helpers used when building text and markup
// Text that comes from the CSV or the user goes through escapeHtml
// before it is put inside an HTML string.
const htmlEscapes = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => htmlEscapes[character]);
}

function formatRent(rent) {
  if (!rent) {
    return "";
  }
  return `$${Number(rent).toLocaleString("en-US")} / month`;
}

// Icons are inline SVG, so they take the colour of the element around them.
function icon(name, size = 18) {
  const svg = icons[name];
  if (!svg) {
    throw new Error(`Icon not found: ${name}`);
  }
  return `<span class="local-icon" style="width: ${size}px; height: ${size}px" aria-hidden="true">${svg}</span>`;
}

function fillIconSlots() {
  document.querySelectorAll("[data-icon]").forEach((slot) => {
    const size = Number(slot.dataset.size) || 18;
    slot.style.width = `${size}px`;
    slot.style.height = `${size}px`;
    slot.innerHTML = icons[slot.dataset.icon] || "";
  });
}

function incidentIcon(category) {
  // Crime categories stay as image files: their colours carry meaning.
  const image = incidentIcons[category];
  if (!image) {
    return icon("triangle-alert", 20);
  }
  return `<img class="crime-icon-image" src="${image}" width="20" height="20" alt="" aria-hidden="true">`;
}

// Moving between screens
function markNav(button, isActive) {
  button.classList.toggle("active", isActive);
  if (isActive) {
    button.setAttribute("aria-current", "page");
  } else {
    button.removeAttribute("aria-current");
  }
}

function showScreen(name) {
  const screenChanged = state.screen !== name;
  addressSearchController?.abort();
  state.screen = name;

  screens.overview.hidden = name !== "overview";
  screens.verify.hidden = name !== "verify";
  screens.explore.hidden = name !== "explore";
  screens.compare.hidden = name !== "compare";

  markNav(navOverview, name === "overview");
  markNav(navAdd, name === "verify" || name === "explore");
  markNav(navCompare, name === "compare");

  showToast(state.toast);
  startMap();

  if (name === "compare") {
    renderCompare();
  }

  if (screenChanged) {
    const heading = screens[name].querySelector("h1");
    document.title = `${heading.textContent} | ChiStay`;
    heading.setAttribute("tabindex", "-1");
    heading.focus();
  }
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.classList.remove("is-expiring");
  toastMessage.textContent = message || "";
  toast.hidden = !message;
}

// The toast is shown immediately, then removed on a timer that outlasts the
// exit animation. Any screen change calls showToast() and clears the timer, so
// callers set this again after the screen has settled.
function hideToastLater() {
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toast = "";
    toast.classList.add("is-expiring");
    toast.hidden = true;
  }, 5000);
}

// Screen 1 - apartment shortlist
function renderOverview() {
  const list = document.querySelector("#apartment-list");
  const emptyState = document.querySelector("#overview-empty");
  const sortLabel = document.querySelector("#overview-sort");

  list.innerHTML = "";

  const hasApartments = state.apartments.length > 0;
  list.hidden = !hasApartments;
  emptyState.hidden = hasApartments;

  // With one apartment there is no order to explain. When nothing is marked
  // worth a visit, rent is the only thing ordering the list, so say that.
  const hasWorthAVisit = state.apartments.some((apartment) => {
    return decisionRank(apartment) === 0;
  });
  sortLabel.textContent = hasWorthAVisit ? "Worth a visit first" : "Cheapest first";
  sortLabel.hidden = state.apartments.length < 2;

  orderForShortlist(state.apartments).forEach((entry) => {
    list.append(apartmentCard(entry.apartment, entry.index));
  });
}

// A place's saved visit-decision window is still restored when the place is
// reopened in the Explore filters. The overview card itself shows no count.
function hasSavedIncidentFilters(apartment) {
  const saved = apartment.filters;
  return Boolean(saved && saved.startDay && saved.endDay);
}

function placeIncidentFilters(apartment, fallback) {
  if (!hasSavedIncidentFilters(apartment)) {
    return fallback;
  }

  const saved = apartment.filters;
  const radius = Number(saved.radius);
  return {
    radius: Number.isFinite(radius) ? radius : fallback.radius,
    startDay: saved.startDay,
    endDay: saved.endDay,
    // The category control is a view filter, not part of the saved decision.
    category: "",
  };
}

function decisionFilters(filters) {
  if (!filters || !filters.startDay || !filters.endDay) {
    return null;
  }
  return {
    radius: Number(filters.radius),
    startDay: filters.startDay,
    endDay: filters.endDay,
  };
}

// How the shortlist is ordered
//
// Apartments marked worth a visit come first, so the places the user already
// decided to see are the ones they scan first. Inside each half the cheapest
// rent comes first. Rent is optional, so an apartment without one is not
// treated as free: it is placed last inside its half.
function orderForShortlist(apartments) {
  // Each entry keeps the position the apartment was saved at: the card's
  // buttons use that position to find the apartment again, and it also breaks
  // ties between two apartments with the same rent.
  const entries = [];

  apartments.forEach((apartment, index) => {
    entries.push({
      apartment,
      index,
      rent: rentValue(apartment.rent),
    });
  });

  entries.sort((first, second) => {
    // 1. Worth a visit before still deciding.
    const firstDecision = decisionRank(first.apartment);
    const secondDecision = decisionRank(second.apartment);
    if (firstDecision !== secondDecision) {
      return firstDecision - secondDecision;
    }

    // 2. Cheapest rent first, with an unknown rent after the known ones.
    const firstRent = first.rent;
    const secondRent = second.rent;
    if (firstRent === null && secondRent !== null) {
      return 1;
    }
    if (firstRent !== null && secondRent === null) {
      return -1;
    }
    if (firstRent !== null && secondRent !== null && firstRent !== secondRent) {
      return firstRent - secondRent;
    }

    // 3. Same decision and same rent: keep the order they were saved in.
    return first.index - second.index;
  });

  return entries;
}

// 0 for an apartment marked worth a visit, 1 for one still deciding.
function decisionRank(apartment) {
  return apartment.decision === "worth" ? 0 : 1;
}

// Number("") is 0, so a missing rent becomes null instead of a price of $0.
function rentValue(rent) {
  if (!rent) {
    return null;
  }
  const value = Number(rent);
  if (!Number.isFinite(value)) {
    return null;
  }
  return value;
}

// Copies the <template id="apartment-card-template"> and fills it in.
function apartmentCard(apartment, index) {
  const template = document.querySelector("#apartment-card-template");
  const card = template.content.firstElementChild.cloneNode(true);

  const worthAVisit = apartment.decision === "worth";

  card.querySelector(".card-building").src = apartmentIllustration;

  const address = card.querySelector('[data-field="address"]');
  address.textContent = apartment.address;
  address.title = apartment.address;

  const rent = card.querySelector('[data-field="rent"]');
  const formattedRent = formatRent(apartment.rent);
  rent.textContent = formattedRent || "Rent not added";
  rent.classList.toggle("rent-missing", !formattedRent);

  card.querySelector('[data-field="housing-type"]').textContent = apartment.housingType || "";

  // The status row only exists for apartments marked worth a visit; one saved
  // without a decision shows no row at all.
  const decision = card.querySelector('[data-field="decision"]');
  decision.hidden = !worthAVisit;
  card.querySelector('[data-field="decision-icon"]').innerHTML = icon("worth-a-visit", 16);
  card.querySelector('[data-field="decision-text"]').textContent = "Worth a visit";

  const openButton = card.querySelector('[data-action="open-apartment"]');
  openButton.dataset.index = index;

  const deleteButton = card.querySelector('[data-action="delete-apartment"]');
  deleteButton.dataset.index = index;
  deleteButton.setAttribute("aria-label", `Delete ${apartment.address}`);
  deleteButton.innerHTML = icon("trash-2");

  return card;
}

// Screen 2 - verify the address
function renderVerify() {
  fillVerifyForm();
  renderMatches();
}

function fillVerifyForm() {
  const apartment = state.apartment || { address: "", rent: "", housingType: "" };

  document.querySelector("#address").value = apartment.address;
  document.querySelector("#address").removeAttribute("aria-invalid");
  document.querySelector("#rent").value = apartment.rent || "";
  document.querySelector("#housing-type").value = apartment.housingType || "";
  setAddressError("");
}

// The alert mark lives inside the field, so this only writes the message. It is
// the single writer of #address-error.
function setAddressError(message) {
  document.querySelector("#address-error").textContent = message || "";
}

// A failed address search shakes the field once. The class comes off on a timer
// that outlasts the animation, so a later failure can play it again.
let shakeTimer;

function shakeField(field) {
  field.classList.add("is-shaking");
  clearTimeout(shakeTimer);
  shakeTimer = setTimeout(() => {
    field.classList.remove("is-shaking");
  }, 400);
}

// Mapbox returns "1234 West Roosevelt Road, Chicago, Illinois 60608, United
// States".
function shortLabel(label) {
  return String(label || "")
    .replace(/,\s*United States$/, "")
    .replace(/,?\s*Illinois\b/i, "");
}

function renderMatches() {
  const section = document.querySelector("#match-section");
  const list = document.querySelector("#match-list");
  const label = document.querySelector("#match-label");
  const exploreButton = document.querySelector("#explore-button");

  list.innerHTML = "";

  // No addresses found: hide the whole choice block.
  section.hidden = state.matches.length === 0;
  label.textContent =
    state.matches.length > 1 ? "Select the matching address" : "Address found";

  state.matches.forEach((match, index) => {
    const isSelected = match === state.match;

    const button = document.createElement("button");
    button.className = isSelected ? "match-option selected" : "match-option";
    button.dataset.action = "select-match";
    button.dataset.index = index;
    button.title = match.label;

    // The mark closes the chosen row; unselected rows are text only.
    const mark = isSelected ? icon("check-circle", 18) : "";
    button.innerHTML = `<span class="label">${escapeHtml(shortLabel(match.label))}</span>${mark}`;

    list.append(button);
  });

  // The next step only appears once an address is picked.
  exploreButton.hidden = !state.match;
}

function readForm() {
  const form = document.querySelector("#apartment-form");
  const data = new FormData(form);

  return {
    address: String(data.get("address") || "").trim(),
    rent: String(data.get("rent") || "").trim(),
    housingType: String(data.get("housingType") || ""),
  };
}

// Re-finding a saved address with the optional fields blank must not erase the
// rent, housing type, coordinates or visit decision already saved for it.
function mergeFormWithSaved(values) {
  const existingIndex = findApartmentIndex(values.address);

  if (existingIndex === -1) {
    return values;
  }

  const existing = state.apartments[existingIndex];
  return {
    ...existing,
    ...values,
    address: existing.address,
    rent: values.rent || existing.rent,
    housingType: values.housingType || existing.housingType,
  };
}

// The address Mapbox confirmed replaces the text that was typed, so the saved
// apartment carries the full street address instead of a fragment of it. The
// country and state are dropped: every match shares them. Rent and housing type
// come from the form untouched.
function confirmAddress(apartment, match) {
  if (!match) {
    return apartment;
  }

  const address = shortLabel(match.label);
  document.querySelector("#address").value = address;
  return { ...apartment, address };
}

let addressSearchController = null;

async function searchAddress(apartment) {
  addressSearchController?.abort();
  const controller = new AbortController();
  addressSearchController = controller;
  state.apartment = apartment;
  state.matches = [];
  state.match = null;
  renderMatches();

  const button = document.querySelector("#find-address");
  const address = document.querySelector("#address");
  const buttonMarkup = button.innerHTML;

  button.disabled = true;
  button.textContent = "Finding address...";
  setAddressError("");
  address.removeAttribute("aria-invalid");

  try {
    const matches = await findAddress(apartment.address, controller.signal);
    if (controller.signal.aborted) {
      return;
    }

    if (matches.length === 0) {
      address.setAttribute("aria-invalid", "true");
      setAddressError("No Chicago address found. Check the street address and try again.");
      address.focus();
      shakeField(address);
      return;
    }

    state.matches = matches;
    state.match = matches.length === 1 ? matches[0] : null;
    state.apartment = confirmAddress(apartment, state.match);
    if (state.match) {
      rememberApartment(state.apartment, state.match);
    }
    renderMatches();
    startMap();
  } catch (problem) {
    if (!controller.signal.aborted) {
      const message = problem instanceof TypeError
        ? "Unable to search for the address. Check your connection and try again."
        : problem.message;
      setAddressError(message);
    }
  } finally {
    if (addressSearchController === controller) {
      addressSearchController = null;
      button.disabled = false;
      button.innerHTML = buttonMarkup;
    }
  }
}

// Screen 3 - incidents near the apartment
function renderExplore() {
  const apartment = state.apartment;

  document.querySelector("#explore-address").textContent = apartment.address;

  // The place is added as soon as an address is confirmed, so this button now
  // records the visit decision. It stays available so the decision can change.
  const saveButton = document.querySelector("#save-button");
  saveButton.disabled = false;
  saveButton.title = "";
  document.querySelector("#save-button-label").textContent = "Visit decision";

  fillFilters();
  fillDataNotice();
  if (state.screen === "explore" && state.filters) {
    updateRecords();
  } else {
    renderRecords();
  }
}

function fillFilters() {
  const filters = state.filters;
  if (!filters) {
    return;
  }

  // Radius buttons: mark the current one as selected.
  const radiusButtons = document.querySelectorAll('[data-action="radius"]');
  radiusButtons.forEach((button) => {
    const isSelected = Number(button.dataset.radius) === filters.radius;
    button.classList.toggle("selected", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });

  syncDatePicker();

  // Category dropdown: build the options once, then just set the value.
  const select = document.querySelector("#category");
  if (select.options.length <= 1 && state.data) {
    state.data.categories.forEach((categoryName) => {
      const option = document.createElement("option");
      option.value = categoryName;
      option.textContent = titleCase(categoryName);
      select.append(option);
    });
  }
  select.value = filters.category;
}

function fillDataNotice() {
  document.querySelector(".data-notice").hidden = !state.data;
  const firstDay = state.data ? state.data.firstDay : "";
  const lastDay = state.data ? state.data.lastDay : "";

  document.querySelector("#data-first-day").textContent = formatDay(firstDay) || "…";
  document.querySelector("#data-last-day").textContent = formatDay(lastDay) || "…";
}

// Date range picker
const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// The month shown in the panel, and the first click of a range in progress.
let pickerMonth = null;
let pickerStart = "";

function isoDay(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

// "07/24/2026" from the stored ISO string, so no time zone gets involved.
function shortDate(iso) {
  const [year, month, day] = String(iso).split("-");
  return `${month}/${day}/${year}`;
}

function updateDateSummary() {
  const filters = state.filters;
  const summary = document.querySelector("#date-summary");

  if (!filters || !filters.startDay || !filters.endDay) {
    summary.textContent = "Select a date range";
    return;
  }

  summary.textContent = `${shortDate(filters.startDay)} - ${shortDate(filters.endDay)}`;
}

// Point the panel at the month holding the current start date, and drop any
// half-finished range left over from a previous open.
function syncDatePicker() {
  const filters = state.filters;
  const anchor = (filters && filters.startDay) || (state.data ? state.data.lastDay : "");
  const date = anchor ? new Date(`${anchor}T00:00:00`) : new Date();

  setPickerMonth(date.getFullYear(), date.getMonth());
  pickerStart = "";
  updateDateSummary();
}

function pickerBounds() {
  const first = state.data ? state.data.firstDay : "";
  const last = state.data ? state.data.lastDay : "";

  return {
    min: first ? new Date(`${first}T00:00:00`) : null,
    max: last ? new Date(`${last}T00:00:00`) : null,
  };
}

function monthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

// The calendar never leaves the months the snapshot actually covers, so it
// cannot park on a month where every day is disabled.
function setPickerMonth(year, month) {
  const { min, max } = pickerBounds();
  let next = new Date(year, month, 1);

  if (min && next < monthStart(min)) {
    next = monthStart(min);
  }
  if (max && next > monthStart(max)) {
    next = monthStart(max);
  }

  pickerMonth = next;
}

function fillPickerSelects() {
  const monthSelect = document.querySelector("#date-month");
  const yearSelect = document.querySelector("#date-year");

  if (monthSelect.options.length === 0) {
    monthNames.forEach((name, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = name;
      monthSelect.append(option);
    });
  }

  // The snapshot decides which years are reachable at all.
  const firstYear = state.data ? Number(state.data.firstDay.slice(0, 4)) : pickerMonth.getFullYear();
  const lastYear = state.data ? Number(state.data.lastDay.slice(0, 4)) : pickerMonth.getFullYear();

  if (yearSelect.options.length !== lastYear - firstYear + 1) {
    yearSelect.innerHTML = "";
    for (let year = firstYear; year <= lastYear; year += 1) {
      const option = document.createElement("option");
      option.value = String(year);
      option.textContent = String(year);
      yearSelect.append(option);
    }
  }

  monthSelect.value = String(pickerMonth.getMonth());
  yearSelect.value = String(pickerMonth.getFullYear());

  const { min, max } = pickerBounds();
  document.querySelector('[data-action="date-prev"]').disabled =
    Boolean(min) && pickerMonth <= monthStart(min);
  document.querySelector('[data-action="date-next"]').disabled =
    Boolean(max) && pickerMonth >= monthStart(max);
}

function renderDateGrid() {
  const grid = document.querySelector("#date-grid");
  const filters = state.filters;
  const min = state.data ? state.data.firstDay : "";
  const max = state.data ? state.data.lastDay : "";

  // While a range is being built, the first click is the only end we have.
  const start = pickerStart || (filters ? filters.startDay : "");
  const end = pickerStart ? "" : (filters ? filters.endDay : "");

  grid.innerHTML = "";

  const year = pickerMonth.getFullYear();
  const month = pickerMonth.getMonth();
  const leading = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let blank = 0; blank < leading; blank += 1) {
    const filler = document.createElement("span");
    filler.className = "date-blank";
    grid.append(filler);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = isoDay(new Date(year, month, day));
    const isStart = iso === start;
    const isEnd = iso === end;
    const isWithinRange = Boolean(start && end && iso > start && iso < end);
    let dateLabel = shortDate(iso);
    if (isStart && isEnd) {
      dateLabel += ", start and end date";
    } else if (isStart) {
      dateLabel += ", start date";
    } else if (isEnd) {
      dateLabel += ", end date";
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "date-day";
    button.dataset.action = "pick-day";
    button.dataset.day = iso;
    button.setAttribute("aria-label", dateLabel);
    button.setAttribute("aria-pressed", String(isStart || isEnd || isWithinRange));
    button.innerHTML = `<span>${day}</span>`;

    // Days outside the snapshot cannot be filtered to, so they are inert.
    button.disabled = Boolean((min && iso < min) || (max && iso > max));

    if (isStart || isEnd) {
      button.classList.add("is-selected");
    }
    if (isWithinRange) {
      button.classList.add("is-in-range");
    }
    if (start && end && isStart) {
      button.classList.add("is-range-start");
    }
    if (start && end && isEnd) {
      button.classList.add("is-range-end");
    }

    grid.append(button);
  }
}

function openDatePanel() {
  pickerStart = "";
  fillPickerSelects();
  renderDateGrid();

  const panel = document.querySelector("#date-panel");
  const trigger = document.querySelector("#date-toggle");
  panel.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  positionDatePanel(panel, trigger);
}

// The panel opens below the field unless there is not enough room, then above.
// The caret points at it either way.
function positionDatePanel(panel, trigger) {
  panel.classList.remove("is-above");
  trigger.classList.remove("is-above");

  const triggerBox = trigger.getBoundingClientRect();
  const panelHeight = panel.offsetHeight;
  const spaceBelow = window.innerHeight - triggerBox.bottom;
  const spaceAbove = triggerBox.top;
  const openAbove = spaceBelow < panelHeight + 12 && spaceAbove >= panelHeight + 12;

  panel.classList.toggle("is-above", openAbove);
  trigger.classList.toggle("is-above", openAbove);

  const panelBox = panel.getBoundingClientRect();
  panel.style.setProperty(
    "--picker-origin-x",
    `${triggerBox.left + triggerBox.width / 2 - panelBox.left}px`,
  );
  panel.style.setProperty("--picker-origin-y", openAbove ? `${panelBox.height}px` : "0px");
  panel.style.setProperty("--picker-enter-y", openAbove ? "4px" : "-4px");
}

function closeDatePanel() {
  const panel = document.querySelector("#date-panel");
  const trigger = document.querySelector("#date-toggle");
  panel.hidden = true;
  panel.classList.remove("is-above");
  panel.style.removeProperty("--picker-origin-x");
  panel.style.removeProperty("--picker-origin-y");
  panel.style.removeProperty("--picker-enter-y");
  trigger.setAttribute("aria-expanded", "false");
  trigger.classList.remove("is-above");
}

function shiftPickerMonth(step) {
  setPickerMonth(pickerMonth.getFullYear(), pickerMonth.getMonth() + step);
  fillPickerSelects();
  renderDateGrid();
}

// The first click sets one end, the second closes the range. Clicking earlier
// than the first click swaps them rather than making an inside-out range.
function pickDay(iso) {
  if (!pickerStart) {
    pickerStart = iso;
    renderDateGrid();

    // The grid was rebuilt, so put focus back on the day that was just picked.
    const picked = document.querySelector(`.date-day[data-day="${iso}"]`);
    if (picked) {
      picked.focus();
    }
    return;
  }

  state.filters.startDay = pickerStart < iso ? pickerStart : iso;
  state.filters.endDay = pickerStart < iso ? iso : pickerStart;
  pickerStart = "";

  updateDateSummary();
  updateRecords();
  closeDatePanel();
  document.querySelector("#date-toggle").focus();
}

// The incidents that pass the current radius, date and category filters.
function visibleRecords() {
  if (!state.data || !state.match || !state.filters) {
    return [];
  }
  return filterIncidents(state.data.incidents, state.match, state.filters);
}

// Only one block inside the records panel is visible at a time.
function showRecordsView(viewName) {
  const views = {
    loading: "#records-loading",
    error: "#records-error",
    range: "#records-range",
    none: "#records-none",
    list: "#records-list-view",
    detail: "#record-detail",
  };

  Object.entries(views).forEach(([name, selector]) => {
    document.querySelector(selector).hidden = name !== viewName;
  });
}

function renderRecords(records = visibleRecords()) {
  // Problems with the data come first: they replace the list completely.
  if (state.dataError) {
    document.querySelector("#records-error-message").textContent = state.dataError;
    showRecordsView("error");
    return;
  }

  if (!state.data || !state.filters) {
    showRecordsView("loading");
    return;
  }

  if (state.filters.startDay > state.filters.endDay) {
    showRecordsView("range");
    return;
  }

  if (records.length === 0) {
    showRecordsView("none");
    return;
  }

  const selected = records.find((incident) => incident.id === state.selectedId);

  if (selected) {
    fillRecordDetail(selected);
    showRecordsView("detail");
    return;
  }

  fillRecordList(records);
  showRecordsView("list");
}

function fillRecordList(records) {
  const list = document.querySelector("#record-list");
  const template = document.querySelector("#record-row-template");

  list.innerHTML = "";

  const noun = records.length === 1 ? "incident" : "incidents";
  document.querySelector("#records-heading").textContent =
    `${records.length.toLocaleString("en-US")} reported ${noun}`;

  const chevron = icon("chevron-right", 16);

  records.forEach((incident) => {
    const row = template.content.firstElementChild.cloneNode(true);

    row.dataset.id = incident.id;
    row.querySelector('[data-field="icon"]').innerHTML = incidentIcon(incident.category);
    row.querySelector('[data-field="category"]').textContent = titleCase(incident.category);
    row.querySelector('[data-field="block"]').textContent = titleCase(incident.block);

    const date = row.querySelector('[data-field="date"]');
    date.dateTime = incident.date.day;
    date.textContent = formatDay(incident.date.day, { month: "short", day: "numeric" });

    row.querySelector('[data-field="chevron"]').innerHTML = chevron;

    list.append(row);
  });
}

function fillRecordDetail(incident) {
  document.querySelector("#detail-icon").innerHTML = incidentIcon(incident.category);
  document.querySelector("#detail-category").textContent = titleCase(incident.category);
  document.querySelector("#detail-id").textContent = incident.id;
  document.querySelector("#detail-date").textContent = formatDay(incident.date.day, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  document.querySelector("#detail-block").textContent =
    titleCase(incident.block) || "Not available";
  document.querySelector("#detail-location").textContent =
    titleCase(incident.location) || "Not available";
  document.querySelector("#detail-description").textContent =
    incident.description || "Not available";
}

// Redraw the list and the markers without rebuilding the whole screen.
function updateRecords() {
  if (state.screen !== "explore" || !state.filters) {
    return;
  }

  const records = visibleRecords();

  // If the open record no longer matches the filters, close the detail view.
  const stillVisible = records.some((incident) => incident.id === state.selectedId);
  if (state.selectedId && !stillVisible) {
    state.selectedId = "";
  }

  renderRecords(records);

  if (state.map) {
    state.map.update({
      address: state.apartment ? state.apartment.address : "",
      radius: state.filters.radius,
      incidents: records,
      selectedId: state.selectedId,
    });
  }
}

// The map
function startMap() {
  if (state.map) {
    state.map.destroy();
    state.map = null;
  }

  if (state.screen === "overview" || state.screen === "compare") {
    return;
  }

  const isVerify = state.screen === "verify";
  const mapBox = document.querySelector(isVerify ? "#verify-map" : "#explore-map");

  state.map = createMap(mapBox, {
    center: state.match,
    address: state.apartment ? state.apartment.address : "",
    radius: state.filters ? state.filters.radius : undefined,
    onUpdating: isVerify ? undefined : (updating) => {
      document.querySelector("#map-update-status").hidden = !updating;
    },
    onSelect: (id) => {
      state.selectedId = id;
      updateRecords();
    },
  });

  if (state.screen === "explore" && state.data) {
    state.map.update({
      address: state.apartment ? state.apartment.address : "",
      radius: state.filters.radius,
      incidents: visibleRecords(),
      selectedId: state.selectedId,
    });
  }
}

// Screen 4 - compare all saved places
//
// Every place uses the same short window, radius and category filter, so the
// daily bars and totals can be read against each other. The full incident list
// stays on the place's own screen; this screen is the comparison.
const COMPARE_DAYS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
let compareToken = 0;

// Ten start dates for the 10-day window, one day apart.
function dayStarts(filters) {
  const firstDay = Date.parse(`${filters.startDay}T00:00:00Z`);
  const lastDay = Date.parse(`${filters.endDay}T00:00:00Z`);
  const starts = [];

  for (let offset = 0; firstDay + offset * DAY_MS <= lastDay; offset += 1) {
    starts.push(new Date(firstDay + offset * DAY_MS).toISOString().slice(0, 10));
  }

  return starts;
}

function dailyCounts(incidents, filters, starts) {
  const firstDay = Date.parse(`${filters.startDay}T00:00:00Z`);
  const counts = new Array(starts.length).fill(0);

  incidents.forEach((incident) => {
    const day = Date.parse(`${incident.date.day}T00:00:00Z`);
    const index = Math.floor((day - firstDay) / DAY_MS);
    if (index >= 0 && index < counts.length) {
      counts[index] += 1;
    }
  });

  return counts;
}

function categoryTotals(incidents) {
  const counts = new Map();

  incidents.forEach((incident) => {
    counts.set(incident.category, (counts.get(incident.category) || 0) + 1);
  });

  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((first, second) => {
      return second.count - first.count || first.category.localeCompare(second.category);
    });
}

function compareMeta(apartment) {
  const rent = apartment.rent
    ? formatRent(apartment.rent)
    : "Rent not added";
  const housing = apartment.housingType
    ? `<span>${escapeHtml(apartment.housingType)}</span>`
    : "";
  const decision = apartment.decision === "worth"
    ? `<span class="decision">${icon("worth-a-visit", 16)}<span>Worth a visit</span></span>`
    : '<span class="compare-decision-quiet">Still deciding</span>';

  return `<p class="compare-place-meta">${decision}<span>${rent}</span>${housing}</p>`;
}

// Bars are measured against the busiest day in any place, not against the
// place's own peak, so equal height means an equal number of incidents.
function compareBars(counts, maxDay, starts) {
  const bars = counts
    .map((count, index) => {
      const height = Math.max(3, Math.round((count / maxDay) * 44));
      const day = formatDay(starts[index], { month: "short", day: "numeric" });
      const noun = count === 1 ? "incident" : "incidents";
      return `<span class="compare-bar" style="height: ${height}px" title="${count} ${noun} on ${day}"></span>`;
    })
    .join("");

  // The bars are one image to assistive technology; its label carries the
  // exact daily counts, which the hover titles cannot reach from a keyboard.
  const total = counts.reduce((sum, count) => sum + count, 0);
  const peak = counts.length ? Math.max(...counts) : 0;
  const series = counts
    .map((count, index) => {
      const day = formatDay(starts[index], { month: "short", day: "numeric" });
      return `${day}: ${count}`;
    })
    .join(", ");
  const totalNoun = total === 1 ? "incident" : "incidents";
  const peakNoun = peak === 1 ? "incident" : "incidents";
  const label = `${total} ${totalNoun} across ${counts.length} days. Daily counts: ${series}. Busiest day: ${peak} ${peakNoun}.`;

  return `<div class="compare-bars" role="img" aria-label="${escapeHtml(label)}">${bars}</div>`;
}

function compareRecent(incidents) {
  return incidents
    .slice(0, 3)
    .map((incident) => {
      return `
        <li class="compare-record">
          <span class="crime-icon">${incidentIcon(incident.category)}</span>
          <span class="record-copy">
            <strong>${escapeHtml(titleCase(incident.category))}</strong>
            <span>${escapeHtml(titleCase(incident.block))}</span>
          </span>
          <time datetime="${incident.date.day}">${formatDay(incident.date.day, {
            month: "short",
            day: "numeric",
          })}</time>
        </li>
      `;
    })
    .join("");
}

function compareBand(place, starts, maxDay, filters) {
  const headingId = `compare-place-${place.index}`;
  const openButton = `
    <button class="text-button compare-open" data-action="open-compare-place" data-index="${place.index}">
      View all incidents
    </button>
  `;

  if (!place.location) {
    return `
      <article class="compare-band compare-band-broken" aria-labelledby="${headingId}">
        <div class="compare-place">
          <h3 id="${headingId}">${escapeHtml(place.apartment.address)}</h3>
          ${compareMeta(place.apartment)}
          ${openButton}
        </div>
        <p class="compare-band-error">We could not place this address. View its incidents to try again.</p>
      </article>
    `;
  }

  const top = categoryTotals(place.incidents).slice(0, 3);
  const topMarkup = top.length
    ? top
      .map(({ category, count }) => {
        return `<span>${escapeHtml(titleCase(category))} <strong>${count.toLocaleString("en-US")}</strong></span>`;
      })
      .join('<span class="compare-dot" aria-hidden="true">·</span>')
    : "No incidents in this window";

  const peak = place.days.length ? Math.max(...place.days) : 0;
  const peakNoun = peak === 1 ? "incident" : "incidents";
  const caption = peak > 0
    ? `Busiest day: ${peak.toLocaleString("en-US")} ${peakNoun}`
    : "No incidents in this window";

  const recentLabel = place.total > 0
    ? `${Math.min(3, place.total).toLocaleString("en-US")} newest of ${place.total.toLocaleString("en-US")}`
    : "No incidents";
  const recentMarkup = place.total > 0
    ? `<ul class="compare-records">${compareRecent(place.incidents)}</ul>`
    : '<p class="compare-empty-line">No incidents in this window.</p>';

  return `
    <article class="compare-band" aria-labelledby="${headingId}">
      <div class="compare-place">
        <h3 id="${headingId}">${escapeHtml(place.apartment.address)}</h3>
        ${compareMeta(place.apartment)}
        <p class="compare-total">
          <strong>${place.total.toLocaleString("en-US")}</strong>
          <span>${place.total === 1 ? "incident" : "incidents"} in ${starts.length} days</span>
        </p>
        <p class="compare-top">${topMarkup}</p>
        ${openButton}
      </div>

      <div class="compare-days">
        ${compareBars(place.days, maxDay, starts)}
        <div class="compare-axis" aria-hidden="true">
          <span>${formatDay(filters.startDay, { month: "short", day: "numeric" })}</span>
          <span>${formatDay(filters.endDay, { month: "short", day: "numeric" })}</span>
        </div>
        <p class="compare-caption">${caption}</p>
      </div>

      <div class="compare-recent">
        <p class="compare-label">${recentLabel}</p>
        ${recentMarkup}
      </div>
    </article>
  `;
}

function compareMarkup(places, filters, starts, maxDay) {
  const bands = places
    .map((place) => compareBand(place, starts, maxDay, filters))
    .join("");

  return `
    <section class="compare-panel" aria-labelledby="compare-panel-title">
      <!-- The visible title is the page heading above; this keeps the section
           named without repeating the title and description. -->
      <h2 id="compare-panel-title" class="sr-only">Chicago Places, one after another</h2>

      <div class="compare-band-head" aria-hidden="true">
        <span>Chicago Place</span>
        <span>Daily incidents</span>
        <span>Newest incidents</span>
      </div>

      ${bands}
    </section>
  `;
}

// A saved place with coordinates is ready to compare. An older saved item
// without them is geocoded once; the result is kept in the session cache and
// written back to the saved list.
async function locateApartment(apartment) {
  if (hasLocation(apartment)) {
    return {
      label: apartment.address,
      latitude: apartment.latitude,
      longitude: apartment.longitude,
    };
  }

  const addressKey = normalizeAddress(apartment.address);
  const cached = savedLocations.get(addressKey);
  if (cached) {
    return cached;
  }

  const matches = await findAddress(apartment.address);
  if (matches.length === 0) {
    return null;
  }

  const exact = matches.find((match) => {
    return normalizeAddress(shortLabel(match.label)) === addressKey;
  });
  const match = exact || matches[0];
  savedLocations.set(addressKey, match);
  return match;
}

async function collectCompareEntries() {
  // Same order as the shortlist: worth a visit first, then lowest rent. The
  // saved index still travels with each entry so its action finds the place.
  const entries = orderForShortlist(state.apartments).map(({ apartment, index }) => {
    return { apartment, index };
  });

  let changed = false;

  await Promise.all(entries.map(async (entry) => {
    try {
      const location = await locateApartment(entry.apartment);
      entry.location = location;

      if (location && !hasLocation(entry.apartment)) {
        entry.apartment.latitude = location.latitude;
        entry.apartment.longitude = location.longitude;
        changed = true;
      }
    } catch {
      entry.location = null;
    }
  }));

  if (changed) {
    persistApartments();
    renderOverview();
  }

  return entries;
}

// "Jul 24-Oct 21, 2026". The end month is dropped inside one month so the
// compare subtitle stays short.
function formatWindowRange(filters) {
  const startDay = formatDay(filters.startDay, { month: "short", day: "numeric" });
  const sameMonth = filters.startDay.slice(5, 7) === filters.endDay.slice(5, 7);
  const endDay = sameMonth
    ? formatDay(filters.endDay, { day: "numeric" })
    : formatDay(filters.endDay, { month: "short", day: "numeric" });
  const year = formatDay(filters.endDay, { year: "numeric" });
  return `${startDay}-${endDay}, ${year}`;
}

async function renderCompare() {
  const token = ++compareToken;
  const body = document.querySelector("#compare-body");
  const windowLabel = document.querySelector("#compare-window");
  const windowRow = windowLabel.closest(".heading-subtitle");
  const hasPlaces = state.apartments.length > 0;
  const loadingMarkup = `
    <section class="form-panel compare-message">
      <h2>Loading incidents</h2>
      <p>Reading the supplied incident snapshot for each saved Chicago Place.</p>
    </section>
  `;
  const locatingMarkup = `
    <section class="form-panel compare-message">
      <h2>Locating saved places</h2>
      <p>Finding coordinates for saved places that were added before locations were stored.</p>
    </section>
  `;
  // The subtitle describes the comparison window. With no places there is
  // nothing to describe; the empty state below carries that message instead.
  windowRow.hidden = !hasPlaces;
  windowLabel.textContent = hasPlaces ? "Loading incidents" : "";

  if (state.dataError) {
    windowLabel.textContent = "Unable to load incidents";
    body.innerHTML = `
      <section class="form-panel compare-message">
        <h2>Unable to load incidents</h2>
        <p>${escapeHtml(state.dataError)}</p>
      </section>
    `;
    return;
  }

  if (!state.data) {
    body.innerHTML = loadingMarkup;
    return;
  }

  if (state.apartments.length === 0) {
    windowRow.hidden = true;
    windowLabel.textContent = "";
    body.innerHTML = `
      <section class="empty-overview">
        <h2>No Chicago Places to compare yet</h2>
        <p>Add a Chicago Place you are considering to see its reported incidents here.</p>
        <button class="button primary" data-action="add">
          ${icon("add-apartment", 18)}
          Add Chicago Place
        </button>
      </section>
    `;
    return;
  }

  const needsLocation = state.apartments.some((apartment) => !hasLocation(apartment));
  if (needsLocation) {
    windowLabel.textContent = "Locating saved places";
    body.innerHTML = locatingMarkup;
  } else {
    body.innerHTML = "";
  }

  const entries = await collectCompareEntries();
  if (token !== compareToken || state.screen !== "compare") {
    return;
  }

  const filters = filtersForDays(state.data.lastDay, COMPARE_DAYS);
  const starts = dayStarts(filters);
  const places = entries.map((entry) => {
    if (!entry.location) {
      return { ...entry, incidents: [], total: 0, days: [] };
    }

    const incidents = filterIncidents(state.data.incidents, entry.location, filters);
    return {
      ...entry,
      incidents,
      total: incidents.length,
      days: dailyCounts(incidents, filters, starts),
    };
  });

  const maxDay = Math.max(
    1,
    ...places.map((place) => {
      return place.days.length ? Math.max(...place.days) : 0;
    }),
  );

  windowLabel.textContent = `${formatWindowRange(filters)} · ${filters.radius} mi`;

  body.innerHTML = compareMarkup(places, filters, starts, maxDay);
}

// Dialogs
let pendingDeleteIndex = -1;
// Where the card sat in the list, so focus can move to the card that takes its
// place after the list is ordered again.
let pendingDeletePosition = -1;

function setDialogOrigin(dialog, trigger) {
  if (!trigger) {
    dialog.style.removeProperty("--dialog-origin-x");
    dialog.style.removeProperty("--dialog-origin-y");
    return;
  }

  const dialogBox = dialog.getBoundingClientRect();
  const triggerBox = trigger.getBoundingClientRect();
  dialog.style.setProperty(
    "--dialog-origin-x",
    `${triggerBox.left + triggerBox.width / 2 - dialogBox.left}px`,
  );
  dialog.style.setProperty(
    "--dialog-origin-y",
    `${triggerBox.top + triggerBox.height / 2 - dialogBox.top}px`,
  );
}

function openSaveDialog(trigger) {
  if (!state.apartment) {
    return;
  }

  document.querySelector("#save-dialog-address").textContent = state.apartment.address;

  const rent = document.querySelector("#save-dialog-rent");
  rent.textContent = formatRent(state.apartment.rent);
  rent.hidden = !rent.textContent;

  document.querySelector("#save-dialog").showModal();
  setDialogOrigin(document.querySelector("#save-dialog"), trigger);
}

function openDeleteDialog(index, position, trigger) {
  const apartment = state.apartments[index];
  if (!apartment) {
    return;
  }

  pendingDeleteIndex = index;
  pendingDeletePosition = position;
  document.querySelector("#delete-dialog-address").textContent = apartment.address;
  const dialog = document.querySelector("#delete-dialog");
  dialog.showModal();
  setDialogOrigin(dialog, trigger);
}

// Opens a saved place's incident screen. A place with saved coordinates needs
// no network call; older saved items geocode once and keep the result.
async function openApartment(index, trigger) {
  const apartment = state.apartments[index];
  if (!apartment) {
    return;
  }

  const addressKey = normalizeAddress(apartment.address);
  addressSearchController?.abort();
  const controller = new AbortController();
  addressSearchController = controller;
  state.toast = "";
  if (trigger) {
    trigger.disabled = true;
  }

  let matches = [];
  try {
    const cachedMatch = savedLocations.get(addressKey);
    if (cachedMatch) {
      matches = [cachedMatch];
    } else if (hasLocation(apartment)) {
      matches = [{
        label: apartment.address,
        latitude: apartment.latitude,
        longitude: apartment.longitude,
      }];
    } else {
      matches = await findAddress(apartment.address, controller.signal);
    }
  } catch {
    if (controller.signal.aborted) {
      return;
    }
  } finally {
    if (trigger) {
      trigger.disabled = false;
    }
    if (addressSearchController === controller) {
      addressSearchController = null;
    }
  }
  if (controller.signal.aborted) {
    return;
  }

  state.apartment = apartment;

  if (matches.length > 1) {
    const exactMatches = matches.filter((match) => {
      return normalizeAddress(shortLabel(match.label)) === addressKey;
    });
    if (exactMatches.length === 1) {
      matches = exactMatches;
    }
  }

  if (matches.length === 1) {
    state.match = matches[0];
    savedLocations.set(addressKey, state.match);

    if (!hasLocation(apartment)) {
      apartment.latitude = state.match.latitude;
      apartment.longitude = state.match.longitude;
      persistApartments();
    }

    state.selectedId = "";
    state.filters = placeIncidentFilters(
      apartment,
      defaultFilters(state.data ? state.data.lastDay : ""),
    );
    renderExplore();
    showScreen("explore");
  } else {
    state.matches = [];
    state.match = null;
    renderVerify();
    showScreen("verify");
    await searchAddress(apartment);
  }
}

document.addEventListener("click", (event) => {
  document.documentElement.classList.toggle("pointer-input", event.detail > 0);
}, { capture: true });

document.addEventListener("keydown", () => {
  document.documentElement.classList.remove("pointer-input");
}, { capture: true });

// Click handling
//
// Every button you see carries a data-action attribute. One listener
// reads it and decides what to do.
document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) {
    return;
  }

  const action = button.dataset.action;

  if (action === "overview") {
    state.toast = "";
    renderOverview();
    showScreen("overview");
    return;
  }

  if (action === "compare") {
    state.toast = "";
    showScreen("compare");
    return;
  }

  if (action === "add") {
    state.apartment = null;
    state.matches = [];
    state.match = null;
    state.toast = "";
    renderVerify();
    showScreen("verify");
    return;
  }

  if (action === "open-apartment" || action === "open-compare-place") {
    await openApartment(Number(button.dataset.index), button);
    return;
  }

  if (action === "select-match") {
    state.match = state.matches[Number(button.dataset.index)];
    state.apartment = confirmAddress(readForm(), state.match);
    if (state.match) {
      rememberApartment(state.apartment, state.match);
    }
    renderMatches();
    startMap(); // recentre the map on the address that was picked
    return;
  }

  if (action === "explore") {
    state.apartment = mergeFormWithSaved(readForm());
    state.selectedId = "";
    state.toast = "";
    state.filters = placeIncidentFilters(
      state.apartment,
      defaultFilters(state.data ? state.data.lastDay : ""),
    );
    renderExplore();
    showScreen("explore");
    return;
  }

  if (action === "radius") {
    if (state.filters.radius === Number(button.dataset.radius)) return;
    state.filters.radius = Number(button.dataset.radius);
    state.map?.beginUpdate();
    fillFilters();
    updateRecords();
    return;
  }

  if (action === "reset") {
    state.filters = defaultFilters(state.data ? state.data.lastDay : "");
    state.selectedId = "";
    fillFilters();
    updateRecords();
    return;
  }

  if (action === "toggle-dates") {
    if (document.querySelector("#date-panel").hidden) {
      openDatePanel();
    } else {
      closeDatePanel();
    }
    return;
  }

  if (action === "date-prev" || action === "date-next") {
    shiftPickerMonth(action === "date-next" ? 1 : -1);
    return;
  }

  if (action === "pick-day") {
    pickDay(button.dataset.day);
    return;
  }

  if (action === "select-incident") {
    state.selectedId = button.dataset.id;
    updateRecords();
    document.querySelector('[data-action="back-to-records"]').focus();
    return;
  }

  if (action === "back-to-records") {
    const selectedId = state.selectedId;
    state.selectedId = "";
    updateRecords();
    const rows = document.querySelectorAll(".record-row");
    const selectedRow = Array.from(rows).find((row) => row.dataset.id === selectedId);
    selectedRow?.focus();
    return;
  }

  if (action === "save-dialog") {
    openSaveDialog(button);
    return;
  }

  if (action === "delete-apartment") {
    // The card's position in the list and its position in state.apartments are
    // not the same number: the list is ordered, the saved array is not.
    const card = button.closest(".apartment-card");
    const cards = Array.from(document.querySelectorAll(".apartment-card"));
    closeCardTray();
    openDeleteDialog(Number(button.dataset.index), cards.indexOf(card), button);
    return;
  }

  if (action === "sheet-delete" && trayCard) {
    const card = trayCard;
    const cards = Array.from(document.querySelectorAll(".apartment-card"));
    const index = Number(card.querySelector('[data-action="delete-apartment"]').dataset.index);
    closeCardTray({ immediate: true });
    openDeleteDialog(index, cards.indexOf(card), button);
    return;
  }

  if (action === "close-dialog") {
    button.closest("dialog").close();
    return;
  }

  if (action === "save") {
    saveApartment(button.dataset.decision);
    return;
  }

  if (action === "confirm-delete") {
    deleteApartment();
    return;
  }
});

// Long press on a phone
//
// Holding a card still opens its action tray, which slides the delete button
// up from the card's bottom edge. Nothing happens until the hold completes, so
// a scroll, a drag or a quick tap must cancel the timer instead of leaving a
// tray behind. Desktop keeps the button visible in the row, so the mouse is
// ignored here; the contextmenu event covers right click, the Menu key and
// Shift+F10.
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 10;
const phoneScreen = window.matchMedia("(max-width: 560px)");

let holdTimer = 0;
let holdCard = null;
let holdStart = null;
let trayCard = null;

const cardSheet = document.querySelector("#card-sheet");
const cardSheetDelete = cardSheet.querySelector('[data-action="sheet-delete"]');
const sheetExitMs = 500;

let sheetDrag = null;

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function openCardTray(card) {
  if (!card || card === trayCard || !phoneScreen.matches) {
    return;
  }
  closeCardTray({ immediate: true });
  card.classList.add("is-tray-open");
  trayCard = card;

  const source = card.querySelector('[data-action="delete-apartment"]');
  cardSheetDelete.innerHTML = icon("trash-2");
  cardSheetDelete.setAttribute("aria-label", source.getAttribute("aria-label"));

  cardSheet.classList.remove("is-closing");
  cardSheet.showModal();
  cardSheetDelete.focus({ preventScroll: true });
}

// The dialog would disappear in a single frame, so it stays open until the
// slide down has finished and only then closes.
function closeCardTray({ immediate = false, restoreFocus = false } = {}) {
  const card = trayCard;
  if (!card) {
    return;
  }

  trayCard = null;
  card.classList.remove("is-tray-open");
  sheetDrag = null;
  cardSheet.classList.remove("is-dragging");

  if (!cardSheet.open) {
    return;
  }

  const finish = () => {
    cardSheet.classList.remove("is-closing");
    cardSheet.close();
    cardSheet.style.removeProperty("transform");
    cardSheet.style.removeProperty("--sheet-drag");
    if (restoreFocus) {
      card.focus({ preventScroll: true });
    }
  };

  if (immediate || reducedMotion()) {
    finish();
    return;
  }

  cardSheet.classList.add("is-closing");

  let settled = false;
  const settle = () => {
    if (settled) {
      return;
    }
    settled = true;
    cardSheet.removeEventListener("transitionend", onEnd);
    clearTimeout(fallback);
    finish();
  };
  const onEnd = (event) => {
    if (event.target === cardSheet && event.propertyName === "transform") {
      settle();
    }
  };
  const fallback = setTimeout(settle, sheetExitMs + 100);
  cardSheet.addEventListener("transitionend", onEnd);
}

// Drag to dismiss
//
// The sheet follows the finger 1:1 with no easing, then the same curve carries
// it from wherever it was released. Passing 40% of its height, or letting go
// faster than 500px/s, dismisses it.
cardSheet.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" || !cardSheet.open || reducedMotion()) {
    return;
  }
  if (event.target.closest("button")) {
    return;
  }

  sheetDrag = {
    id: event.pointerId,
    startY: event.clientY,
    lastY: event.clientY,
    lastTime: event.timeStamp,
    velocity: 0,
    travel: 0,
    height: cardSheet.getBoundingClientRect().height,
  };
  cardSheet.classList.add("is-dragging");
  // Capture keeps the drag alive once the finger leaves the sheet, which it
  // does on the way up. A pointer that is already gone cannot be captured.
  try {
    cardSheet.setPointerCapture(event.pointerId);
  } catch {
    cardSheet.classList.remove("is-dragging");
    sheetDrag = null;
  }
});

cardSheet.addEventListener("pointermove", (event) => {
  if (!sheetDrag || event.pointerId !== sheetDrag.id) {
    return;
  }

  const distance = event.clientY - sheetDrag.startY;
  // Down follows the finger; up gives way at a fifth of the distance, so the
  // edge reads as attached instead of loose.
  const travel = distance >= 0 ? distance : distance * 0.2;

  const elapsed = event.timeStamp - sheetDrag.lastTime;
  if (elapsed > 0) {
    sheetDrag.velocity = (event.clientY - sheetDrag.lastY) / elapsed;
  }
  sheetDrag.lastY = event.clientY;
  sheetDrag.lastTime = event.timeStamp;
  sheetDrag.travel = travel;

  cardSheet.style.transform = `translateY(${travel}px)`;
  cardSheet.style.setProperty(
    "--sheet-drag",
    String(Math.min(Math.max(travel / sheetDrag.height, 0), 1)),
  );
});

function endSheetDrag() {
  if (!sheetDrag) {
    return;
  }

  const grab = sheetDrag;
  sheetDrag = null;
  cardSheet.classList.remove("is-dragging");
  const dismissed = grab.travel > grab.height * 0.4 || grab.velocity > 0.5;

  // Keep the released offset for one frame so the curve has a start value
  // instead of jumping to the open position first.
  requestAnimationFrame(() => {
    cardSheet.style.removeProperty("transform");
    cardSheet.style.removeProperty("--sheet-drag");
    if (dismissed) {
      closeCardTray({ restoreFocus: true });
    }
  });
}

cardSheet.addEventListener("pointerup", endSheetDrag);
cardSheet.addEventListener("pointercancel", endSheetDrag);

cardSheet.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeCardTray({ restoreFocus: true });
});

// Escape also closes the sheet from the keyboard. The cancel event above covers
// browsers that report it, but not every one does, so the key is handled here.
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !trayCard) {
    return;
  }
  closeCardTray({ restoreFocus: true });
});

cardSheet.addEventListener("click", (event) => {
  // A tap on the backdrop lands on the dialog itself, a tap inside it does not.
  if (event.target !== cardSheet) {
    return;
  }
  if (event.clientY < cardSheet.getBoundingClientRect().top) {
    closeCardTray({ restoreFocus: true });
  }
});

function cancelCardHold() {
  clearTimeout(holdTimer);
  holdTimer = 0;
  holdCard?.classList.remove("is-holding");
  holdCard = null;
  holdStart = null;
}

document.addEventListener("pointerdown", (event) => {
  const card = event.target.closest?.(".apartment-card") || null;

  // A press anywhere else closes whichever tray is open.
  if (card !== trayCard && !event.target.closest?.("#card-sheet")) {
    closeCardTray();
  }

  if (event.pointerType === "mouse" || !card || !phoneScreen.matches) {
    return;
  }

  // Pressing a control is a click, not the start of a hold.
  if (event.target.closest("button, a, input, select, textarea")) {
    return;
  }

  cancelCardHold();
  holdCard = card;
  holdStart = { x: event.clientX, y: event.clientY };
  card.classList.add("is-holding");

  holdTimer = setTimeout(() => {
    const held = holdCard;
    cancelCardHold();
    openCardTray(held);
  }, LONG_PRESS_MS);
}, { capture: true });

document.addEventListener("pointermove", (event) => {
  if (!holdCard || !holdStart) {
    return;
  }
  const movedX = event.clientX - holdStart.x;
  const movedY = event.clientY - holdStart.y;
  if (movedX * movedX + movedY * movedY > LONG_PRESS_SLOP * LONG_PRESS_SLOP) {
    cancelCardHold();
  }
}, { capture: true });

document.addEventListener("pointerup", cancelCardHold, { capture: true });
document.addEventListener("pointercancel", cancelCardHold, { capture: true });

// Scrolling moves the card, so the hold no longer refers to what the finger is
// over, and an open tray would scroll away from its card.
document.addEventListener("scroll", () => {
  cancelCardHold();
  closeCardTray();
}, { capture: true, passive: true });

document.addEventListener("contextmenu", (event) => {
  const card = event.target.closest?.(".apartment-card") || null;
  if (!card || !phoneScreen.matches) {
    return;
  }
  event.preventDefault();
  cancelCardHold();
  openCardTray(card);
});

function saveApartment(decision) {
  const previous = [...state.apartments];
  const existingIndex = findApartmentIndex(state.apartment.address);
  const existing = existingIndex === -1 ? null : state.apartments[existingIndex];

  // The place is normally already on the list. Keep the coordinates it was
  // added with, then let a fresh match win if one exists. The date range and
  // radius are saved with the decision; the category stays a view filter.
  const filterSelection = decisionFilters(state.filters) || existing?.filters || null;
  const apartment = {
    ...state.apartment,
    ...(existing ? { address: existing.address } : {}),
    ...(existing && hasLocation(existing)
      ? { latitude: existing.latitude, longitude: existing.longitude }
      : {}),
    ...(state.match
      ? { latitude: state.match.latitude, longitude: state.match.longitude }
      : {}),
    decision,
    ...(filterSelection ? { filters: filterSelection } : {}),
  };

  if (state.match) {
    savedLocations.set(normalizeAddress(apartment.address), state.match);
  }

  if (existingIndex === -1) {
    state.apartments.push(apartment);
  } else {
    state.apartments[existingIndex] = apartment;
  }

  const saved = persistApartments();
  if (saved) {
    state.toast =
      decision === "worth"
        ? "Marked as worth a visit"
        : "Still deciding";
  } else {
    state.apartments = previous;
  }

  document.querySelector("#save-dialog").close();
  renderExplore();
  renderOverview();
  showScreen("explore");
  if (saved) {
    hideToastLater();
    document.querySelector('[data-action="radius"][aria-pressed="true"]').focus();
  }
}

function deleteApartment() {
  const deletedPosition = pendingDeletePosition;
  const previous = [...state.apartments];

  state.apartments.splice(pendingDeleteIndex, 1);
  pendingDeleteIndex = -1;
  pendingDeletePosition = -1;
  state.toast = "";

  if (!persistApartments()) {
    state.apartments = previous;
  }

  document.querySelector("#delete-dialog").close();
  renderOverview();
  showScreen("overview");

  const apartmentButtons = document.querySelectorAll('.apartment-card [data-action="open-apartment"]');
  const nextApartment = apartmentButtons[Math.min(deletedPosition, apartmentButtons.length - 1)];
  const emptyAction = document.querySelector('#overview-empty [data-action="add"]');
  (nextApartment || emptyAction).focus();
}

// Form handling on the verify screen
document.addEventListener("submit", (event) => {
  if (event.target.id !== "apartment-form") {
    return;
  }

  event.preventDefault();

  const apartment = readForm();
  if (apartment.address) {
    searchAddress(apartment);
  }
});

// The date panel closes on a click anywhere outside it, or on Escape.
document.addEventListener("click", (event) => {
  const panel = document.querySelector("#date-panel");
  if (!panel || panel.hidden) {
    return;
  }

  // Each pick rebuilds the grid, which detaches the clicked button; the path
  // captured at dispatch time is the reliable way to tell inside from outside.
  const wrap = document.querySelector(".date-control-wrap");
  if (event.composedPath().includes(wrap)) {
    return;
  }

  closeDatePanel();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  const panel = document.querySelector("#date-panel");
  if (panel && !panel.hidden) {
    closeDatePanel();
    document.querySelector("#date-toggle").focus();
  }
});

// Typing a new address throws away the matches from the old one.
document.addEventListener("input", (event) => {
  if (event.target.id !== "address") {
    return;
  }
  addressSearchController?.abort();
  event.target.removeAttribute("aria-invalid");
  setAddressError("");
  if (!state.match && state.matches.length === 0) {
    return;
  }

  state.match = null;
  state.matches = [];
  renderMatches();
});

// The three filter controls on the explore screen.
document.addEventListener("change", (event) => {
  if (state.screen !== "explore" || !state.filters) {
    return;
  }

  // Month and year only move the calendar; they change no filter on their own.
  if (event.target.id === "date-month" || event.target.id === "date-year") {
    setPickerMonth(
      Number(document.querySelector("#date-year").value),
      Number(document.querySelector("#date-month").value),
    );
    fillPickerSelects();
    renderDateGrid();
    return;
  }

  if (event.target.id === "category") {
    state.filters.category = event.target.value;
  }

  updateRecords();
});

// Start the app, then load the incident snapshot
fillIconSlots();
renderOverview();
showScreen("overview");

Papa.parse(new URL(csvUrl, window.location.href).href, {
  download: true,
  header: true,
  worker: true,
  skipEmptyLines: true,

  complete: (result) => {
    // A failed download still calls complete, with no rows and no fields.
    // The error handler below has already reported it.
    if (!result?.data) {
      return;
    }

    const required = ["ID", "Date", "Primary Type", "Latitude", "Longitude"];
    const fields = result.meta.fields || [];

    const missingFields = required.filter((field) => {
      return !fields.includes(field);
    });

    if (missingFields.length > 0) {
      state.dataError = "The crime data is missing required fields. Check the data file and reload the page.";
    } else {
      const data = prepareIncidents(result.data, categories);
      if (!data.hasUsableIncidents) {
        state.dataError = "The crime data has no usable incident records. Check the data file and reload the page.";
      } else {
        state.data = data;
        const pendingFilters = state.screen === "explore" ? state.filters : null;
        state.filters = defaultFilters(state.data.lastDay);
        if (pendingFilters) {
          state.filters.radius = pendingFilters.radius;
          if (pendingFilters.startDay && pendingFilters.endDay) {
            state.filters.startDay = pendingFilters.startDay;
            state.filters.endDay = pendingFilters.endDay;
          }
        }
      }
    }

    // Both the overview cards and the compare bands need the parsed incidents.
    renderOverview();
    if (state.screen === "explore") {
      renderExplore();
    }
    if (state.screen === "compare") {
      renderCompare();
    }
  },

  error: () => {
    state.dataError = "Check that the crime data file is available and reload the page.";
    if (state.screen === "explore") {
      renderExplore();
    }
    if (state.screen === "compare") {
      renderCompare();
    }
  },
});
