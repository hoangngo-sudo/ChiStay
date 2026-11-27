class MockMap {
  constructor(options) {
    this.options = options;
    this.container = options.container;
    this.sources = new globalThis.Map();
    this.layers = new globalThis.Map();
    this.images = new Set();
    this.handlers = {};
    window.__testMap = this;
    queueMicrotask(() => this.handlers.load?.());
  }

  addControl() {}
  on(event, layer, callback) {
    if (typeof layer === 'function') this.handlers[event] = layer;
    else this.handlers[`${event}:${layer}`] = callback;
  }
  addSource(id, options) {
    this.sources.set(id, {
      data: options.data,
      setData(data) { this.data = structuredClone(data); },
    });
  }
  getSource(id) { return this.sources.get(id); }
  isSourceLoaded(id) { return this.sources.has(id); }
  addLayer(layer) { this.layers.set(layer.id, layer); }
  getLayer(id) { return this.layers.get(id); }
  getStyle() { return { layers: [...this.layers.values()] }; }
  getPaintProperty(id, property) { return this.layers.get(id)?.paint?.[property]; }
  setPaintProperty(id, property, value) { this.layers.get(id).paint[property] = value; }
  hasImage(name) { return this.images.has(name); }
  addImage(name) { this.images.add(name); }
  getZoom() { return 13.6; }
  // Screen position for the badge grouping; a flat scale is enough here.
  // Like Mapbox, it takes [lng, lat] or { lng, lat }.
  project(lngLat) {
    const [lng, lat] = Array.isArray(lngLat) ? lngLat : [lngLat.lng, lngLat.lat];
    return { x: lng * 1e5, y: lat * 1e5 };
  }
  getCanvas() { return this.container; }
  resize() {}
  remove() {}
}

class Marker {
  constructor({ element }) { this.element = element; }
  // Kept on the element too, so a test can read where a badge was placed.
  setLngLat(coordinates) {
    this.coordinates = coordinates;
    this.element.dataset.lngLat = JSON.stringify(coordinates);
    return this;
  }
  addTo(map) { map.container.append(this.element); return this; }
  getElement() { return this.element; }
  remove() { this.element.remove(); return this; }
}

class Popup {
  setLngLat() { return this; }
  setDOMContent(element) { this.element = element; return this; }
  addTo(map) { map.container.append(this.element); return this; }
  remove() { this.element?.remove(); return this; }
}

export default { Map: MockMap, Marker, Popup, NavigationControl: class {} };