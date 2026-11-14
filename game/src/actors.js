// Fighters and figures: the shared body of the player and every bot.
//
// A Fighter is the combat state — health, armour, money, a three-slot
// loadout, round stats — with the damage rules in one place: armour absorbs
// two thirds of a hit while it lasts, a helmet softens headshots, legs take
// three quarters. A figure is the low-poly soldier other people see: boxes
// for legs, torso, arms and head in team colours, posed procedurally — walk
// swing, aim pitch, a fall when killed. Its meshes carry `userData.part`, so
// a raycast can tell a headshot from a leg shot.

import * as THREE from 'three';
import { WEAPONS } from './config.js';

let fighterSeq = 0;

export class Fighter {
  constructor(team, name, isPlayer = false) {
    this.id = ++fighterSeq;
    this.team = team; // 'atk' | 'def'
    this.name = name;
    this.isPlayer = isPlayer;
    this.health = 100;
    this.armor = 0;
    this.helmet = false;
    this.alive = true;
    this.money = 0;
    this.kit = false; // defuse kit (def) — attackers carry the charge instead
    this.hasCharge = false;
    this.kills = 0;
    this.deaths = 0;
    this.assists = 0;
    this.lastAttacker = null;
    this.lastDamageAt = -99;
    // Loadout: slot number -> { def, mag, reserve }.
    this.slots = new Map();
    this.currentSlot = 2;
    this.giveWeapon('kestrel');
    this.giveWeapon('blade');
    this.currentSlot = 2;
  }

  giveWeapon(id) {
    const def = WEAPONS[id];
    this.slots.set(def.slot, { def, mag: def.mag, reserve: def.reserve });
    return this.slots.get(def.slot);
  }

  weapon(slot = this.currentSlot) {
    return this.slots.get(slot) ?? null;
  }

  hasWeapon(id) {
    for (const w of this.slots.values()) if (w.def.id === id) return true;
    return false;
  }

  resetForRound() {
    this.health = 100;
    this.alive = true;
    this.lastAttacker = null;
    // Weapons and armour persist across rounds; the dead drop to a sidearm.
    if (!this.slots.has(1) && !this.slots.has(2)) this.giveWeapon('kestrel');
    if (!this.slots.has(3)) this.giveWeapon('blade');
    this.currentSlot = this.slots.has(1) ? 1 : 2;
    for (const w of this.slots.values()) {
      w.mag = w.def.mag;
      w.reserve = w.def.reserve;
    }
  }

  dropToSidearm() {
    this.slots.delete(1);
    if (!this.slots.has(2)) this.giveWeapon('kestrel');
    this.armor = 0;
    this.helmet = false;
    this.kit = false;
  }

  /**
   * Apply one hit. Returns { died, dealt } where dealt is the health damage
   * after armour, part multipliers and the helmet rule.
   */
  takeDamage(raw, part, attacker, now) {
    if (!this.alive) return { died: false, dealt: 0 };
    let amount = raw;
    if (part === 'head') amount *= 1; // head multiplier lives in the weapon's headMult, applied by the shooter
    if (part === 'legs') amount *= 0.75;
    if (part === 'head' && this.helmet) amount *= 0.6;
    let dealt = amount;
    if (this.armor > 0) {
      const absorbed = amount * (2 / 3);
      const armorDamage = Math.min(this.armor, absorbed);
      this.armor -= armorDamage;
      dealt = amount - armorDamage;
      if (this.armor <= 0) {
        this.armor = 0;
        dealt = amount - absorbed + (absorbed - armorDamage);
      }
    }
    dealt = Math.max(1, Math.round(dealt));
    this.health -= dealt;
    if (attacker) {
      this.lastAttacker = attacker;
      this.lastDamageAt = now;
    }
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.deaths += 1;
      if (attacker && attacker !== this) attacker.kills += 1;
      return { died: true, dealt };
    }
    return { died: false, dealt };
  }
}

const SKIN = new THREE.MeshStandardMaterial({ color: 0xc9a189, roughness: 0.8 });
const DARK = new THREE.MeshStandardMaterial({ color: 0x22252b, roughness: 0.7, metalness: 0.3 });
const BOOT = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.9 });

function part(geo, material, x, y, z, name) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.userData.part = name;
  return mesh;
}

/**
 * Build a soldier figure for a fighter. Returns handles for posing:
 * group (at the feet), aim(pitch), walk(phase, speed), die(), reset().
 */
export function buildFigure(fighter, palette) {
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: palette.color, roughness: 0.75 });
  const trim = new THREE.MeshStandardMaterial({ color: palette.trim, roughness: 0.6, emissive: palette.trim, emissiveIntensity: 0.25 });

  const legL = part(new THREE.BoxGeometry(0.17, 0.78, 0.2), DARK, -0.11, 0.39, 0, 'legs');
  const legR = part(new THREE.BoxGeometry(0.17, 0.78, 0.2), DARK, 0.11, 0.39, 0, 'legs');
  const torso = part(new THREE.BoxGeometry(0.46, 0.62, 0.26), suit, 0, 1.09, 0, 'body');
  const vest = part(new THREE.BoxGeometry(0.5, 0.4, 0.32), DARK, 0, 1.12, 0, 'body');
  const stripe = part(new THREE.BoxGeometry(0.5, 0.07, 0.33), trim, 0, 1.34, 0, 'body');
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 1.44, 0);
  const head = part(new THREE.BoxGeometry(0.24, 0.26, 0.24), SKIN, 0, 0.15, 0, 'head');
  const helmet = part(new THREE.BoxGeometry(0.3, 0.14, 0.3), suit, 0, 0.3, 0, 'head');
  const visor = part(new THREE.BoxGeometry(0.26, 0.07, 0.02), trim, 0, 0.16, 0.13, 'head');
  headPivot.add(head, helmet, visor);

  const armPivot = new THREE.Group();
  armPivot.position.set(0.16, 1.32, 0);
  const armR = part(new THREE.BoxGeometry(0.13, 0.13, 0.52), suit, 0, -0.04, 0.22, 'body');
  const armL = part(new THREE.BoxGeometry(0.13, 0.13, 0.44), suit, -0.3, -0.1, 0.2, 'body');
  armPivot.add(armR, armL);
  const gun = new THREE.Group();
  const gunBody = part(new THREE.BoxGeometry(0.07, 0.16, 0.62), DARK, 0, -0.06, 0.5, 'body');
  const gunBarrel = part(new THREE.BoxGeometry(0.04, 0.04, 0.3), BOOT, 0, -0.02, 0.95, 'body');
  const gunTip = new THREE.Object3D();
  gunTip.position.set(0, -0.02, 1.12);
  gun.add(gunBody, gunBarrel, gunTip);
  armPivot.add(gun);

  group.add(legL, legR, torso, vest, stripe, headPivot, armPivot);
  group.traverse((obj) => {
    if (obj.isMesh) obj.userData.fighter = fighter;
  });

  let deathT = -1;
  return {
    group,
    gunTip, // at the muzzle, for tracers and flashes
    setAim(pitch) {
      armPivot.rotation.x = -pitch;
      headPivot.rotation.x = -pitch * 0.6;
    },
    walk(phase, moving) {
      const swing = moving ? Math.sin(phase) * 0.5 : 0;
      legL.rotation.x = swing;
      legR.rotation.x = -swing;
      group.position.y = moving ? Math.abs(Math.sin(phase)) * 0.05 : 0;
    },
    die() {
      deathT = 0;
    },
    reset() {
      deathT = -1;
      group.rotation.set(0, 0, 0);
      group.visible = true;
    },
    update(dt) {
      if (deathT >= 0 && deathT < 1) {
        deathT = Math.min(1, deathT + dt * 2.2);
        const fall = deathT * deathT;
        group.rotation.x = -fall * (Math.PI / 2) * 0.92;
        group.position.y = -fall * 0.25;
      }
    },
    setWeaponVisible(visible) {
      gun.visible = visible;
    },
  };
}

/** A floating nameplate for teammates: canvas sprite with the callsign. */
export function buildNameplate(name, colorCss) {
  const el = document.createElement('canvas');
  el.width = 256;
  el.height = 56;
  const g = el.getContext('2d');
  g.font = '600 30px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(10,12,16,0.55)';
  const w = g.measureText(name).width + 28;
  g.fillRect((256 - w) / 2, 8, w, 40);
  g.fillStyle = colorCss;
  g.fillText(name, 128, 39);
  const texture = new THREE.CanvasTexture(el);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(1.5, 0.33, 1);
  sprite.position.y = 2.05;
  return sprite;
}
