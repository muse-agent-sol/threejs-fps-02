// Procedural textures: every surface in Port Sable is painted in code.
//
// No image assets ship with the game, so its materials are canvas paintings:
// corrugated container steel with stencil labels and rust, cracked concrete
// with painted yard lines, crate pine, drum steel, asphalt. Each painter
// draws at 512px and the texture repeats over its mesh; the drawings are
// deterministic (a small seeded RNG) so the yard looks the same every visit.

import * as THREE from 'three';

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function canvas(size, draw) {
  const el = document.createElement('canvas');
  el.width = size;
  el.height = size;
  const g = el.getContext('2d');
  draw(g, size);
  const texture = new THREE.CanvasTexture(el);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function speckle(g, size, rand, count, color, alpha, rMin = 1, rMax = 3) {
  g.fillStyle = color;
  for (let i = 0; i < count; i++) {
    g.globalAlpha = alpha * (0.4 + rand() * 0.6);
    const r = rMin + rand() * (rMax - rMin);
    g.beginPath();
    g.arc(rand() * size, rand() * size, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

/** Corrugated container side: vertical ribs, a stencil label, rust at the feet. */
export function containerTexture(base, label, seed) {
  return canvas(512, (g, size) => {
    const rand = rng(seed);
    g.fillStyle = base;
    g.fillRect(0, 0, size, size);
    // Corrugation: alternating light and shadow ribs.
    const rib = 32;
    for (let x = 0; x < size; x += rib) {
      const grad = g.createLinearGradient(x, 0, x + rib, 0);
      grad.addColorStop(0, 'rgba(0,0,0,0.28)');
      grad.addColorStop(0.35, 'rgba(255,255,255,0.10)');
      grad.addColorStop(0.65, 'rgba(255,255,255,0.02)');
      grad.addColorStop(1, 'rgba(0,0,0,0.30)');
      g.fillStyle = grad;
      g.fillRect(x, 0, rib, size);
    }
    // Frame and corner posts.
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, 0, size, 14);
    g.fillRect(0, size - 14, size, 14);
    g.fillRect(0, 0, 16, size);
    g.fillRect(size - 16, 0, 16, size);
    // Stencil label, slightly worn.
    g.fillStyle = 'rgba(240,238,230,0.85)';
    g.font = 'bold 64px ui-monospace, monospace';
    g.textAlign = 'center';
    g.fillText(label, size / 2, 130);
    g.font = 'bold 26px ui-monospace, monospace';
    g.fillStyle = 'rgba(240,238,230,0.5)';
    g.fillText('PORT SABLE TERMINAL', size / 2, 172);
    g.fillText('MAX 30480 KG', size / 2, size - 42);
    // Rust streaks bleeding down from the top rail and the feet.
    for (let i = 0; i < 26; i++) {
      const x = rand() * size;
      const len = 30 + rand() * 130;
      const grad = g.createLinearGradient(0, 0, 0, len);
      grad.addColorStop(0, 'rgba(94,52,28,0.5)');
      grad.addColorStop(1, 'rgba(94,52,28,0)');
      g.fillStyle = grad;
      g.fillRect(x, 0, 3 + rand() * 5, len);
    }
    const foot = g.createLinearGradient(0, size - 90, 0, size);
    foot.addColorStop(0, 'rgba(60,36,20,0)');
    foot.addColorStop(1, 'rgba(60,36,20,0.55)');
    g.fillStyle = foot;
    g.fillRect(0, size - 90, size, 90);
    speckle(g, size, rand, 260, '#000000', 0.12);
    speckle(g, size, rand, 120, '#ffffff', 0.05);
  });
}

/** Yard concrete: joints, stains, and a worn painted line through the middle. */
export function concreteTexture(seed) {
  return canvas(512, (g, size) => {
    const rand = rng(seed);
    g.fillStyle = '#5a5c58';
    g.fillRect(0, 0, size, size);
    speckle(g, size, rand, 2600, '#3f413d', 0.25, 1, 5);
    speckle(g, size, rand, 1800, '#74766f', 0.2, 1, 4);
    // Expansion joints.
    g.strokeStyle = 'rgba(20,20,20,0.55)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, 2); g.lineTo(size, 2);
    g.moveTo(0, size / 2); g.lineTo(size, size / 2);
    g.moveTo(2, 0); g.lineTo(2, size);
    g.moveTo(size / 2, 0); g.lineTo(size / 2, size);
    g.stroke();
    // Cracks: a few dark polylines.
    g.strokeStyle = 'rgba(25,25,25,0.5)';
    g.lineWidth = 1.4;
    for (let i = 0; i < 5; i++) {
      let x = rand() * size;
      let y = rand() * size;
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        x += (rand() - 0.5) * 90;
        y += rand() * 46;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // Oil stains near the bottom edge.
    for (let i = 0; i < 7; i++) {
      const x = rand() * size;
      const y = size * 0.55 + rand() * size * 0.45;
      const r = 18 + rand() * 42;
      const grad = g.createRadialGradient(x, y, 2, x, y, r);
      grad.addColorStop(0, 'rgba(18,16,14,0.5)');
      grad.addColorStop(1, 'rgba(18,16,14,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** Pine crate faces with a nailed frame and a stencil arrow. */
export function crateTexture(seed) {
  return canvas(512, (g, size) => {
    const rand = rng(seed);
    g.fillStyle = '#8a6b42';
    g.fillRect(0, 0, size, size);
    const plank = size / 5;
    for (let i = 0; i < 5; i++) {
      g.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
      g.fillRect(0, i * plank, size, plank);
      g.fillStyle = 'rgba(40,26,12,0.6)';
      g.fillRect(0, i * plank, size, 3);
      // Grain.
      g.strokeStyle = 'rgba(70,48,22,0.35)';
      g.lineWidth = 1;
      for (let s = 0; s < 7; s++) {
        const y = i * plank + rand() * plank;
        g.beginPath();
        g.moveTo(0, y);
        g.bezierCurveTo(size * 0.3, y + 4, size * 0.6, y - 4, size, y + 2);
        g.stroke();
      }
    }
    // Frame battens and nails.
    g.fillStyle = 'rgba(52,34,14,0.85)';
    g.fillRect(0, 0, 26, size);
    g.fillRect(size - 26, 0, 26, size);
    g.fillRect(0, 0, size, 26);
    g.fillRect(0, size - 26, size, 26);
    g.fillStyle = '#2c2c2c';
    for (const [x, y] of [[13, 13], [size - 13, 13], [13, size - 13], [size - 13, size - 13]]) {
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(30,22,12,0.55)';
    g.font = 'bold 44px ui-monospace, monospace';
    g.textAlign = 'center';
    g.fillText('THIS SIDE UP', size / 2, size / 2 + 60);
  });
}

/** Warehouse cladding: horizontal panels, grime at the base, a big bay number. */
export function claddingTexture(base, label, seed) {
  return canvas(512, (g, size) => {
    const rand = rng(seed);
    g.fillStyle = base;
    g.fillRect(0, 0, size, size);
    const row = 42;
    for (let y = 0; y < size; y += row) {
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(0, y, size, 3);
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fillRect(0, y + 3, size, 3);
    }
    g.fillStyle = 'rgba(238,236,228,0.75)';
    g.font = 'bold 150px ui-monospace, monospace';
    g.textAlign = 'center';
    g.fillText(label, size / 2, size / 2 + 52);
    const foot = g.createLinearGradient(0, size - 120, 0, size);
    foot.addColorStop(0, 'rgba(24,20,16,0)');
    foot.addColorStop(1, 'rgba(24,20,16,0.6)');
    g.fillStyle = foot;
    g.fillRect(0, size - 120, size, 120);
    speckle(g, size, rand, 700, '#14161a', 0.16, 1, 4);
  });
}

/** Painted site marking for the ground: a ring, a letter, worn edges. */
export function sitePaintTexture(letter, color) {
  return canvas(512, (g, size) => {
    g.clearRect(0, 0, size, size);
    g.strokeStyle = color;
    g.globalAlpha = 0.85;
    g.lineWidth = 16;
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2 - 26, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = color;
    g.font = 'bold 250px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, size / 2, size / 2 + 12);
    // Wear: knock out speckles with destination-out.
    g.globalCompositeOperation = 'destination-out';
    const rand = rng(letter.charCodeAt(0) * 977);
    speckle(g, size, rand, 900, '#000', 0.5, 1, 5);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  });
}

/** A radial glow sprite for lamps and the muzzle flash light falloff. */
export function glowTexture() {
  const el = document.createElement('canvas');
  el.width = 128;
  el.height = 128;
  const g = el.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(el);
}
