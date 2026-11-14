// Port Sable: the yard itself — geometry, colliders, navigation, light.
//
// One flat freight terminal at dusk, roughly 100 by 76 metres. Two plant
// sites: A, the crane bay in the north-west, and B, the fuel depot in the
// south-east. A roofless warehouse splits the middle; three lanes (A-main
// along the north fence, B-main along the south, mid through the warehouse)
// join the spawns to the sites, with two connectors cutting between them.
//
// Every solid is an axis-aligned box in `colliders` (x1,z1,x2,z2); movement
// resolves a circle against that list, and bullets raycast the meshes. The
// nav graph's nodes all stand in open ground and its edges run in straight
// lines that clear the boxes, so a bot steering node to node never has to
// think about corners.

import * as THREE from 'three';
import { containerTexture, concreteTexture, crateTexture, claddingTexture, sitePaintTexture, glowTexture } from './textures.js';

export const WORLD = {
  minX: -49, maxX: 49, minZ: -37, maxZ: 37,
};

const CONTAINER_COLORS = [
  ['#9c3d2e', 'SABLE-7'], ['#20606b', 'NORDLYS'], ['#8a6d2f', 'K-441'],
  ['#44586e', 'HAVFRUE'], ['#71352b', 'SABLE-2'], ['#2e5e46', 'FJORD'],
];

export function buildWorld(scene) {
  const group = new THREE.Group();
  const colliders = [];
  const materials = new Map();

  const concrete = new THREE.MeshStandardMaterial({ map: concreteTexture(41), roughness: 0.94, metalness: 0.02 });
  concrete.map.repeat.set(10, 8);

  function mat(key, make) {
    if (!materials.has(key)) materials.set(key, make());
    return materials.get(key);
  }

  function box(x, z, w, d, h, material, { y = 0, collide = true, ry = 0 } = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y + h / 2, z);
    mesh.rotation.y = ry;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      // Rotated boxes register their axis-aligned footprint: the yard only
      // rotates containers by whole right angles, so this stays exact.
      const wide = Math.abs(Math.sin(ry)) > 0.5 ? d : w;
      const deep = Math.abs(Math.sin(ry)) > 0.5 ? w : d;
      colliders.push({ x1: x - wide / 2, z1: z - deep / 2, x2: x + wide / 2, z2: z + deep / 2 });
    }
    return mesh;
  }

  // --- ground, sky, light -------------------------------------------------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(110, 86), concrete);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  scene.fog = new THREE.Fog(0x2a2f3a, 55, 165);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(300, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {},
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vP;
        void main(){
          float h = normalize(vP).y;
          vec3 horizon = vec3(0.93, 0.55, 0.28);
          vec3 mid = vec3(0.36, 0.33, 0.42);
          vec3 zenith = vec3(0.10, 0.13, 0.22);
          vec3 c = h > 0.22 ? mix(mid, zenith, smoothstep(0.22, 0.75, h)) : mix(horizon, mid, smoothstep(-0.02, 0.22, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  group.add(sky);

  const hemi = new THREE.HemisphereLight(0x8fa3c7, 0x33261a, 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb066, 1.6);
  sun.position.set(-60, 34, -28);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 60;
  sun.shadow.camera.bottom = -60;
  sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x404860, 0.5));

  // --- perimeter ------------------------------------------------------------
  const fenceMat = mat('fence', () => new THREE.MeshStandardMaterial({ color: 0x39404a, roughness: 0.8, metalness: 0.4 }));
  box(0, WORLD.minZ - 1, 104, 2, 4.4, fenceMat);
  box(0, WORLD.maxZ + 1, 104, 2, 4.4, fenceMat);
  box(WORLD.minX - 1, 0, 2, 78, 4.4, fenceMat);
  box(WORLD.maxX + 1, 0, 2, 78, 4.4, fenceMat);

  // --- containers -------------------------------------------------------------
  let colorIndex = 0;
  function container(x, z, ry = 0, stack = 1, long = false) {
    const [base, label] = CONTAINER_COLORS[colorIndex++ % CONTAINER_COLORS.length];
    const tex = containerTexture(base, label, 100 + colorIndex * 17);
    tex.repeat.set(1, 1);
    const material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0.35 });
    const length = long ? 12 : 6;
    for (let level = 0; level < stack; level++) {
      box(x, z, length, 2.44, 2.59, material, { y: level * 2.59, ry, collide: level === 0 });
    }
  }

  container(-34, -14); container(-20, -30, Math.PI / 2); container(-8, -26, 0, 2, true);
  container(6, -28, 0, 1, true); container(20, -24, Math.PI / 2); container(34, -14, 0, 1, true);
  container(-36, 4, Math.PI / 2); container(-14, 2); container(16, -6, 0, 2);
  container(30, 2, Math.PI / 2); container(-24, 16, 0, 1, true); container(-4, 24, Math.PI / 2);
  container(10, 16); container(36, 28, 0, 1, true);
  // Site A ring and Site B screen.
  container(-33, -27, Math.PI / 2); container(-19, -29); container(-27, -15);
  container(21, 27); container(33, 12, Math.PI / 2);

  // --- warehouse (mid) ---------------------------------------------------------
  const clad = mat('clad', () => new THREE.MeshStandardMaterial({ map: claddingTexture('#5d6672', '07', 7), roughness: 0.7, metalness: 0.3 }));
  const wallH = 4.6;
  const wallT = 0.4;
  // North wall, door gap at x 2..5. South wall, door gap at x -4..-1.
  box(-4, -8, 12, wallT, wallH, clad); box(7.5, -8, 5, wallT, wallH, clad);
  box(-6.5, 8, 7, wallT, wallH, clad); box(4.5, 8, 11, wallT, wallH, clad);
  // West wall with a door gap at z -1..2; east wall solid.
  box(-10, -4.5, wallT, 7, wallH, clad); box(-10, 5, wallT, 6, wallH, clad);
  box(10, 0, wallT, 16, wallH, clad);
  // Roof beams only: an open shed reads better at dusk and keeps the sun in.
  const beamMat = mat('beam', () => new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.6, metalness: 0.5 }));
  for (const bx of [-9, -4.5, 0, 4.5, 9]) box(bx, 0, 0.35, 16.4, 0.35, beamMat, { y: wallH, collide: false });

  // Crates: cover everywhere, stacked in the warehouse and at both sites.
  const crateMats = [11, 23, 37].map((seed) => new THREE.MeshStandardMaterial({ map: crateTexture(seed), roughness: 0.85 }));
  let crateIndex = 0;
  function crate(x, z, size = 1.25, stack = 1) {
    for (let level = 0; level < stack; level++) {
      box(x, z, size, size, size, crateMats[crateIndex++ % crateMats.length], { y: level * size, collide: level === 0 });
    }
  }
  crate(0, 0, 1.3, 2); crate(-5, 3); crate(5, -4); crate(-3, -5, 1.1); crate(6, 4, 1.1);
  crate(-24, -19); crate(-30, -26, 1.2); crate(-21, -21);
  crate(24, 18); crate(29, 24, 1.2); crate(23, 25);
  crate(-38, 12); crate(-18, 8); crate(14, -14); crate(26, -8);
  crate(-12, 20); crate(4, 28); crate(20, 6); crate(-30, -2);
  // Low barriers: crouch cover along the lanes.
  const barrierMat = mat('barrier', () => new THREE.MeshStandardMaterial({ color: 0x707a66, roughness: 0.9 }));
  for (const [x, z, ry] of [[-28, -6, 0], [-6, -18, 0], [12, -22, Math.PI / 2], [28, -20, 0], [-20, 24, Math.PI / 2], [16, 20, 0], [-2, -24, 0], [8, 10, Math.PI / 2]]) {
    box(x, z, 2.6, 0.5, 1.05, barrierMat, { ry });
  }

  // --- Site A: the crane -------------------------------------------------------
  const craneMat = mat('crane', () => new THREE.MeshStandardMaterial({ color: 0xb3541e, roughness: 0.55, metalness: 0.45 }));
  box(-31.5, -23, 0.9, 0.9, 9.5, craneMat);
  box(-22.5, -23, 0.9, 0.9, 9.5, craneMat);
  box(-27, -23, 10.5, 1.0, 1.1, craneMat, { y: 9.0, collide: false });
  const hook = box(-27, -23, 1.4, 1.4, 1.2, beamMat, { y: 6.4, collide: false });
  hook.name = 'crane-hook';

  // --- Site B: fuel depot -------------------------------------------------------
  const tankMat = mat('tank', () => new THREE.MeshStandardMaterial({ color: 0x7a4a35, roughness: 0.5, metalness: 0.55 }));
  const tankCap = mat('tankcap', () => new THREE.MeshStandardMaterial({ color: 0x59382a, roughness: 0.6, metalness: 0.4 }));
  function tank(x, z) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 4.4, 20), tankMat);
    body.position.set(x, 2.2, z);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 0.25, 20), tankCap);
    cap.position.set(x, 4.5, z);
    group.add(cap);
    colliders.push({ x1: x - 2.2, z1: z - 2.2, x2: x + 2.2, z2: z + 2.2 });
  }
  tank(22, 16); tank(31, 25); tank(34, 14);
  const drumMat = mat('drum', () => new THREE.MeshStandardMaterial({ color: 0x37505e, roughness: 0.55, metalness: 0.5 }));
  for (const [x, z] of [[24.5, 23.5], [25.4, 24.4], [24.2, 25.2], [25.6, 23.2]]) {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.92, 12), drumMat);
    drum.position.set(x, 0.46, z);
    drum.castShadow = true;
    group.add(drum);
  }
  colliders.push({ x1: 23.8, z1: 22.8, x2: 26.1, z2: 25.8 });

  // --- lamps ---------------------------------------------------------------------
  const glow = glowTexture();
  const lampMat = mat('lamp', () => new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.5, metalness: 0.6 }));
  const bulbMat = mat('bulb', () => new THREE.MeshStandardMaterial({ color: 0xffc37a, emissive: 0xffa63e, emissiveIntensity: 2.4 }));
  const lampPositions = [[-40, -20], [-12, -30], [14, -20], [36, -26], [-40, 16], [-8, 30], [18, 28], [38, 12], [0, -16], [0, 16], [-27, -12], [27, 30]];
  lampPositions.forEach(([x, z], i) => {
    box(x, z, 0.22, 0.22, 5.4, lampMat);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), bulbMat);
    bulb.position.set(x, 5.5, z);
    group.add(bulb);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffb35c, transparent: true, opacity: 0.5, depthWrite: false }));
    sprite.position.set(x, 5.5, z);
    sprite.scale.set(4.5, 4.5, 1);
    group.add(sprite);
    if (i % 2 === 0) {
      const light = new THREE.PointLight(0xffa63e, 30, 26, 1.8);
      light.position.set(x, 5.3, z);
      group.add(light);
    }
  });

  // --- site paint ------------------------------------------------------------------
  function sitePaint(letter, color, x, z) {
    const tex = sitePaintTexture(letter, color);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 11),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(x, 0.02, z);
    plane.renderOrder = 1;
    group.add(plane);
  }
  sitePaint('A', '#f5a524', -27, -23);
  sitePaint('B', '#f5a524', 27, 21);

  scene.add(group);

  // --- navigation ---------------------------------------------------------------------
  const nodes = {
    atk_spawn: [-38, 29], yard_w: [-38, 6], a_lane: [-32, -6], a_main: [-24, -15],
    site_a: [-27, -23], crane_yard: [-27, -31], a_conn: [-12, -22], mid_n: [3, -13],
    door_n: [3.5, -8], mid_in: [0, 0], door_w: [-10.5, 0.5], a_short: [-16, -4],
    door_s: [-2.5, 8], mid_s: [-4, 16], b_conn: [8, 24], b_lane: [18, 25],
    site_b: [27, 21], b_east: [36, 10], b_short: [14, 8], tanks_w: [17, 12],
    def_b: [22, -2], def_spawn: [36, -28], def_a: [16, -26], top_mid: [24, -18],
  };
  const edges = {
    atk_spawn: ['yard_w'], yard_w: ['atk_spawn', 'a_lane'],
    a_lane: ['yard_w', 'a_main', 'a_short'], a_main: ['a_lane', 'site_a', 'a_conn'],
    site_a: ['a_main', 'crane_yard'], crane_yard: ['site_a', 'a_conn'],
    a_conn: ['a_main', 'crane_yard', 'mid_n'], mid_n: ['a_conn', 'door_n', 'def_a'],
    door_n: ['mid_n', 'mid_in'], mid_in: ['door_n', 'door_w', 'door_s'],
    door_w: ['mid_in', 'a_short'], a_short: ['door_w', 'a_lane'],
    door_s: ['mid_in', 'mid_s'], mid_s: ['door_s', 'b_conn', 'b_short'],
    b_conn: ['mid_s', 'b_lane'], b_lane: ['b_conn', 'site_b', 'b_short'],
    site_b: ['b_lane', 'b_east'], b_east: ['site_b', 'def_b', 'tanks_w'],
    b_short: ['mid_s', 'b_lane', 'def_b', 'tanks_w'], tanks_w: ['b_short', 'b_east'],
    def_b: ['b_east', 'b_short', 'def_spawn', 'top_mid'],
    def_spawn: ['def_b', 'def_a'], def_a: ['def_spawn', 'top_mid', 'mid_n'],
    top_mid: ['def_a', 'def_b'],
  };

  const spawns = {
    atk: [[-38, 29], [-40.5, 30.5], [-35.5, 30.5], [-39.5, 26.5], [-36, 26.5]].map(([x, z]) => ({ x, z })),
    def: [[36, -28], [38.5, -29.5], [33.5, -29.5], [37.5, -25.5], [34, -25.5]].map(([x, z]) => ({ x, z })),
  };

  return {
    group,
    colliders,
    nodes,
    edges,
    spawns,
    sites: {
      A: { id: 'A', x: -27, z: -23, radius: 7, defendNodes: ['site_a', 'a_main', 'crane_yard', 'a_conn'] },
      B: { id: 'B', x: 27, z: 21, radius: 7, defendNodes: ['site_b', 'b_lane', 'tanks_w', 'b_east'] },
    },
    hook,
  };
}

/** Shortest path over the nav graph, as a list of node ids (BFS). */
export function findPath(edges, from, to) {
  if (from === to) return [from];
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length > 0) {
    const at = queue.shift();
    for (const next of edges[at] ?? []) {
      if (prev.has(next)) continue;
      prev.set(next, at);
      if (next === to) {
        const path = [to];
        let cursor = at;
        while (cursor !== null) {
          path.unshift(cursor);
          cursor = prev.get(cursor);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [from];
}

export function nearestNode(nodes, x, z) {
  let best = null;
  let bestDist = Infinity;
  for (const [id, [nx, nz]] of Object.entries(nodes)) {
    const d = (nx - x) ** 2 + (nz - z) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return best;
}

/**
 * Push a circle (x, z, radius) out of every collider and the world bounds.
 * Mutates and returns the position object {x, z}.
 */
export function resolveCollision(colliders, pos, radius) {
  for (const c of colliders) {
    const nearX = Math.max(c.x1, Math.min(pos.x, c.x2));
    const nearZ = Math.max(c.z1, Math.min(pos.z, c.z2));
    const dx = pos.x - nearX;
    const dz = pos.z - nearZ;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      pos.x = nearX + (dx / d) * radius;
      pos.z = nearZ + (dz / d) * radius;
    } else {
      // Centre inside the box: leave by the shallowest face.
      const left = pos.x - c.x1;
      const right = c.x2 - pos.x;
      const top = pos.z - c.z1;
      const bottom = c.z2 - pos.z;
      const min = Math.min(left, right, top, bottom);
      if (min === left) pos.x = c.x1 - radius;
      else if (min === right) pos.x = c.x2 + radius;
      else if (min === top) pos.z = c.z1 - radius;
      else pos.z = c.z2 + radius;
    }
  }
  pos.x = Math.max(WORLD.minX + radius, Math.min(WORLD.maxX - radius, pos.x));
  pos.z = Math.max(WORLD.minZ + radius, Math.min(WORLD.maxZ - radius, pos.z));
  return pos;
}
