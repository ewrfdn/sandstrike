/**
 * Unified model catalog for the dev model viewer / automation harness.
 *
 * Every model is defined in its own module under src/models/<group>/<id>.js;
 * this file only assembles metadata + preview builders into one array.
 */
import { WORLD_MODELS } from './world/index.js';
import { ROBOT_MODELS } from './robots/index.js';

export const MODEL_CATALOG = [
  ...WORLD_MODELS.map(({ module, stage }) => ({
    ...module.meta,
    ...(stage || {}),
    build: module.build,
  })),
  ...ROBOT_MODELS.map((entry) => ({ ...entry.meta })),
  { id: 'weapon-vxr7', kind: 'weapon', group: 'weapon', label: 'VXR-7 · 视模 VIEWMODEL', lift: true },
];

export function getModelEntry(id) {
  return MODEL_CATALOG.find((entry) => entry.id === id) || null;
}
