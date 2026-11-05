import Papa from "papaparse";
import csvUrl from "../Crimes_20261029.csv?url";
import {
  defaultFilters,
  filterIncidents,
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
};

const navOverview = document.querySelector("#nav-overview");
const navAdd = document.querySelector("#nav-add");

const toast = document.querySelector("#toast");
const toastMessage = document.querySelector("#toast-message");
let toastTimer;

// The state of the app
//
// This is the only place that remembers what the user is doing.
const storageKey = "chistay-apartments-v1";

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
    return saved.filter((item) => {
      return item && typeof item.address === "string";
    });
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

  markNav(navOverview, name === "overview");
  markNav(navAdd, name === "verify" || name === "explore");

  showToast(state.toast);
  startMap();

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

  card.querySelector('[data-field="address"]').textContent = apartment.address;

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

  const alreadySaved = state.apartments.some((saved) => {
    return saved.address.toLowerCase() === apartment.address.toLowerCase();
  });

  document.querySelector("#explore-address").textContent = apartment.address;

  // A saved apartment has nothing left to save, so the button reports that
  // instead of offering to save it again.
  const saveButton = document.querySelector("#save-button");
  saveButton.disabled = alreadySaved;
  saveButton.title = alreadySaved ? "This apartment is already saved" : "";
  document.querySelector("#save-button-label").textContent = alreadySaved
    ? "Saved"
    : "Save apartment";

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

  document.querySelector("#date-panel").hidden = false;
  document.querySelector("#date-toggle").setAttribute("aria-expanded", "true");
}

function closeDatePanel() {
  document.querySelector("#date-panel").hidden = true;
  document.querySelector("#date-toggle").setAttribute("aria-expanded", "false");
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

function renderRecords() {
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

  const records = visibleRecords();

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

  renderRecords();

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

  if (state.screen === "overview") {
    return;
  }

  const isVerify = state.screen === "verify";
  const mapBox = document.querySelector(isVerify ? "#verify-map" : "#explore-map");

  state.map = createMap(mapBox, {
    center: state.match,
    address: state.apartment ? state.apartment.address : "",
    radius: state.filters ? state.filters.radius : undefined,
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

// Dialogs
let pendingDeleteIndex = -1;
// Where the card sat in the list, so focus can move to the card that takes its
// place after the list is ordered again.
let pendingDeletePosition = -1;

function openSaveDialog() {
  if (!state.apartment) {
    return;
  }

  document.querySelector("#save-dialog-address").textContent = state.apartment.address;

  const rent = document.querySelector("#save-dialog-rent");
  rent.textContent = formatRent(state.apartment.rent);
  rent.hidden = !rent.textContent;

  document.querySelector("#save-dialog").showModal();
}

function openDeleteDialog(index, position) {
  const apartment = state.apartments[index];
  if (!apartment) {
    return;
  }

  pendingDeleteIndex = index;
  pendingDeletePosition = position;
  document.querySelector("#delete-dialog-address").textContent = apartment.address;
  document.querySelector("#delete-dialog").showModal();
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

  if (action === "add") {
    state.apartment = null;
    state.matches = [];
    state.match = null;
    state.toast = "";
    renderVerify();
    showScreen("verify");
    return;
  }

  if (action === "open-apartment") {
    state.apartment = state.apartments[Number(button.dataset.index)];
    state.matches = [];
    state.match = null;
    state.toast = "";
    renderVerify();
    showScreen("verify");
    await searchAddress(state.apartment);
    return;
  }

  if (action === "select-match") {
    state.match = state.matches[Number(button.dataset.index)];
    state.apartment = confirmAddress(readForm(), state.match);
    renderMatches();
    startMap(); // recentre the map on the address that was picked
    return;
  }

  if (action === "explore") {
    state.apartment = readForm();
    state.selectedId = "";
    state.filters = defaultFilters(state.data ? state.data.lastDay : "");
    renderExplore();
    showScreen("explore");
    return;
  }

  if (action === "radius") {
    state.filters.radius = Number(button.dataset.radius);
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
    openSaveDialog();
    return;
  }

  if (action === "delete-apartment") {
    // The card's position in the list and its position in state.apartments are
    // not the same number: the list is ordered, the saved array is not.
    const card = button.closest(".apartment-card");
    const cards = Array.from(document.querySelectorAll(".apartment-card"));
    openDeleteDialog(Number(button.dataset.index), cards.indexOf(card));
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

function saveApartment(decision) {
  const previous = [...state.apartments];
  const apartment = { ...state.apartment, decision };

  const existingIndex = state.apartments.findIndex((saved) => {
    return saved.address.toLowerCase() === apartment.address.toLowerCase();
  });

  if (existingIndex === -1) {
    state.apartments.push(apartment);
  } else {
    state.apartments[existingIndex] = apartment;
  }

  const saved = persistApartments();
  if (saved) {
    state.toast =
      decision === "worth"
        ? "Apartment saved as worth a visit"
        : "Apartment saved";
  } else {
    state.apartments = previous;
  }

  document.querySelector("#save-dialog").close();
  renderExplore();
  showScreen("explore");
  if (saved) {
    toastTimer = setTimeout(() => {
      state.toast = "";
      toast.classList.add("is-expiring");
      toast.hidden = true;
    }, 5000);
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

    if (state.screen === "explore") {
      renderExplore();
    }
  },

  error: () => {
    state.dataError = "Check that the crime data file is available and reload the page.";
    if (state.screen === "explore") {
      renderExplore();
    }
  },
});
