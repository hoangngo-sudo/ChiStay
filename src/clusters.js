// Merges incident badges that collide on screen and describes how the map
// should move from one grouping to the next. Pure functions, no Mapbox, so the
// rules can be tested without a browser.

// Two badges merge once they overlap by this share of the smaller one's width.
export const CLUSTER_OVERLAP = 0.2;
// Short, because a new move starts every time the zoom crosses a step: each one
// only has to close a small gap, and a long one would trail behind the wheel.
export const TRANSITION_MS = 160;
// Badges shrink to this scale as they leave and grow from it as they arrive,
// never from nothing, so they always have a visible shape.
const EDGE_SCALE = 0.6;

// Disc radius in px for a badge standing for `count` reports. Mirrors the old
// step expression: 16 for one report, then 17, 20 and 24 as counts grow.
export function badgeRadius(count) {
  if (count < 2) return 16;
  if (count < 10) return 17;
  if (count < 50) return 20;
  return 24;
}

// The disc a node is drawn with. Reports that share one coordinate are drawn as
// a single stack badge, the size of a lone report, however many they are: they
// were already one place on the map, so they must not merge from further away
// than any other badge. Only a cluster of different places grows with its count.
export function nodeRadius(node) {
  return node.sameSpot ? badgeRadius(1) : badgeRadius(node.count);
}

// Centre-to-centre distance under which two badges count as merged. Two
// 16px discs: 16 + 16 - 2 * 0.2 * 16 = 25.6px, a 20% overlap.
function mergeDistance(a, b) {
  const ra = nodeRadius(a);
  const rb = nodeRadius(b);
  return ra + rb - 2 * CLUSTER_OVERLAP * Math.min(ra, rb);
}

// The widest merge distance, used to skip far-apart pairs cheaply.
const MAX_MERGE_DISTANCE = 2 * badgeRadius(Infinity) * (1 - CLUSTER_OVERLAP);

// incidents: [{ id, longitude, latitude }]
// project:   (longitude, latitude) => { x, y } in screen pixels
// Returns nodes { ids, count, lng, lat, x, y, sameSpot, sig }. `sameSpot` is
// true for reports that share one coordinate (a stack: one badge with the stack
// icon, click for the list) and false once different places have merged (a
// numbered cluster: click to zoom in).
export function buildClusters(incidents, project) {
  const spots = new Map();
  for (const incident of incidents) {
    const key = `${incident.longitude},${incident.latitude}`;
    let spot = spots.get(key);
    if (!spot) {
      spot = { ids: [], lng: incident.longitude, lat: incident.latitude };
      spots.set(key, spot);
    }
    spot.ids.push(String(incident.id));
  }

  const nodes = [...spots.values()].map((spot) => {
    const { x, y } = project(spot.lng, spot.lat);
    return {
      ids: spot.ids,
      count: spot.ids.length,
      lng: spot.lng,
      lat: spot.lat,
      x,
      y,
      sameSpot: true,
    };
  });

  // Biggest first, ties by id, so the same data always groups the same way.
  nodes.sort((a, b) => b.count - a.count || (a.ids[0] < b.ids[0] ? -1 : 1));

  // A merged badge grows and moves, so it may now touch a neighbour it missed
  // before. Repeat until nothing more merges.
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (Math.abs(dx) > MAX_MERGE_DISTANCE || Math.abs(dy) > MAX_MERGE_DISTANCE) {
          continue;
        }
        const reach = mergeDistance(a, b);
        if (dx * dx + dy * dy >= reach * reach) {
          continue;
        }
        const total = a.count + b.count;
        a.lng = (a.lng * a.count + b.lng * b.count) / total;
        a.lat = (a.lat * a.count + b.lat * b.count) / total;
        a.x = (a.x * a.count + b.x * b.count) / total;
        a.y = (a.y * a.count + b.y * b.count) / total;
        a.ids = a.ids.concat(b.ids);
        a.count = total;
        a.sameSpot = false;
        nodes.splice(j, 1);
        j -= 1;
        merged = true;
      }
    }
  }

  for (const node of nodes) {
    node.ids.sort();
    node.sig = node.ids.join(",");
  }
  return nodes;
}

// The node in `owners` that holds most of `ids`, or null.
function dominantOwner(ids, owners) {
  const tally = new Map();
  let best = null;
  let bestCount = 0;
  for (const id of ids) {
    const owner = owners.get(id);
    if (!owner) continue;
    const count = (tally.get(owner) || 0) + 1;
    tally.set(owner, count);
    if (count > bestCount) {
      best = owner;
      bestCount = count;
    }
  }
  return best;
}

function indexByReport(nodes) {
  const owners = new Map();
  for (const node of nodes) {
    for (const id of node.ids) owners.set(id, node);
  }
  return owners;
}

// A sprite is one badge as it looks right now: the reports it stands for
// (`node`) plus where it is, how big and how visible. Animating means moving
// every sprite from its current look to its next one.
const look = (lng, lat, scale, opacity) => ({ lng, lat, scale, opacity });

export function spritesOf(nodes) {
  return nodes.map((node) => ({
    node,
    lng: node.lng,
    lat: node.lat,
    scale: 1,
    opacity: 1,
    ghost: false,
  }));
}

// Plans the move from what is on screen (`sprites`) to a new grouping.
//  - Same set of reports: the badge stays and settles at its resting look.
//  - New badge: starts small and invisible where the reports it absorbed are.
//  - Gone badge: shrinks away on its way to where its reports ended up (a
//    "ghost", which can't be clicked).
// That one rule reads as a merge when zooming out and a split when zooming in.
// Plans start from each sprite's look right now, not its last resting look, so
// a new plan can begin in the middle of a move without anything jumping, which
// is what keeps the badges in step with a zoom that never stops. Exits come
// first so new badges draw on top.
export function planTransition(sprites, next) {
  const bySig = new Map(sprites.map((sprite) => [sprite.node.sig, sprite]));
  const nextBySig = new Map(next.map((node) => [node.sig, node]));
  const liveOwner = new Map();
  for (const sprite of sprites) {
    if (sprite.ghost) continue;
    for (const id of sprite.node.ids) liveOwner.set(id, sprite);
  }
  const nextOwner = indexByReport(next);

  const exits = [];
  const stays = [];
  const enters = [];
  for (const sprite of sprites) {
    if (nextBySig.has(sprite.node.sig)) continue;
    const to = dominantOwner(sprite.node.ids, nextOwner) || sprite.node;
    exits.push({
      node: sprite.node,
      ghost: true,
      start: look(sprite.lng, sprite.lat, sprite.scale, sprite.opacity),
      end: look(to.lng, to.lat, EDGE_SCALE, 0),
    });
  }
  for (const node of next) {
    const end = look(node.lng, node.lat, 1, 1);
    const existing = bySig.get(node.sig);
    if (existing) {
      stays.push({
        node,
        ghost: false,
        start: look(existing.lng, existing.lat, existing.scale, existing.opacity),
        end,
      });
      continue;
    }
    const from = dominantOwner(node.ids, liveOwner) || node;
    enters.push({ node, ghost: false, start: look(from.lng, from.lat, EDGE_SCALE, 0), end });
  }
  return [...exits, ...stays, ...enters];
}

// True when any badge has somewhere to go.
export function isMoving(items) {
  return items.some(
    ({ start, end }) =>
      start.lng !== end.lng ||
      start.lat !== end.lat ||
      start.scale !== end.scale ||
      start.opacity !== end.opacity,
  );
}

// Strong ease-out: responds the instant a move starts, then settles.
function easeOut(t) {
  return 1 - (1 - t) ** 4;
}

function lerp(from, to, t) {
  return from + (to - from) * t;
}

// Every badge's look at `progress` (0..1) through the plan.
export function frameAt(items, progress) {
  const eased = easeOut(progress);
  return items.map(({ node, ghost, start, end }) => ({
    node,
    ghost,
    lng: lerp(start.lng, end.lng, eased),
    lat: lerp(start.lat, end.lat, eased),
    scale: lerp(start.scale, end.scale, eased),
    opacity: lerp(start.opacity, end.opacity, eased),
  }));
}

// The badges left once a plan has fully played: the ghosts are gone.
export function settle(items) {
  return frameAt(items, 1).filter((sprite) => !sprite.ghost);
}
