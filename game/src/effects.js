// Transient effects: tracers, impacts, muzzle flashes, the charge going off.
//
// Everything here is pooled and short-lived — a tracer is a line that lives
// for ninety milliseconds, an impact is one glow sprite scaling up and
// fading, blood is the same sprite in dark red. No particles systems, no
// allocations in the frame loop beyond the pools cycling.

import * as THREE from 'three';
import { glowTexture } from './textures.js';

const TRACER_TTL = 0.09;
const PUFF_TTL = 0.32;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.glow = glowTexture();
    this.tracers = [];
    this.puffs = [];
    this.flashes = [];

    const tracerGeo = new THREE.BufferGeometry();
    tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    for (let i = 0; i < 28; i++) {
      const material = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const line = new THREE.Line(tracerGeo.clone(), material);
      line.visible = false;
      line.frustumCulled = false;
      scene.add(line);
      this.tracers.push({ line, ttl: 0 });
    }
    for (let i = 0; i < 40; i++) {
      const material = new THREE.SpriteMaterial({ map: this.glow, transparent: true, opacity: 0, depthWrite: false });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      scene.add(sprite);
      this.puffs.push({ sprite, ttl: 0, grow: 1, base: 0.3 });
    }
    this.flashLight = new THREE.PointLight(0xffc37a, 0, 18, 1.6);
    scene.add(this.flashLight);
    this.flashTtl = 0;
  }

  tracer(from, to, color = 0xffd9a0) {
    const slot = this.tracers.find((t) => t.ttl <= 0) ?? this.tracers[0];
    const pos = slot.line.geometry.getAttribute('position');
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    slot.line.material.color.setHex(color);
    slot.line.material.opacity = 0.85;
    slot.line.visible = true;
    slot.ttl = TRACER_TTL;
  }

  puff(at, { color = 0xcfc4ae, size = 0.32, grow = 2.2, ttl = PUFF_TTL } = {}) {
    const slot = this.puffs.find((p) => p.ttl <= 0) ?? this.puffs[0];
    slot.sprite.position.copy(at);
    slot.sprite.material.color.setHex(color);
    slot.sprite.material.opacity = 0.75;
    slot.sprite.scale.set(size, size, 1);
    slot.sprite.visible = true;
    slot.ttl = ttl;
    slot.grow = grow;
    slot.base = size;
    slot.maxTtl = ttl;
  }

  impact(at) {
    this.puff(at, { color: 0xbfb49c, size: 0.22, grow: 2.6 });
  }

  blood(at) {
    this.puff(at, { color: 0x7e161c, size: 0.3, grow: 2.0 });
    this.puff(at, { color: 0x4d0d11, size: 0.2, grow: 1.4 });
  }

  muzzle(at, big = false) {
    this.puff(at, { color: 0xffcf8a, size: big ? 0.55 : 0.38, grow: 1.6, ttl: 0.07 });
    this.flashLight.position.copy(at);
    this.flashLight.intensity = big ? 60 : 30;
    this.flashTtl = 0.05;
  }

  explosion(at) {
    for (let i = 0; i < 14; i++) {
      const offset = new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 3.5, (Math.random() - 0.5) * 5);
      this.puff(at.clone().add(offset), {
        color: i % 3 === 0 ? 0xff9a3c : 0x55483a,
        size: 1.6 + Math.random() * 2.2,
        grow: 1.8,
        ttl: 0.9 + Math.random() * 0.5,
      });
    }
    this.flashLight.position.copy(at).y += 2;
    this.flashLight.intensity = 400;
    this.flashLight.distance = 60;
    this.flashTtl = 0.4;
  }

  update(dt) {
    for (const t of this.tracers) {
      if (t.ttl <= 0) continue;
      t.ttl -= dt;
      t.line.material.opacity = Math.max(0, (t.ttl / TRACER_TTL)) * 0.85;
      if (t.ttl <= 0) t.line.visible = false;
    }
    for (const p of this.puffs) {
      if (p.ttl <= 0) continue;
      p.ttl -= dt;
      const life = Math.max(0, p.ttl / (p.maxTtl ?? PUFF_TTL));
      const scale = p.base * (1 + (1 - life) * p.grow);
      p.sprite.scale.set(scale, scale, 1);
      p.sprite.material.opacity = 0.75 * life;
      if (p.ttl <= 0) p.sprite.visible = false;
    }
    if (this.flashTtl > 0) {
      this.flashTtl -= dt;
      if (this.flashTtl <= 0) {
        this.flashLight.intensity = 0;
        this.flashLight.distance = 18;
      }
    }
  }
}
