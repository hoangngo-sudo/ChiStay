import mapboxgl from "mapbox-gl";
import circle from "@turf/circle";
import "mapbox-gl/dist/mapbox-gl.css";
import campusIcon from "./assets/paper/uic.svg";
import { incidentIcons, stackMarkerIcon } from "./assets.js";
import { formatDay, titleCase } from "./data.mjs";
import {
  TRANSITION_MS,
  buildClusters,
  frameAt,
  isMoving,
  nodeRadius,
  planTransition,
  settle,
} from "./clusters.js";

// How far the zoom has to move before the badges are regrouped. Small enough
// that a scroll-wheel zoom is followed step by step instead of after it ends.
const ZOOM_STEP = 0.08;

// A click on a numbered cluster zooms in by at most this many levels, up to the
// limit. At the limit nothing more can separate, so the click lists the reports.
const CLUSTER_ZOOM_STEP = 3;
const CLUSTER_ZOOM_LIMIT = 19;

const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN || "";
// The Quad, longitude first (Mapbox order).
const CAMPUS = [-87.64925761348732, 41.871897221206616];

// Mapbox paint values cannot read CSS variables, so this mirrors --primary in
// style.css. The incident badges are DOM, styled from the tokens directly.
const PRIMARY = "#21201c";

export async function findAddress(address, signal) {
  if (!mapboxToken.startsWith("pk.")) {
    throw new Error("Search is not available");
  }

  const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  url.searchParams.set("q", address);
  url.searchParams.set("access_token", mapboxToken);
  url.searchParams.set("country", "us");
  url.searchParams.set("types", "address");
  url.searchParams.set("proximity", CAMPUS.join(","));
  url.searchParams.set("limit", "5");
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error("Address search failed. Try again.");
  }

  const result = await response.json();
  if (!Array.isArray(result.features)) {
    throw new Error("Address search returned an unexpected response. Try again.");
  }

  const matches = [];
  for (const feature of result.features) {
    const context = feature.properties?.context || {};
    const isChicago = context.place?.name?.toLowerCase() === "chicago";
    const isIllinois = context.region?.region_code === "IL";
    if (isChicago && isIllinois) {
      matches.push({
        label: feature.properties.full_address || feature.properties.place_formatted || address,
        longitude: feature.geometry.coordinates[0],
        latitude: feature.geometry.coordinates[1],
      });
    }
  }
  return matches;
}

export function createMap(container, options = {}) {
  mapboxgl.accessToken = mapboxToken;
  const center = options.center
    ? [options.center.longitude, options.center.latitude]
    : CAMPUS;
  const map = new mapboxgl.Map({
    container,
    style: "mapbox://styles/mapbox/light-v11",
    center,
    zoom: 13.6,
    attributionControl: true,
    cooperativeGestures: true,
  });  map.addControl(
    new mapboxgl.NavigationControl({ showCompass: false }),
    "top-right",
  );
  let apartmentMarker;
  let addressLabel;
  let incidentLabel;
  let pending = {
    center: options.center,
    radius: options.radius,
    incidents: [],
    selectedId: "",
  };
  let selectedMarker;
  let updating = false;
  let updateApplied = false;

  // What the map shows: reports grouped into badges by how much they overlap
  // on screen (see clusters.js).
  //
  // Badges are DOM markers, not a GeoJSON layer. A layer can only animate by
  // calling setData every frame, which re-tiles the data in a Mapbox worker;
  // the worker is busy loading tiles while the map zooms, so most frames were
  // dropped (measured: 67 of 285 reached the screen during a ctrl+scroll zoom)
  // and the badges froze. Markers instead move with the camera inside Mapbox's
  // own render frame, and each merge or split is a Web Animation on transform
  // and opacity that the compositor runs with no JavaScript per frame.
  //
  // FLIP: a badge's marker sits at where it ends up, and its button animates
  // from where it was (as a pixel offset) to rest. The end is always exact; if
  // the zoom keeps moving mid-animation the offset is briefly a little off,
  // which at 160ms never reads.
  let plan = [];
  let planStart = -Infinity;
  let groupedZoom = NaN;
  let reportsById = new Map();
  const badges = new Map(); // node.sig -> { marker, element, button, node, animation }
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  // The CSS twin of easeOut in clusters.js, 1 - (1 - t)^4, so the look computed
  // for a regroup that starts mid-move matches what the compositor shows.
  const EASE_OUT_QUART = "cubic-bezier(0.25, 1, 0.5, 1)";

  // Every badge's look right now: mid-move if a plan is still playing.
  const onScreen = () => {
    const progress = (performance.now() - planStart) / TRANSITION_MS;
    return progress >= 1 ? settle(plan) : frameAt(plan, progress);
  };

  const icon = (src) => {
    const image = document.createElement("img");
    image.src = src;
    image.width = 20;
    image.height = 20;
    image.alt = "";
    image.draggable = false;
    image.decoding = "async";
    return image;
  };

  // Three kinds of badge:
  //  - a report: its category icon, click selects it;
  //  - a stack, several reports at one coordinate: the stack icon, no number,
  //    click lists them in the tooltip;
  //  - a cluster, different places merged by overlap: a number, click zooms in.
  const fillBadge = ({ element, button }, node) => {
    const kind = !node.sameSpot ? "cluster" : node.count > 1 ? "stack" : "report";
    element.style.setProperty("--badge-size", `${nodeRadius(node) * 2}px`);
    button.dataset.kind = kind;
    button.dataset.ids = node.sig;
    button.textContent = "";
    if (kind === "cluster") {
      const count = document.createElement("span");
      count.textContent =
        node.count >= 1000 ? `${Math.round(node.count / 100) / 10}k` : String(node.count);
      button.append(count);
      button.setAttribute("aria-label", `${node.count} reports nearby, zoom in`);
    } else if (kind === "stack") {
      button.append(icon(stackMarkerIcon));
      button.setAttribute("aria-label", `${node.count} reports at this spot`);
    } else {
      const incident = reportsById.get(node.ids[0]);
      button.append(icon(incidentIcons[incident?.category] || stackMarkerIcon));
      button.setAttribute(
        "aria-label",
        incident ? `${titleCase(incident.category)}, ${titleCase(incident.block)}` : "Report",
      );
    }
  };

  const onBadgeClick = (node) => {
    const lngLat = { lng: node.lng, lat: node.lat };
    // A numbered cluster only ever zooms in; the tooltip is for a stack, which
    // zooming can't separate. At the zoom limit nothing more can separate a
    // cluster either, so it lists its reports.
    if (!node.sameSpot) {
      if (map.getZoom() < CLUSTER_ZOOM_LIMIT) {
        zoomIntoCluster(node.ids);
      } else {
        openStackPopup(node.ids, lngLat);
      }
      return;
    }
    if (node.count > 1) {
      openStackPopup(node.ids, lngLat);
      return;
    }
    options.onSelect?.(node.ids[0]);
  };

  const createBadge = (node) => {
    const element = document.createElement("div");
    element.className = "incident-marker";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "incident-badge";
    // The records list is the keyboard path; a tab stop per badge would bury it.
    button.tabIndex = -1;
    element.append(button);
    const badge = { element, button, node, animation: null };
    button.addEventListener("click", (event) => {
      // The map's own click would close the tooltip this click opens.
      event.stopPropagation();
      onBadgeClick(badge.node);
    });
    fillBadge(badge, node);
    badge.marker = new mapboxgl.Marker({ element }).setLngLat([node.lng, node.lat]).addTo(map);
    return badge;
  };

  const removeBadge = (sig, badge) => {
    badge.animation?.cancel();
    badge.marker.remove();
    badges.delete(sig);
  };

  // One badge from its look at the start of the plan to its look at the end.
  const moveBadge = (sig, badge, { start, end, ghost }, animate) => {
    badge.animation?.cancel();
    badge.animation = null;
    const still =
      start.lng === end.lng &&
      start.lat === end.lat &&
      start.scale === end.scale &&
      start.opacity === end.opacity;
    if (!animate || still) {
      if (ghost) {
        removeBadge(sig, badge);
      }
      return;
    }
    const from = map.project([start.lng, start.lat]);
    const to = map.project([end.lng, end.lat]);
    const animation = badge.button.animate(
      [
        {
          transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${start.scale})`,
          opacity: start.opacity,
        },
        { transform: `scale(${end.scale})`, opacity: end.opacity },
      ],
      {
        duration: TRANSITION_MS,
        easing: EASE_OUT_QUART,
        // A leaving badge holds its faded end until it is removed; the others
        // end at rest, which is their own style, so they need no fill.
        fill: ghost ? "forwards" : "none",
      },
    );
    badge.animation = animation;
    if (ghost) {
      animation.finished
        .then(() => {
          if (badge.animation === animation) {
            removeBadge(sig, badge);
          }
        })
        .catch(() => {});
    }
  };

  // Regroups for the current zoom and moves the badges from how they look now
  // to the new grouping. Called again as the zoom moves, so a move may begin
  // while the last one is still playing; it picks up from the on-screen look.
  // Nothing moves on first paint, under reduced motion, or when the grouping
  // didn't change. `refresh` redraws badge contents, for new data.
  const applyLayout = ({ refresh = false } = {}) => {
    if (!map.getSource("incidents")) {
      return;
    }
    groupedZoom = map.getZoom();
    reportsById = new Map(pending.incidents.map((incident) => [String(incident.id), incident]));
    const next = buildClusters(pending.incidents, (longitude, latitude) =>
      map.project([longitude, latitude]),
    );
    const current = onScreen();
    plan = planTransition(current, next);
    const animate = current.length > 0 && !reducedMotion.matches && isMoving(plan);
    planStart = animate ? performance.now() : -Infinity;

    const planned = new Set();
    for (const item of plan) {
      const { sig } = item.node;
      planned.add(sig);
      let badge = badges.get(sig);
      if (!badge) {
        badge = createBadge(item.node);
        badges.set(sig, badge);
      } else if (refresh) {
        fillBadge(badge, item.node);
      }
      badge.node = item.node;
      badge.marker.setLngLat([item.end.lng, item.end.lat]);
      badge.element.classList.toggle("is-ghost", item.ghost);
      badge.button.inert = item.ghost;
      moveBadge(sig, badge, item, animate);
    }
    for (const [sig, badge] of badges) {
      if (!planned.has(sig)) {
        removeBadge(sig, badge);
      }
    }
  };

  // A cluster of different places opens up by zooming toward its reports, at
  // most CLUSTER_ZOOM_STEP levels per click. Each click lands on smaller
  // clusters, stacks or single badges, and clicking again keeps going, so the
  // map never jumps straight to street level. Never zooms out.
  const zoomIntoCluster = (ids) => {
    const bounds = new mapboxgl.LngLatBounds();
    for (const id of ids) {
      const incident = reportsById.get(id);
      if (incident) {
        bounds.extend([incident.longitude, incident.latitude]);
      }
    }
    if (bounds.isEmpty()) {
      return;
    }
    const current = map.getZoom();
    const fit = map.cameraForBounds(bounds, { padding: 60, maxZoom: 20 });
    const zoom = Math.min(
      Math.max(fit?.zoom ?? current, current + 1),
      current + CLUSTER_ZOOM_STEP,
      CLUSTER_ZOOM_LIMIT,
    );
    map.easeTo({
      center: fit?.center ?? bounds.getCenter(),
      zoom,
      duration: reducedMotion.matches ? 0 : 500,
    });
  };

  map.on("render", () => {
    if (updating && updateApplied && map.isSourceLoaded("radius") && map.isSourceLoaded("incidents")) {
      updating = false;
      options.onUpdating?.(false);
    }
  });
  map.on("error", () => {
    if (updating) {
      updating = false;
      options.onUpdating?.(false);
    }
  });

  // Water only.
  const WATER = "#cfe0e8";
  const WATER_LINE = "#bdced8";
  const WATER_LAYER_ID = "terrain-water";
  const isWaterLayer = (id) => /water/.test(id);
  const baseFills = new Map();
  const baseOutline = new Map();
  let waterOn = true;
  let waterPending = true;

  const readPaint = (layerId, property) => {
    try {
      return map.getPaintProperty(layerId, property) ?? null;
    } catch {
      return null;
    }
  };

  const setPaint = (layerId, property, value) => {
    try {
      map.setPaintProperty(layerId, property, value);
    } catch {
    }
  };

  const applyWater = () => {
    for (const { id } of map.getStyle().layers) {
      if (!isWaterLayer(id)) {
        continue;
      }
      const layer = map.getLayer(id);
      if (!layer) {
        continue;
      }
      if (id === WATER_LAYER_ID || layer.type !== "fill") {
        continue;
      }
      if (!baseFills.has(id)) {
        baseFills.set(id, readPaint(id, "fill-color"));
        baseOutline.set(id, readPaint(id, "fill-outline-color"));
      }
      setPaint(id, "fill-color", waterOn ? WATER : baseFills.get(id) ?? "transparent");
      const outline = waterOn ? WATER_LINE : baseOutline.get(id) ?? null;
      if (outline) {
        setPaint(id, "fill-outline-color", outline);
      }
    }
    waterPending = false;
  };

  const addWater = () => {
    if (!map.getLayer(WATER_LAYER_ID)) {
      const before = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
      try {
        map.addLayer(
          {
            id: WATER_LAYER_ID,
            type: "fill",
            source: "composite",
            "source-layer": "water",
            paint: {
              "fill-color": waterOn ? WATER : "transparent",
              "fill-outline-color": WATER_LINE,
            },
          },
          before,
        );
      } catch {
        // A style without the composite source simply gets no extra fill.
      }
    }
    applyWater();
  };

  const setWaterColor = (on) => {
    waterOn = on !== false;
    if (waterPending) {
      return waterOn;
    }
    applyWater();
    if (map.getLayer(WATER_LAYER_ID)) {
      setPaint(WATER_LAYER_ID, "fill-color", waterOn ? WATER : "transparent");
    }
    return waterOn;
  };

  // Several reports can sit on the same block coordinate, so their badges cover
  // each other. Clicking that spot lists them instead of guessing which one was
  // meant; each row opens its own report. No close button: opening a report or
  // clicking the map dismisses it.
  const stackPopup = new mapboxgl.Popup({
    closeButton: false,
    closeOnClick: true,
    maxWidth: "260px",
    offset: 16,
  });

  const openStackPopup = (ids, lngLat) => {
    const list = document.createElement("div");
    list.className = "stack-popup";

    const heading = document.createElement("p");
    heading.className = "stack-popup-title";
    heading.textContent = `${ids.length} reports at this spot`;
    // The title stays put; only the rows scroll.
    const rows = document.createElement("div");
    rows.className = "stack-popup-list";
    list.append(heading, rows);

    ids.forEach((id) => {
      const incident = pending.incidents.find((item) => item.id === String(id));
      if (!incident) {
        return;
      }

      const row = document.createElement("button");
      row.type = "button";
      row.className = "stack-popup-row";

      const icon = document.createElement("img");
      icon.className = "crime-icon-image";
      icon.src = incidentIcons[incident.category] || "";
      icon.width = 20;
      icon.height = 20;
      icon.alt = "";
      icon.setAttribute("aria-hidden", "true");

      // Same disc as the map markers and the record rows: a category should
      // look identical wherever it appears.
      const badge = document.createElement("span");
      badge.className = "crime-icon";
      badge.append(icon);

      const copy = document.createElement("span");
      copy.className = "stack-popup-copy";

      const name = document.createElement("strong");
      name.textContent = titleCase(incident.category);

      const meta = document.createElement("span");
      meta.textContent = `${titleCase(incident.block)} · ${formatDay(incident.date?.day, {
        month: "short",
        day: "numeric",
      })}`;

      copy.append(name, meta);
      row.append(badge, copy);
      row.addEventListener("click", () => {
        stackPopup.remove();
        options.onSelect?.(incident.id);
      });
      rows.append(row);
    });

    // The map frame clips anything that spills out of it, so the list may only
    // be as tall as the room on the roomier side of the spot (Mapbox opens the
    // popup on whichever side fits). Popup offset + tip + padding + title ≈ 80px.
    const height = map.getContainer?.().clientHeight || 0;
    const y = map.project(lngLat).y;
    const room = Math.max(y, height - y) - 80;
    if (height && room > 0) {
      rows.style.maxHeight = `${Math.max(120, Math.min(260, room))}px`;
    }
    // Scrolling the list should scroll the list, not zoom the map under it.
    // ctrl/⌘ + wheel is still a map zoom.
    rows.addEventListener("wheel", (event) => {
      if (!event.ctrlKey && !event.metaKey) {
        event.stopPropagation();
      }
    });

    stackPopup.setLngLat(lngLat).setDOMContent(list).addTo(map);
    // Keyboard users land on the first choice rather than back at the document.
    list.querySelector("button")?.focus();
  };

  const update = (next) => {
    pending = { ...pending, ...next };    if (!map.getSource("radius") || !map.getSource("incidents")) {
      return;
    }
    if (pending.center) {
      const coordinates = [pending.center.longitude, pending.center.latitude];
      if (!apartmentMarker) {
        const element = document.createElement("div");
        element.className = "apartment-marker";
        element.setAttribute("aria-label", "Chicago Place location");
        apartmentMarker = new mapboxgl.Marker({ element })
          .setLngLat(coordinates)
          .addTo(map);
      } else {
        apartmentMarker.setLngLat(coordinates);
      }
      if (pending.address) {
        if (!addressLabel) {
          const element = document.createElement("p");
          element.className = "map-address-label";
          addressLabel = new mapboxgl.Marker({ element, anchor: "bottom", offset: [0, -14] })
            .setLngLat(coordinates)
            .addTo(map);
        } else {
          addressLabel.setLngLat(coordinates);
        }
        addressLabel.getElement().textContent = pending.address;
      }
      map
        .getSource("radius")
        .setData(
          circle(coordinates, pending.radius || 0.5, {
            units: "miles",
            steps: 96,
          }),
        );
    }
    // Reports that share a coordinate get the stack glyph, so the badge says
    // "several here" at a glance.
    const pointCounts = new Map();
    pending.incidents.forEach((incident) => {
      const key = `${incident.longitude},${incident.latitude}`;
      pointCounts.set(key, (pointCounts.get(key) || 0) + 1);
    });

    map.getSource("incidents").setData({
      type: "FeatureCollection",
      features: pending.incidents.map((incident) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [incident.longitude, incident.latitude],
        },
        properties: {
          id: incident.id,
          category: incident.category,
          stacked:
            (pointCounts.get(`${incident.longitude},${incident.latitude}`) || 1) > 1,
        },
      })),
    });
    applyLayout({ refresh: true });

    // The open report gets its own badge above the others: inside a cluster it
    // would otherwise be hidden by the count disc, and the map would stop
    // matching the panel.
    const selected = pending.incidents.find(
      (incident) => incident.id === pending.selectedId,
    );
    if (selected) {
      const spotIds = pending.incidents
        .filter(
          (incident) =>
            incident.longitude === selected.longitude && incident.latitude === selected.latitude,
        )
        .map((incident) => incident.id);
      if (!selectedMarker) {
        const element = document.createElement("div");
        element.className = "incident-marker is-selected";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "incident-badge";
        button.tabIndex = -1;
        element.append(button);
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          const { ids, lngLat } = selectedMarker.spot;
          if (ids.length > 1) {
            openStackPopup(ids, lngLat);
          }
        });
        selectedMarker = new mapboxgl.Marker({ element });
      }
      const coordinates = [selected.longitude, selected.latitude];
      selectedMarker.spot = { ids: spotIds, lngLat: { lng: coordinates[0], lat: coordinates[1] } };
      const button = selectedMarker.getElement().querySelector("button");
      button.dataset.ids = selected.id;
      button.textContent = "";
      button.append(
        icon(spotIds.length > 1 ? stackMarkerIcon : incidentIcons[selected.category] || stackMarkerIcon),
      );
      button.setAttribute(
        "aria-label",
        `Open report: ${titleCase(selected.category)}, ${titleCase(selected.block)}`,
      );
      selectedMarker.setLngLat(coordinates).addTo(map);
    } else {
      selectedMarker?.remove();
    }
    updateApplied = true;
    if (selected) {
      if (!incidentLabel) {
        const element = document.createElement("div");
        element.className = "map-incident-label";
        incidentLabel = new mapboxgl.Marker({
          element,
          anchor: "left",
          offset: [22, 0],
        })
          .setLngLat([selected.longitude, selected.latitude])
          .addTo(map);
      } else {
        incidentLabel.setLngLat([selected.longitude, selected.latitude]);
      }
      const node = incidentLabel.getElement();
      node.textContent = "";
      const name = document.createElement("strong");
      name.textContent = titleCase(selected.category);
      const block = document.createElement("span");
      block.textContent = titleCase(selected.block);
      // The card on the map carries the same three facts as a list row: what
      // happened, where, and when.
      const date = document.createElement("time");
      date.dateTime = selected.date.day;
      date.textContent = formatDay(selected.date.day, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      node.append(name, block, date);
      if (!node.classList.contains("is-visible")) {
        node.classList.add("is-visible");
      }
    } else if (incidentLabel) {
      incidentLabel.getElement().classList.remove("is-visible");
    }
  };

  map.on("load", () => {
    // Painted before any incident layer so the badges always sit on top of it.
    addWater();
    map.addSource("radius", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    // Outline only: a filled disc tints every badge and label inside it.
    // 1.5px matches the incident disc stroke, so the two rings on the map read
    // as one weight instead of the boundary shouting over the markers.
    map.addLayer({
      id: "radius-outline",
      type: "line",
      source: "radius",
      paint: { "line-color": PRIMARY, "line-width": 1.5 },
    });
    // Every report, one feature each. Nothing draws from it: it is the full
    // list the badges (DOM markers, see applyLayout) are derived from.
    map.addSource("incidents", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    const campusElement = document.createElement("img");
    campusElement.className = "campus-marker";
    campusElement.src = campusIcon;
    campusElement.alt = "UIC campus";
    campusElement.setAttribute("aria-label", "UIC campus");
    new mapboxgl.Marker({ element: campusElement })
      .setLngLat(CAMPUS)
      .addTo(map);
    // Regroup while the zoom is still moving, not after it lands, so the badges
    // merge and split in step with the wheel or pinch. The final call catches
    // whatever the last step missed.
    map.on("zoom", () => {
      if (Math.abs(map.getZoom() - groupedZoom) >= ZOOM_STEP) {
        applyLayout();
      }
    });
    map.on("zoomend", () => applyLayout());
    update({});
  });
  return {
    update,
    beginUpdate: () => {
      updating = true;
      updateApplied = false;
      options.onUpdating?.(true);
    },
    setWaterColor,
    destroy: () => {
      for (const badge of badges.values()) {
        badge.animation?.cancel();
      }
      badges.clear();
      if (updating) options.onUpdating?.(false);
      map.remove();
    },
    resize: () => map.resize(),
  };
}
