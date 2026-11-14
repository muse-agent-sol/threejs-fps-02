// Weapons: the viewmodel in the player's hands and the shot itself.
//
// A shot is a ray. The shooter's weapon definition supplies damage, spread,
// falloff and pellets; the shooter's state (moving, crouching, aiming)
// scales the spread cone; a seeded cone randomises each pellet. The ray is
// tested against the world meshes and every living fighter's figure, the
// nearest hit wins, and the part struck — head, body, legs — comes from the
// mesh the ray touched. Armour and helmets are the fighter's business
// (actors.js); headshot multipliers and range falloff are the weapon's.
//
// The same code fires the player's gun and every bot's, so a bot's carbine
// obeys exactly the ballistics the player feels.

import * as THREE from 'three';

const raycaster = new THREE.Raycaster();
const tmpDir = new THREE.Vector3();
const tmpOrigin = new THREE.Vector3();

function coneDirection(base, radians) {
  // Two small random deflections on perpendicular axes: a round-ish cone.
  const dir = base.clone();
  if (radians <= 0) return dir;
  const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(dir, up).normalize();
  const top = new THREE.Vector3().crossVectors(side, dir).normalize();
  const a = (Math.random() * 2 - 1) * radians;
  const b = (Math.random() * 2 - 1) * radians;
  dir.addScaledVector(side, a).addScaledVector(top, b).normalize();
  return dir;
}

function falloffAt(def, distance) {
  if (distance <= def.falloffStart) return 1;
  if (distance >= def.falloffEnd) return def.falloffMin;
  const t = (distance - def.falloffStart) / (def.falloffEnd - def.falloffStart);
  return 1 + (def.falloffMin - 1) * t;
}

/**
 * Fire one trigger pull. `targets` is the list of raycast roots (world group
 * plus every figure group). Returns a summary for feedback:
 * { hitFighter, part, killed, damage } of the best pellet.
 */
export function fireWeapon({ def, shooter, origin, direction, spreadRadians, muzzle, targets, effects, now }) {
  const summary = { hitFighter: null, part: null, killed: false, damage: 0, anyHit: false };
  effects.muzzle(muzzle, def.id === 'breach12' || def.id === 'longbow');
  for (let pellet = 0; pellet < def.pellets; pellet++) {
    const dir = coneDirection(direction, spreadRadians);
    raycaster.set(origin, dir);
    raycaster.far = def.range;
    const hits = raycaster.intersectObjects(targets, true);
    let end = origin.clone().addScaledVector(dir, def.range);
    for (const hit of hits) {
      const fighter = hit.object.userData.fighter;
      if (fighter === shooter) continue;
      if (fighter && !fighter.alive) continue;
      end = hit.point;
      if (fighter) {
        const part = hit.object.userData.part ?? 'body';
        let raw = def.damage * falloffAt(def, hit.distance);
        if (part === 'head') raw *= def.headMult;
        const result = fighter.takeDamage(raw, part, shooter, now);
        effects.blood(hit.point);
        summary.anyHit = true;
        if (result.dealt >= summary.damage) {
          summary.hitFighter = fighter;
          summary.part = part;
          summary.damage = result.dealt;
        }
        if (result.died) summary.killed = true;
      } else {
        effects.impact(hit.point);
      }
      break; // nearest valid hit stops the pellet
    }
    if (def.id !== 'blade') effects.tracer(muzzle, end, shooter.team === 'atk' ? 0xffd9a0 : 0xa8d8ff);
  }
  return summary;
}

// --- viewmodel ---------------------------------------------------------------

const GUN_DARK = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.45, metalness: 0.55 });
const GUN_ACCENT = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.4, metalness: 0.6 });
const HAND = new THREE.MeshStandardMaterial({ color: 0x8a6a52, roughness: 0.85 });
const SLEEVE = new THREE.MeshStandardMaterial({ color: 0xd9822b, roughness: 0.8 });

const SILHOUETTES = {
  kestrel: { body: [0.05, 0.11, 0.24], barrel: 0.1, sight: true },
  sidekick: { body: [0.055, 0.13, 0.27], barrel: 0.12, sight: true },
  hornet: { body: [0.06, 0.15, 0.46], barrel: 0.2, sight: false },
  breach12: { body: [0.07, 0.14, 0.62], barrel: 0.3, sight: true },
  carbine: { body: [0.06, 0.16, 0.58], barrel: 0.26, sight: true },
  longbow: { body: [0.06, 0.17, 0.78], barrel: 0.4, sight: true, scope: true },
  blade: { body: [0.02, 0.05, 0.3], barrel: 0, sight: false },
};

export class Viewmodel {
  constructor(camera) {
    this.camera = camera;
    this.group = new THREE.Group();
    this.group.position.set(0.25, -0.235, -0.5);
    this.group.scale.setScalar(0.72);
    camera.add(this.group);
    this.muzzle = new THREE.Object3D();
    this.currentId = null;
    this.kick = 0;
    this.bobPhase = 0;
    this.adsAmount = 0;
    this.reloadDip = 0;
    this.builds = new Map();
  }

  build(id) {
    const s = SILHOUETTES[id] ?? SILHOUETTES.carbine;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(...s.body), GUN_DARK);
    g.add(body);
    if (s.barrel > 0) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, s.barrel, 8), GUN_ACCENT);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.03, -s.body[2] / 2 - s.barrel / 2);
      g.add(barrel);
    }
    if (s.sight) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.05, 0.012), GUN_ACCENT);
      post.position.set(0, s.body[1] / 2 + 0.025, -s.body[2] / 2 + 0.03);
      g.add(post);
    }
    if (s.scope) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.22, 10), GUN_DARK);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0, s.body[1] / 2 + 0.045, 0.02);
      g.add(tube);
    }
    if (id !== 'blade') {
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.07), GUN_ACCENT);
      mag.position.set(0, -0.12, 0.02);
      mag.rotation.x = 0.16;
      g.add(mag);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.13, 0.05), GUN_DARK);
      grip.position.set(0, -0.1, 0.12);
      grip.rotation.x = 0.35;
      g.add(grip);
      const handR = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.09), HAND);
      handR.position.set(0.01, -0.1, 0.13);
      g.add(handR);
      const handL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.08), HAND);
      handL.position.set(-0.02, -0.05, -s.body[2] / 2 + 0.08);
      g.add(handL);
      const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.16), SLEEVE);
      sleeve.position.set(-0.02, -0.07, -s.body[2] / 2 + 0.2);
      g.add(sleeve);
    } else {
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.1, 0.04), GUN_DARK);
      grip.position.set(0, -0.06, 0.1);
      g.add(grip);
      const handR = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.09), HAND);
      handR.position.set(0, -0.07, 0.11);
      g.add(handR);
    }
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.03, -s.body[2] / 2 - s.barrel - 0.02);
    g.add(muzzle);
    g.visible = false;
    this.group.add(g);
    this.builds.set(id, { group: g, muzzle });
    return this.builds.get(id);
  }

  show(id) {
    if (this.currentId === id) return;
    for (const [key, built] of this.builds) built.group.visible = key === id;
    if (!this.builds.has(id)) this.build(id).group.visible = true;
    this.currentId = id;
    this.muzzle = this.builds.get(id).muzzle;
  }

  muzzleWorld(out) {
    return this.muzzle.getWorldPosition(out);
  }

  onFire(kick) {
    this.kick = Math.min(0.09, this.kick + kick * 1.6);
  }

  update(dt, { speed = 0, ads = false, reloading = false } = {}) {
    this.kick = Math.max(0, this.kick - dt * 0.55);
    this.bobPhase += dt * (2 + speed * 1.7);
    this.adsAmount += ((ads ? 1 : 0) - this.adsAmount) * Math.min(1, dt * 11);
    this.reloadDip += ((reloading ? 1 : 0) - this.reloadDip) * Math.min(1, dt * 7);
    const bobY = Math.sin(this.bobPhase * 2) * 0.006 * Math.min(1, speed / 4);
    const bobX = Math.cos(this.bobPhase) * 0.005 * Math.min(1, speed / 4);
    const hip = { x: 0.25, y: -0.235, z: -0.5 };
    const aimed = { x: 0, y: -0.155, z: -0.42 };
    const t = this.adsAmount;
    this.group.position.set(
      hip.x + (aimed.x - hip.x) * t + bobX * (1 - t),
      hip.y + (aimed.y - hip.y) * t + bobY * (1 - t) - this.reloadDip * 0.13,
      hip.z + (aimed.z - hip.z) * t + this.kick,
    );
    this.group.rotation.x = this.reloadDip * 0.5 + this.kick * 1.4;
    this.group.rotation.z = this.reloadDip * 0.18;
  }
}
