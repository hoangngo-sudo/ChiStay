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
  getCanvas() { return this.container; }
  resize() {}
  remove() {}
}

class Marker {
  constructor({ element }) { this.element = element; }
  setLngLat(coordinates) { this.coordinates = coordinates; return this; }
  addTo(map) { map.container.append(this.element); return this; }
  getElement() { return this.element; }
}

class Popup {
  setLngLat() { return this; }
  setDOMContent(element) { this.element = element; return this; }
  addTo(map) { map.container.append(this.element); return this; }
  remove() { this.element?.remove(); return this; }
}

export default { Map: MockMap, Marker, Popup, NavigationControl: class {} };