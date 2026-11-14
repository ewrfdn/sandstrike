/**
 * ISLAND LEAF ATLAS — shared UV contract for the tropical alpha leaf cards.
 *
 * `src/textures/broadleaf.js` draws ONE 1024x1024 atlas with four leaf types, and
 * every leaf card in every island flora model samples one quarter of it:
 *
 *   CANVAS pixels (y grows DOWN, what the texture module paints):
 *
 *      u: 0        0.5       1
 *         +----------+----------+
 *   y 0   |  broad   |  banana  |    broad  = rounded jungle broadleaf
 *         +----------+----------+    banana = long banana / palm paddle leaf
 *   y .5  |  fern    |  vine    |    fern   = pinnate fern frond
 *         +----------+----------+    vine   = small vine leaf sprig
 *   y 1   +----------+----------+
 *
 * Canvas textures upload with flipY = true, so a cell painted at canvas y=0..0.5
 * lives at texture v=0.5..1. The LEAF_CELLS table below is in TEXTURE UV space
 * (v grows UP) — that is why the V ranges look vertically mirrored vs the picture.
 *
 * Authoring rules for the leaf texture (texture-flora):
 *   - transparent background, leaf fully opaque pixels, soft anti-aliased edge;
 *   - keep ~5% empty margin inside every cell so mip filtering never bleeds the
 *     neighbouring cell into the card silhouette;
 *   - leaves point along +U (tip at the right edge of the cell).
 *
 * Models use `leafQuad()` / `leafCellUV()` below instead of hard-coding the rects, so
 * re-laying the atlas only ever means touching this file.
 */
import * as THREE from 'three';

/** [u0, v0, u1, v1] of each atlas cell in TEXTURE UV space (flipY aware). */
export const LEAF_CELLS = Object.freeze({
  broad: [0.0, 0.5, 0.5, 1.0], // canvas top-left
  banana: [0.5, 0.5, 1.0, 1.0], // canvas top-right
  fern: [0.0, 0.0, 0.5, 0.5], // canvas bottom-left
  vine: [0.5, 0.0, 1.0, 0.5], // canvas bottom-right
});

/**
 * CANOPY CLUSTER ATLAS (lib.canopy, painted by src/textures/canopy.js).
 *
 * One card = a whole twig with 6-18 leaves, so canopies read dense at a fraction of
 * the triangle count of single-leaf cards. Same 2x2 UV contract, [u0, v0, u1, v1] in
 * TEXTURE UV space (flipY aware):
 *
 *       +--------------+--------------+
 *       | sprig (0)    | spray (1)    |   canvas TOP row  -> v 0.5..1
 *       +--------------+--------------+
 *       | pale  (2)    | dry   (3)    |   canvas BOTTOM row -> v 0..0.5
 *       +--------------+--------------+
 */
export const CANOPY_CELLS = Object.freeze({
  sprig: [0.0, 0.5, 0.5, 1.0],
  spray: [0.5, 0.5, 1.0, 1.0],
  pale: [0.0, 0.0, 0.5, 0.5],
  dry: [0.5, 0.0, 1.0, 0.5],
});

/** UV rect of one cell, inset by `pad` (fraction of the cell) to dodge mip bleed. */
export function leafCellUV(name = 'broad', pad = 0.02) {
  const [u0, v0, u1, v1] = LEAF_CELLS[name] || LEAF_CELLS.broad;
  const du = (u1 - u0) * pad;
  const dv = (v1 - v0) * pad;
  return { u0: u0 + du, v0: v0 + dv, u1: u1 - du, v1: v1 - dv };
}

/** UV rect of one canopy-cluster cell (same padding contract as leafCellUV). */
export function canopyCellUV(name = 'sprig', pad = 0.02) {
  const [u0, v0, u1, v1] = CANOPY_CELLS[name] || CANOPY_CELLS.sprig;
  const du = (u1 - u0) * pad;
  const dv = (v1 - v0) * pad;
  return { u0: u0 + du, v0: v0 + dv, u1: u1 - du, v1: v1 - dv };
}

/**
 * GROUND-COVER BLADE ATLAS (lib.grassBlade, painted by src/textures/grass-blade.js).
 *
 * One card = a whole grass tuft (15-24 tapered blades fanned out of one root), which is
 * how the ground stops reading as "texture noise + paper fans" (audit D-08). Blades grow
 * along +V (root at the cell's bottom edge), unlike the leaf atlases where they grow +U.
 *
 *       +--------------+--------------+
 *       | tuft         | tuftTall     |   canvas TOP row    -> v 0.5..1
 *       +--------------+--------------+
 *       | tuftDry      | cover        |   canvas BOTTOM row -> v 0..0.5
 *       +--------------+--------------+
 */
export const GRASS_CELLS = Object.freeze({
  tuft: [0.0, 0.5, 0.5, 1.0],
  tuftTall: [0.5, 0.5, 1.0, 1.0],
  tuftDry: [0.0, 0.0, 0.5, 0.5],
  cover: [0.5, 0.0, 1.0, 0.5],
});

/** UV rect of one grass cell. */
export function grassCellUV(name = 'tuft', pad = 0.02) {
  const [u0, v0, u1, v1] = GRASS_CELLS[name] || GRASS_CELLS.tuft;
  const du = (u1 - u0) * pad;
  const dv = (v1 - v0) * pad;
  return { u0: u0 + du, v0: v0 + dv, u1: u1 - du, v1: v1 - dv };
}

/**
 * One ground-cover card sampling a lib.grassBlade cell.
 *
 * Local space: the card stands in XY facing +Z, `w` across, `h` tall, base on y = 0
 * (root at the bottom). Blades sample with U across the card and V from root to tip.
 *
 * @param {number} w card width (m)
 * @param {number} h card height (m)
 * @param {'tuft'|'tuftTall'|'tuftDry'|'cover'} cell grass atlas cell
 */
export function grassQuad(w, h, cell = 'tuft', { bend = 0, lean = 0 } = {}) {
  const { u0, v0, u1, v1 } = grassCellUV(cell);
  const geo = new THREE.PlaneGeometry(w, h, 2, 2);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const s = pos.getX(i) / w + 0.5; // 0..1 across
    const t = pos.getY(i) / h + 0.5; // 0..1 root -> tip
    pos.setY(i, pos.getY(i) + h / 2); // base on the ground
    pos.setZ(i, Math.sin(s * Math.PI) * bend * t + lean * t * t);
    uv.setXY(i, u0 + (u1 - u0) * s, v0 + (v1 - v0) * t);
  }
  pos.needsUpdate = true;
  uv.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * One leaf-card quad sampling an atlas cell.
 *
 * Local space: the card lies in XY (facing +Z), `w` along X is the leaf length axis
 * (atlas +U), `h` along Y is the leaf width axis (atlas +V). Translate / rotate the
 * returned geometry into place. `bend` bows the card across its width (metres),
 * `droop` pulls the far end down, `twist` tilts the tip.
 *
 * @param {number} w leaf length (m)
 * @param {number} h leaf width (m)
 * @param {'broad'|'banana'|'fern'|'vine'} cell atlas cell
 */
export function leafQuad(w, h, cell = 'broad', { cols = 1, rows = 1, bend = 0, droop = 0, twist = 0 } = {}) {
  return atlasQuad(leafCellUV(cell), w, h, { cols, rows, bend, droop, twist });
}

/**
 * One canopy-cluster quad sampling a lib.canopy cell. Same local-space convention as
 * `leafQuad`: card in XY facing +Z, `w` along X is the cluster's grow axis (+U).
 *
 * @param {number} w cluster length (m)
 * @param {number} h cluster height (m)
 * @param {'sprig'|'spray'|'pale'|'dry'} cell canopy atlas cell
 */
export function canopyQuad(w, h, cell = 'sprig', { cols = 1, rows = 1, bend = 0, droop = 0, twist = 0 } = {}) {
  return atlasQuad(canopyCellUV(cell), w, h, { cols, rows, bend, droop, twist });
}

/** Shared quad builder: UVs from a cell rect, optional bend/droop/twist displacement. */
function atlasQuad(rect, w, h, { cols = 1, rows = 1, bend = 0, droop = 0, twist = 0 } = {}) {
  const { u0, v0, u1, v1 } = rect;
  const geo = new THREE.PlaneGeometry(w, h, cols, rows);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getX(i) / w + 0.5; // 0 at the base, 1 at the tip
    const s = pos.getY(i) / h + 0.5; // 0 .. 1 across the leaf
    const z = Math.sin(s * Math.PI) * bend - t * droop + twist * (s - 0.5) * (t - 0.5) * 4;
    pos.setZ(i, z);
    uv.setXY(i, u0 + (u1 - u0) * t, v0 + (v1 - v0) * s);
  }
  pos.needsUpdate = true;
  uv.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}
