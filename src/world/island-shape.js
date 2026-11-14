/**
 * SANDSTRIKE // tropical island geometry helpers (pure math, no three).
 *
 * Shared by the `sandstrike/map@2` adapter (collision derivation) and the island world
 * builders (visual geometry), so the boundary reef collider ring and the rock ridge you
 * can see are generated from the exact same numbers. Keep this module `three`-free: it is
 * imported by the Node map checker.
 *
 * Angle convention matches the rest of the map data: radians measured from +Z (south)
 * toward +X (east); `x = sin(angle) * radius`, `z = cos(angle) * radius`.
 */

export const TAU = Math.PI * 2;

const num = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** Wrap an angle into [-PI, PI). */
export function wrapAngle(angle) {
  let a = angle % TAU;
  if (a >= Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
}

/** Shortest signed difference `a - b` in radians. */
export function angleDelta(a, b) {
  return wrapAngle(a - b);
}

/**
 * Boundary ring resolution. `boundary.gap` may be one gap object or an array of them.
 * Returns normalised, plain data (safe to structuredClone).
 */
export function resolveBoundary(boundary = {}) {
  const b = boundary ?? {};
  const radius = num(b.radius, 52);
  const segments = Math.max(12, Math.round(num(b.segments, 116)));
  const height = num(b.height, 1.65);
  const thickness = num(b.thickness, 3.2);
  const raw = Array.isArray(b.gap) ? b.gap : b.gap ? [b.gap] : [];
  const gaps = raw
    .filter((gap) => gap && Number.isFinite(gap.angle))
    .map((gap) => ({
      angle: wrapAngle(gap.angle),
      width: Math.max(0.5, num(gap.width, 6)),
      height: Math.max(0, num(gap.height, 0)),
    }));
  return { radius, segments, height, thickness, gaps };
}

/** True when `angle` falls inside one of the ring gaps (arc width at `radius`). */
export function boundaryGapAt(angle, boundary) {
  // Accept both raw boundary data (`gap`) and a resolved ring (`gaps`) so callers can
  // pass the object returned by resolveBoundary() without losing the gap list.
  const ring = boundary && Array.isArray(boundary.gaps) ? boundary : resolveBoundary(boundary);
  for (const gap of ring.gaps) {
    const arcHalf = gap.width / 2 / Math.max(1, ring.radius);
    if (Math.abs(angleDelta(angle, gap.angle)) <= arcHalf) return gap;
  }
  return null;
}

/**
 * One ring segment descriptor (used by both the collider ring and the rock visuals).
 *
 * `size` is the square side of the AABB (and of the rock cluster built inside it), so the
 * visible ridge never pokes outside its collider — that keeps `map-audit` air-wall checks
 * clean. Segments overlap slightly for a continuous barrier.
 */
export function boundarySegments(boundary) {
  const ring = resolveBoundary(boundary);
  const segments = [];
  const step = TAU / ring.segments;
  const arc = ring.radius * step;
  const size = Math.max(arc * 1.22, ring.thickness * 0.9);
  for (let i = 0; i < ring.segments; i++) {
    const angle = wrapAngle(-Math.PI + (i + 0.5) * step);
    if (boundaryGapAt(angle, ring)) {
      segments.push({ index: i, angle, x: Math.sin(angle) * ring.radius, z: Math.cos(angle) * ring.radius, size, height: 0, skipped: true });
      continue;
    }
    segments.push({
      index: i,
      angle,
      x: Math.sin(angle) * ring.radius,
      z: Math.cos(angle) * ring.radius,
      size,
      height: ring.height,
      skipped: false,
    });
  }
  return { ring, segments };
}

/** Axis-aligned collision boxes for the reef ridge, derived from `boundarySegments`. */
export function islandRingBoxes(boundary) {
  const { segments } = boundarySegments(boundary);
  const surface = 'stone';
  return segments
    .filter((segment) => !segment.skipped)
    .map((segment) => {
      const half = segment.size / 2;
      return {
        minX: +(segment.x - half).toFixed(3),
        maxX: +(segment.x + half).toFixed(3),
        minZ: +(segment.z - half).toFixed(3),
        maxZ: +(segment.z + half).toFixed(3),
        minY: -0.4,
        maxY: +segment.height.toFixed(3),
        surface,
      };
    });
}

/** Distance from the origin to the playable reef ring (metres). */
export function playRadius(terrain = {}) {
  return resolveBoundary(terrain?.boundary).radius;
}

/** Distance from the origin to the water line (metres). */
export function landRadius(terrain = {}) {
  return num(terrain?.island?.landRadius, 62);
}

/** True when (x,z) sits inside the playable ring (ignoring gaps). */
export function isInsidePlayRing(x, z, terrain = {}) {
  return Math.hypot(x, z) <= playRadius(terrain) - 0.6;
}
