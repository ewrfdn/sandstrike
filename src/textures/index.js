/**
 * SANDSTRIKE // procedural texture library.
 *
 * Assembly point only: one module per material lives in this folder, so a
 * material can be iterated on in isolation. Add a new material by dropping a
 * module here and registering it in the `stages` list below.
 *
 * Public API (unchanged):
 *   const lib = await createTextureLibrary(renderer, { quality, onProgress });
 *   lib.sand.map / lib.sand.normalMap / lib.sand.roughnessMap ...
 *   lib.cloth.awning / lib.cloth.tarp / lib.cloth.shade
 *   lib.banners.a / lib.banners.b / lib.banners.title / lib.banners.warn
 *   lib.palmTrunk  (palm tree trunk: leaf-base boots)
 *   lib.decalAtlas { texture, cells } / lib.posterAtlas { texture, cells }
 *   lib.dispose()
 */
import { clearNoiseCache } from './core.js';
import { makeSand } from './sand.js';
import { makeAdobe } from './adobe.js';
import { makeStone } from './stone.js';
import { makePaving } from './paving.js';
import { makeWood } from './wood.js';
import { makeCrate } from './crate.js';
import { makeMetal } from './metal.js';
import { makeRust } from './rust.js';
import { makeSheetMetal } from './sheet-metal.js';
import { makeSandbag } from './sandbag.js';
import { makeCloth } from './cloth.js';
import { makeBanners } from './banners.js';
import { makePosterAtlas } from './posters.js';
import { makeDecalAtlas } from './decals.js';
import { makeRubber } from './rubber.js';
import { makeFrond } from './palm.js';
import { makePalmTrunk } from './palm-trunk.js';
import { makeIslandFloraTextures } from './island-flora.js';
import { makeIslandStructureTextures } from './island-structure.js';

/**
 * Build the full procedural texture library.
 * @param {THREE.WebGLRenderer} renderer used only to query max anisotropy
 * @param {{ quality?: 'medium'|'high'|'ultra', onProgress?: (p:number,label:string)=>void }} [options]
 */
export async function createTextureLibrary(renderer, { quality = 'high', onProgress } = {}) {
  const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 8;
  const aniso = Math.max(4, Math.min(maxAniso, quality === 'ultra' ? 16 : 8));

  const owned = [];
  const reg = (tex) => {
    if (tex) owned.push(tex);
    return tex;
  };
  const lib = { anisotropy: aniso, quality };
  lib.dispose = () => {
    for (const tex of owned) {
      try {
        tex.dispose();
      } catch (err) {
        /* ignore */
      }
    }
    owned.length = 0;
    clearNoiseCache();
  };

  const stages = [
    ['Sifting sand & wind ripples', () => { lib.sand = makeSand(aniso, reg); }],
    ['Cracking adobe bricks', () => { lib.adobe = makeAdobe(aniso, reg); }],
    ['Cutting sandstone blocks', () => { lib.stone = makeStone(aniso, reg); }],
    ['Laying stone paving', () => { lib.paving = makePaving(aniso, reg); }],
    ['Milling timber', () => { lib.wood = makeWood(aniso, reg); }],
    ['Stencilling crates', () => { lib.crate = makeCrate(aniso, reg); }],
    ['Scratching painted steel', () => { lib.metal = makeMetal(aniso, reg); }],
    ['Weathering rusted drums', () => { lib.rust = makeRust(aniso, reg); }],
    ['Corrugating roof sheets', () => { lib.sheet = makeSheetMetal(aniso, reg); }],
    ['Sewing sandbags', () => { lib.sandbag = makeSandbag(aniso, reg); }],
    ['Weaving cloth & awnings', () => { lib.cloth = makeCloth(aniso, reg); }],
    ['Painting site banners', () => { lib.banners = makeBanners(aniso, reg); }],
    ['Printing posters & notices', () => { lib.posterAtlas = makePosterAtlas(aniso, reg); }],
    ['Spraying decals & stencils', () => { lib.decalAtlas = makeDecalAtlas(aniso, reg); }],
    ['Casting rubber & palms', () => {
      lib.rubber = makeRubber(aniso, reg);
      lib.frond = makeFrond(aniso, reg);
    }],
    ['Peeling palm boots', () => { lib.palmTrunk = makePalmTrunk(aniso, reg); }],
    // Island map sets (src/textures/island-flora.js / island-structure.js, see
    // ISLAND_ASSETS.md §3). Both aggregators are no-ops until their authors land the
    // per-material modules; island materials fall back to existing sets meanwhile.
    ['Growing jungle undergrowth', () => { makeIslandFloraTextures(aniso, reg, lib); }],
    ['Weaving thatch & bamboo', () => { makeIslandStructureTextures(aniso, reg, lib); }],
  ];

  for (let i = 0; i < stages.length; i++) {
    onProgress?.(i / stages.length, stages[i][0]);
    stages[i][1]();
    // yield so the loading screen can repaint between heavy stages
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  onProgress?.(1, 'Materials ready');
  return lib;
}
