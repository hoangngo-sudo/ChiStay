import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClusters,
  frameAt,
  isMoving,
  nodeRadius,
  planTransition,
  settle,
  spritesOf,
} from "../src/clusters.js";

// One degree = 1000px, so a gap in px is easy to read in the test data.
const project = (lng, lat) => ({ x: lng * 1000, y: lat * 1000 });
const at = (id, pxX, pxY = 0) => ({ id, longitude: pxX / 1000, latitude: pxY / 1000 });
const sizes = (nodes) => nodes.map((node) => node.count).sort();
const plan = (prevReports, nextReports) =>
  planTransition(
    spritesOf(buildClusters(prevReports, project)),
    buildClusters(nextReports, project),
  );
const exits = (items) => items.filter((item) => item.ghost);
const arrivals = (items) => items.filter((item) => !item.ghost && item.start.opacity === 0);

test("single badges merge at 20% overlap and not before", () => {
  // 16px radius badges: 25.6px apart is exactly 20% overlap.
  assert.deepEqual(sizes(buildClusters([at("a", 0), at("b", 25)], project)), [2]);
  assert.deepEqual(sizes(buildClusters([at("a", 0), at("b", 26)], project)), [1, 1]);
});

test("reports at one coordinate form one stack, not a numbered cluster", () => {
  const nodes = buildClusters([at("a", 10), at("b", 10), at("c", 10)], project);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].count, 3);
  assert.equal(nodes[0].sameSpot, true);
  assert.equal(nodeRadius(nodes[0]), 16);
});

test("a stack merges with a neighbour exactly like a single badge, however big", () => {
  const ten = Array.from({ length: 10 }, (_, index) => at(`t${index}`, 0));
  // Ten reports at one coordinate are still a 16px badge: 25.6px, not 29.6px.
  assert.deepEqual(sizes(buildClusters([...ten, at("x", 25)], project)), [11]);
  assert.deepEqual(sizes(buildClusters([...ten, at("x", 26)], project)), [1, 10]);
});

test("a stacked spot merges with a neighbour it overlaps", () => {
  const nodes = buildClusters([at("a", 0), at("b", 0), at("c", 24)], project);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].count, 3);
  assert.equal(nodes[0].sameSpot, false);
});

test("larger clusters keep the same 20% rule at their own size", () => {
  // Ten different places a pixel apart merge into one cluster centred on 4.5px.
  const ten = Array.from({ length: 10 }, (_, index) => at(`t${index}`, index));
  const [cluster] = buildClusters(ten, project);
  assert.equal(cluster.count, 10);
  assert.equal(cluster.sameSpot, false);
  assert.equal(nodeRadius(cluster), 20);
  // 20px-radius cluster next to a 16px badge: 20 + 16 - 2 * 0.2 * 16 = 29.6px.
  assert.deepEqual(sizes(buildClusters([...ten, at("x", 4.5 + 29)], project)), [11]);
  assert.deepEqual(sizes(buildClusters([...ten, at("x", 4.5 + 30)], project)), [1, 10]);
});

test("grouping does not depend on input order", () => {
  const reports = [at("a", 0), at("b", 20), at("c", 40), at("d", 200)];
  const forward = buildClusters(reports, project).map((node) => node.sig).sort();
  const backward = buildClusters([...reports].reverse(), project).map((node) => node.sig).sort();
  assert.deepEqual(forward, backward);
});

test("zooming out reads as a merge: children travel into the new cluster", () => {
  const items = plan([at("a", 0), at("b", 100)], [at("a", 0), at("b", 10)]);
  assert.equal(exits(items).length, 2);
  const [merged] = arrivals(items);
  assert.ok(merged, "one new cluster arrives");
  for (const exit of exits(items)) {
    assert.equal(exit.end.lng, merged.node.lng);
    assert.equal(exit.end.opacity, 0);
  }
});

test("zooming in reads as a split: children leave from the old cluster", () => {
  const prev = buildClusters([at("a", 0), at("b", 10)], project);
  const items = plan([at("a", 0), at("b", 10)], [at("a", 0), at("b", 100)]);
  assert.equal(exits(items).length, 1);
  assert.equal(arrivals(items).length, 2);
  for (const arrival of arrivals(items)) {
    assert.equal(arrival.start.lng, prev[0].lng);
  }
});

test("an unchanged grouping has nothing to animate", () => {
  assert.equal(isMoving(plan([at("a", 0), at("b", 100)], [at("a", 0), at("b", 100)])), false);
});

test("entering badges start small and invisible, and end settled", () => {
  const items = plan([at("a", 0), at("b", 100)], [at("a", 0), at("b", 10)]);

  const first = frameAt(items, 0);
  const entering = first.find((frame) => !frame.ghost && frame.opacity === 0);
  assert.equal(entering.scale, 0.6);
  assert.ok(first.filter((frame) => frame.ghost).every((frame) => frame.opacity === 1));

  const last = frameAt(items, 1);
  const arrived = last.find((frame) => frame.node === entering.node);
  assert.equal(arrived.opacity, 1);
  assert.equal(arrived.scale, 1);
  assert.ok(last.filter((frame) => frame.ghost).every((frame) => frame.opacity === 0));
});

test("settle drops the badges that left", () => {
  const items = plan([at("a", 0), at("b", 100)], [at("a", 0), at("b", 10)]);
  const resting = settle(items);
  assert.equal(resting.length, 1);
  assert.equal(resting[0].node.count, 2);
  assert.equal(resting[0].scale, 1);
  assert.equal(resting[0].opacity, 1);
  assert.equal(resting[0].ghost, false);
});

test("a regroup that starts mid-move picks up from what is on screen", () => {
  // Zoom out merges a and b; before that finishes, zoom in splits them again.
  const apart = [at("a", 0), at("b", 100)];
  const together = [at("a", 0), at("b", 10)];
  const merging = plan(apart, together);

  const midway = frameAt(merging, 0.4);
  const next = buildClusters(apart, project);
  const resumed = planTransition(midway, next);

  // The badges that were leaving come back as the same two reports: they
  // resume from their current look, not from full size.
  for (const sprite of midway.filter((frame) => frame.ghost)) {
    const item = resumed.find((candidate) => candidate.node.sig === sprite.node.sig);
    assert.ok(item, "the badge is reused rather than replaced");
    assert.equal(item.ghost, false);
    assert.equal(item.start.lng, sprite.lng);
    assert.equal(item.start.scale, sprite.scale);
    assert.equal(item.start.opacity, sprite.opacity);
  }
  // The half-formed cluster fades out from where it is, it doesn't pop away.
  const fading = resumed.find((item) => item.ghost);
  const halfFormed = midway.find((frame) => !frame.ghost);
  assert.equal(fading.start.opacity, halfFormed.opacity);
  assert.equal(fading.start.scale, halfFormed.scale);
});
