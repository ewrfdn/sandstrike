import * as THREE from 'three';
import { ROBOT_TYPES, buildRobotRig } from './index.js';
import { createUnitGeos, disposeUnitGeos, createRobotBaseMaterials, createRigMaterialSet } from './shared.js';

// NOTE: this module imports the registry from ./index.js while index.js
// re-exports createRobotPreview from here — an intentional ES-module cycle.
// Both sides only read the other's bindings inside function bodies (never at
// module-evaluation time), so the live bindings are initialised before any call.

/* ================================================================== *
 *  DEV -- isolated chassis previews for the model stage (stage.html)
 *  Mirrors Robot._basePose plus representative aim/walk poses so a single
 *  chassis can be inspected on an empty platform from every angle.
 * ================================================================== */

export function createRobotPreview(typeKey) {
  const def = ROBOT_TYPES[typeKey];
  if (!def) throw new Error(`[stage] unknown robot type: ${typeKey}`);
  const geos = createUnitGeos();
  const baseMats = createRobotBaseMaterials();
  const rigMats = createRigMaterialSet(baseMats);
  const hitGeo = new THREE.BoxGeometry(1, 1, 1);
  const hitMat = new THREE.MeshBasicMaterial({ color: 0xff3355 });
  const rig = buildRobotRig(def, rigMats, geos, hitGeo, hitMat);
  const M = def.model;
  const p = rig.parts;

  const applyPose = (name = 'base') => {
    // neutral stand (same as Robot._basePose)
    p.pelvis.position.set(0, M.hipY, 0);
    p.pelvis.rotation.set(0, 0, 0);
    p.torso.position.set(0, M.torsoPivotY, 0);
    p.torso.rotation.set(0, 0, 0);
    p.head.position.y = M.neckY;
    p.head.rotation.set(0, 0, 0);
    p.armL.rotation.set(0.05, 0, 0.06);
    p.armR.rotation.set(0, 0, 0);
    p.gunGroup.position.set(rig.baseGunX, rig.baseGunY, rig.baseGunZ);
    p.gunGroup.rotation.set(0, 0, 0);
    p.legL.position.set(-M.hipX, M.hipY, 0);
    p.legR.position.set(M.hipX, M.hipY, 0);
    p.legL.rotation.set(0, 0, 0);
    p.legR.rotation.set(0, 0, 0);
    rig.root.position.set(0, 0, 0);
    rig.root.rotation.set(0, 0, 0);
    rig.root.scale.setScalar(1);

    if (name === 'walk') {
      // snapshot of the walk cycle at swing = 0.78 (matches _updateAnimation's formulas)
      const swing = 0.78;
      const amp = 0.45;
      p.legL.rotation.x = swing * amp;
      p.legR.rotation.x = -swing * amp;
      p.legL.position.y = M.hipY + 0.043;
      p.legL.rotation.z = 0.02;
      p.legR.rotation.z = -0.02;
      p.torso.rotation.x = 0.055;
      p.torso.rotation.z = swing * 0.02 * amp;
      p.pelvis.position.y = M.hipY + 0.032;
      p.pelvis.rotation.z = swing * 0.03 * amp;
      p.pelvis.rotation.y = swing * 0.07 * amp;
      p.armL.rotation.x = 0.05 - swing * amp * 0.6;
      p.armL.rotation.z = 0.08;
      p.armR.rotation.x = -0.05;
    } else if (name === 'aim') {
      // engagement stance: torso/head turned toward the target, weapon braced
      p.torso.rotation.y = 0.4;
      p.torso.rotation.x = -0.08;
      p.head.rotation.y = 0.16;
      p.head.rotation.x = -0.06;
      p.armR.rotation.x = -0.16;
      p.armR.rotation.z = -0.03;
      p.armL.rotation.x = 0.12;
      p.armL.rotation.z = 0.14;
      p.gunGroup.position.z = rig.baseGunZ;
    }
    rig.root.updateMatrixWorld(true);
  };

  applyPose('base');

  return {
    type: typeKey,
    def,
    rig,
    parts: p,
    hitboxes: rig.hitboxes,
    applyPose,
    setHitboxesVisible(visible = true) {
      for (let i = 0; i < rig.hitboxes.length; i++) rig.hitboxes[i].visible = !!visible;
      return rig.hitboxes.length;
    },
    dispose() {
      disposeUnitGeos(geos);
      hitGeo.dispose();
      hitMat.dispose();
      rigMats.cloned.forEach((m) => m.dispose());
      baseMats.body.dispose();
      baseMats.glow.dispose();
    },
  };
}
