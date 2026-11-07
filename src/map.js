import mapboxgl from "mapbox-gl";
import circle from "@turf/circle";
import "mapbox-gl/dist/mapbox-gl.css";
import campusIcon from "./assets/paper/uic.svg";
import { incidentIcons, stackMarkerIcon } from "./assets.js";
import { formatDay, titleCase } from "./data.mjs";

const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN || "";
const CAMPUS = [-87.6505, 41.8719];

// Mapbox paint values cannot read CSS variables, so these mirror the tokens in
// style.css: --ink, --primary, --incident and --incident-line.
const INK = "#21201c";
const PRIMARY = "#21201c";
const INCIDENT = "#f2c94c";

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
  });
  map.addControl(
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
  const markerImages = new Map();
  let mapDestroyed = false;
  let updating = false;
  let updateApplied = false;

  map.on("render", () => {
    if (updating && updateApplied && map.isSourceLoaded("radius") && map.isSourceLoaded("incidents") && map.isSourceLoaded("selected-incident")) {
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

  const loadMarkerImages = async () => {
    const categoryEntries = Object.entries(incidentIcons);
    for (const [category, imageUrl] of categoryEntries) {
      const image = new Image();
      image.src = imageUrl;
      try {
        await image.decode();
        if (mapDestroyed) {
          return;
        }
        const imageName = `category-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
        addMarkerImage(image, imageName);
        // The selected badge is a red disc, so its glyph has to read as white.
        addMarkerImage(image, `${imageName}-selected`, "#ffffff");
        markerImages.set(category, imageName);
      } catch (error) {
        console.error(`Unable to load the ${category} map icon.`, error);
      }
    }

    // Badges that stand for several reports at one point use the stack glyph
    // instead of a single category icon.
    const stackImage = new Image();
    stackImage.src = stackMarkerIcon;
    try {
      await stackImage.decode();
      if (!mapDestroyed) {
        addMarkerImage(stackImage, "stack");
        addMarkerImage(stackImage, "stack-selected", "#ffffff");
      }
    } catch (error) {
      console.error("Unable to load the stack map icon.", error);
    }

    if (!mapDestroyed) {
      update({});
    }
  };

  // Draws the icon at 40px and registers it. With a `tint`, the icon becomes a
  // flat silhouette in that colour, keeping its shape and transparency.
  const addMarkerImage = (image, name, tint) => {
    const canvas = document.createElement("canvas");
    canvas.width = 40;
    canvas.height = 40;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, 40, 40);
    if (tint) {
      context.globalCompositeOperation = "source-in";
      context.fillStyle = tint;
      context.fillRect(0, 0, 40, 40);
    }
    const imageData = context.getImageData(0, 0, 40, 40);
    if (!map.hasImage(name)) {
      map.addImage(name, imageData, { pixelRatio: 2 });
    }
  };

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

  const openStackPopup = (hits, lngLat) => {
    const list = document.createElement("div");
    list.className = "stack-popup";

    const heading = document.createElement("p");
    heading.className = "stack-popup-title";
    heading.textContent = `${hits.length} reports at this spot`;
    list.append(heading);

    hits.forEach((feature) => {
      const incident = pending.incidents.find(
        (item) => item.id === String(feature.properties.id),
      );
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
      list.append(row);
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
        element.setAttribute("aria-label", "Apartment location");
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
          icon: markerImages.get(incident.category) || "",
        },
      })),
    });

    // The open report gets its own source: inside a cluster it would otherwise
    // be hidden by the count disc, and the map would stop matching the panel.
    const selected = pending.incidents.find(
      (incident) => incident.id === pending.selectedId,
    );
    map.getSource("selected-incident").setData({
      type: "FeatureCollection",
      features: selected
        ? [
            {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [selected.longitude, selected.latitude],
              },
              properties: {
                id: selected.id,
                stacked:
                  (pointCounts.get(`${selected.longitude},${selected.latitude}`) || 1) > 1,
                icon: markerImages.get(selected.category) || "",
              },
            },
          ]
        : [],
    });
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
    map.addSource("incidents", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      // Reports in the same block share a coordinate to four decimals, so
      // without clustering they sit exactly on top of each other: the last
      // badge drawn wins every click and the rest are unreachable.
      cluster: true,
      clusterRadius: 24,
      clusterMaxZoom: 14,
    });
    map.addSource("selected-incident", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: "incident-clusters",
      type: "circle",
      source: "incidents",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": INCIDENT,
        "circle-radius": [
          "step",
          ["get", "point_count"],
          17,
          10,
          20,
          50,
          24,
        ],
      },
    });
    map.addLayer({
      id: "incident-cluster-counts",
      type: "symbol",
      source: "incidents",
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
        "text-size": 12,
        "text-allow-overlap": true,
      },
      paint: { "text-color": INK },
    });
    map.addLayer({
      id: "incident-points",
      type: "circle",
      source: "incidents",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": 16,
        // Yellow disc behind a dark glyph.
        "circle-color": INCIDENT,
      },
    });
    map.addLayer({
      id: "incident-icons",
      type: "symbol",
      source: "incidents",
      filter: ["all", ["!", ["has", "point_count"]], ["!=", ["get", "icon"], ""]],
      layout: {
        "icon-image": [
          "case",
          ["get", "stacked"],
          "stack",
          ["get", "icon"],
        ],
        "icon-size": 1,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
    // Drawn last so the open report is always legible above its cluster.
    map.addLayer({
      id: "selected-point",
      type: "circle",
      source: "selected-incident",
      paint: {
        "circle-radius": 18,
        "circle-color": INK,
      },
    });
    map.addLayer({
      id: "selected-icon",
      type: "symbol",
      source: "selected-incident",
      layout: {
        "icon-image": [
          "case",
          ["get", "stacked"],
          "stack-selected",
          ["concat", ["get", "icon"], "-selected"],
        ],
        "icon-size": 1,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
    // Reports in the same block share a coordinate, so their badges sit on top
    // of each other. A 22px radius gives every badge a 44px target, and a
    // click opens a popup listing everything stacked there.
    map.addLayer({
      id: "incident-hit",
      type: "circle",
      source: "incidents",
      filter: ["all", ["!", ["has", "point_count"]], ["has", "id"]],
      paint: {
        "circle-radius": 22,
        "circle-color": INCIDENT,
        "circle-opacity": 0,
      },
    });
    loadMarkerImages();
    const campusElement = document.createElement("img");
    campusElement.className = "campus-marker";
    campusElement.src = campusIcon;
    campusElement.alt = "UIC campus";
    campusElement.setAttribute("aria-label", "UIC campus");
    new mapboxgl.Marker({ element: campusElement })
      .setLngLat(CAMPUS)
      .addTo(map);
    map.on("click", "incident-hit", (event) => {
      const hits = event.features || [];
      if (hits.length === 0) {
        return;
      }
      if (hits.length === 1) {
        options.onSelect?.(String(hits[0].properties.id));
        return;
      }
      openStackPopup(hits, event.lngLat);
    });
    // A cluster is a stack of reports: open it up rather than picking one for
    // the user, which is what stacking them used to do.
    map.on("click", "incident-clusters", (event) => {
      const feature = event.features?.[0];
      if (!feature) {
        return;
      }
      const clusterId = feature.properties.cluster_id;
      map
        .getSource("incidents")
        .getClusterExpansionZoom(clusterId, (error, zoom) => {
          if (error) {
            return;
          }
          map.easeTo({
            center: feature.geometry.coordinates,
            zoom: Math.min(zoom, 16),
          });
        });
    });
    map.on("mouseenter", "incident-hit", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseenter", "incident-clusters", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "incident-hit", () => {
      map.getCanvas().style.cursor = "";
    });
    map.on("mouseleave", "incident-clusters", () => {
      map.getCanvas().style.cursor = "";
    });
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
      mapDestroyed = true;
      if (updating) options.onUpdating?.(false);
      map.remove();
    },
    resize: () => map.resize(),
  };
}
