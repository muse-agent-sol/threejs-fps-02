// BREACHLINE — entry point and round director.
//
// A match is a loop of short rounds. Each round: a 15-second buy phase at
// the spawns, then live play until one side is wiped, the clock runs out,
// or the breach charge — carried by one Vanguard, plantable at Site A (the
// crane bay) or Site B (the fuel depot) — detonates or is defused. Wins and
// kills pay into the next buy phase; dying costs you your rifle and armour.
// First to seven rounds takes Port Sable.
//
// This file owns the state machine, the economy, channels (plant/defuse),
// noise (bots hear shots and sprinting feet), kill bookkeeping, the death
// camera, and the ?shot= director that stages deterministic scenes for the
// entry screenshots.

import * as THREE from 'three';
import { MATCH, REWARDS, TEAMS, BOT_NAMES, BOT_BUY_TABLE, WEAPONS } from './config.js';
import { buildWorld } from './world.js';
import { Fighter, buildFigure, buildNameplate } from './actors.js';
import { PlayerController } from './player.js';
import { Bot } from './bots.js';
import { Effects } from './effects.js';
import { Viewmodel, fireWeapon } from './weapons.js';
import { Hud } from './hud.js';
import * as input from './input.js';
import * as sfx from './audio.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');

// ---------------------------------------------------------------- setup

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.08, 420);
scene.add(camera);
// A soft fill on the camera so the viewmodel and nearby faces read at dusk.
const fillLight = new THREE.PointLight(0xffe0b8, 2.4, 4.5, 1.4);
fillLight.position.set(0.1, -0.05, 0.05);
camera.add(fillLight);

const world = buildWorld(scene);
const effects = new Effects(scene);
const hud = new Hud();

const fighters = [];
const bots = [];
const playerFighter = new Fighter('atk', 'You', true);
playerFighter.money = MATCH.startMoney;
fighters.push(playerFighter);

for (const team of ['atk', 'def']) {
  const names = BOT_NAMES[team];
  const count = team === 'atk' ? MATCH.teamSize - 1 : MATCH.teamSize;
  for (let i = 0; i < count; i++) {
    const fighter = new Fighter(team, names[i]);
    fighter.money = MATCH.startMoney;
    const figure = buildFigure(fighter, TEAMS[team]);
    scene.add(figure.group);
    if (team === 'atk') {
      const plate = buildNameplate(fighter.name, '#f5a524');
      figure.group.add(plate);
    }
    const bot = new Bot(fighter, figure, world, 0.88 + ((i * 37) % 5) * 0.07);
    fighters.push(fighter);
    bots.push(bot);
  }
}

const player = new PlayerController(playerFighter, world.colliders, camera);
const viewmodel = new Viewmodel(camera);
viewmodel.show('kestrel');

const botByFighter = new Map(bots.map((b) => [b.fighter, b]));

// Raycast targets are meshes only: sprites (lamp glows, nameplates) must
// never swallow a bullet or break a sight line.
const raycastTargets = [];
world.group.traverse((obj) => { if (obj.isMesh) raycastTargets.push(obj); });
const worldMeshes = [...raycastTargets];
for (const bot of bots) {
  bot.figure.group.traverse((obj) => { if (obj.isMesh) raycastTargets.push(obj); });
}

// The player has no figure, so bots shoot at this: three invisible boxes
// (colorWrite off, still raycastable) wearing the player's fighter tag.
const playerHitbox = new THREE.Group();
{
  const ghost = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const mk = (w, h, d, y, partName) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), ghost);
    mesh.position.y = y;
    mesh.userData.part = partName;
    mesh.userData.fighter = playerFighter;
    playerHitbox.add(mesh);
    raycastTargets.push(mesh);
  };
  mk(0.38, 0.8, 0.24, 0.4, 'legs');
  mk(0.46, 0.62, 0.26, 1.09, 'body');
  mk(0.26, 0.28, 0.26, 1.58, 'head');
  scene.add(playerHitbox);
}

// The breach charge as a world object: carried, dropped, or planted.
const chargeMesh = new THREE.Group();
{
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.3, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x2c2f26, roughness: 0.6, metalness: 0.3 }),
  );
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 3 }),
  );
  lamp.position.set(0.12, 0.19, 0);
  lamp.name = 'charge-lamp';
  chargeMesh.add(body, lamp);
  chargeMesh.visible = false;
  scene.add(chargeMesh);
}

// ---------------------------------------------------------------- state

const game = {
  phase: 'menu', // menu | buy | live | planted | end | over
  now: 0,
  round: 0,
  scores: { atk: 0, def: 0 },
  lossStreak: { atk: 0, def: 0 },
  phaseEndsAt: 0,
  charge: { state: 'carried', site: null, at: null, pos: new THREE.Vector3(), detonateAt: 0, lastBeepAt: 0 },
  channels: new Map(), // fighter -> { type, site, startAt, duration }
  noiseEvents: [], // { x, z, team, radius, expiresAt }
  targetSite: 'A',
  spectating: null,
  buyOpen: false,
  over: false,
};

function positionOf(fighter) {
  if (fighter.isPlayer) return player.pos;
  return botByFighter.get(fighter).pos;
}

function eyeOf(fighter) {
  if (fighter.isPlayer) return player.eye;
  return botByFighter.get(fighter).eye;
}

const losRay = new THREE.Raycaster();
function hasLineOfSight(from, to) {
  const dir = to.clone().sub(from);
  const dist = dir.length();
  losRay.set(from, dir.normalize());
  losRay.far = dist;
  const hits = losRay.intersectObjects(worldMeshes, false);
  return hits.length === 0 || hits[0].distance >= dist - 0.3;
}

function pushNoise(x, z, team, radius, ttl = 0.3) {
  game.noiseEvents.push({ x, z, team, radius, expiresAt: game.now + ttl });
}

// ---------------------------------------------------------------- shooting

const playerGun = {
  nextShotAt: 0,
  reloadingUntil: 0,
  triggerWasDown: false,
};

function startReload(fighter, gun, now) {
  const weapon = fighter.weapon();
  if (!weapon || weapon.def.reloadTime === 0) return;
  if (weapon.mag >= weapon.def.mag || weapon.reserve <= 0) return;
  gun.reloadingUntil = now + weapon.def.reloadTime;
  sfx.playReload(weapon.def.id);
}

function finishReload(fighter, gun) {
  const weapon = fighter.weapon();
  if (!weapon) return;
  const take = Math.min(weapon.def.mag - weapon.mag, weapon.reserve);
  weapon.mag += take;
  weapon.reserve -= take;
  gun.reloadingUntil = 0;
}

function shoot(fighter, weaponState, origin, direction, muzzle, now) {
  const def = weaponState.def;
  if (weaponState.mag <= 0) return null;
  if (weaponState.mag !== Infinity) weaponState.mag -= 1;
  let spread = def.spread;
  if (fighter.isPlayer) {
    const ads = viewmodel.adsAmount > 0.5;
    spread = (ads ? def.adsSpread : def.spread) * player.spreadMult;
  } else {
    spread = def.spread * 1.1;
  }
  const victimAliveBefore = new Map(fighters.map((f) => [f, f.alive]));
  const summary = fireWeapon({
    def, shooter: fighter, origin, direction, spreadRadians: spread,
    muzzle, targets: raycastTargets, effects, now,
  });
  // Sound, placed for the player's ears.
  if (fighter.isPlayer) {
    sfx.playShot(def.id, 0, 0);
  } else {
    const p = positionOf(fighter);
    const dist = Math.hypot(p.x - player.pos.x, p.z - player.pos.z);
    const rel = Math.atan2(p.x - player.pos.x, -(p.z - player.pos.z));
    const pan = Math.sin(rel - player.yaw) * 0.8;
    sfx.playShot(def.id, dist, pan);
  }
  pushNoise(origin.x, origin.z, fighter.team, 34, 0.35);
  if (summary.anyHit && summary.hitFighter) {
    const victim = summary.hitFighter;
    if (fighter.isPlayer) {
      hud.hitmark(summary.killed, now);
      sfx.playHit(summary.killed);
    }
    if (victim.isPlayer && victim.alive) onPlayerHurt();
    if (summary.killed && victimAliveBefore.get(victim)) {
      onKill(fighter, victim, def, summary.part === 'head', now);
    }
  }
  return summary;
}

function onKill(killer, victim, def, headshot, now) {
  killer.money += REWARDS.kill;
  if (victim.lastAttacker && victim.lastAttacker !== killer && now - victim.lastDamageAt < 6) {
    victim.lastAttacker.assists += 1;
  }
  hud.kill({
    killer: killer.isPlayer ? 'You' : killer.name,
    killerTeam: killer.team,
    victim: victim.isPlayer ? 'You' : victim.name,
    victimTeam: victim.team,
    weapon: def.name,
    headshot,
  });
  const bot = botByFighter.get(victim);
  if (bot) bot.figure.die();
  if (victim.hasCharge) dropCharge(victim);
  if (victim.isPlayer) onPlayerDeath();
}

function onPlayerHurt() {
  sfx.playHurt();
  const flash = document.getElementById('flash');
  flash.style.background = '#e5484d';
  flash.style.opacity = '0.16';
  setTimeout(() => { flash.style.opacity = '0'; }, 90);
}

function onPlayerDeath() {
  viewmodel.group.visible = false;
  hud.notice('YOU ARE DOWN — SPECTATING', 3, game.now);
  const mate = bots.find((b) => b.fighter.team === 'atk' && b.fighter.alive);
  game.spectating = mate ?? null;
}

// ---------------------------------------------------------------- charge

function dropCharge(fromFighter) {
  fromFighter.hasCharge = false;
  game.charge.state = 'dropped';
  const p = positionOf(fromFighter);
  game.charge.pos.set(p.x, 0.16, p.z);
  chargeMesh.position.copy(game.charge.pos);
  chargeMesh.visible = true;
  if (fromFighter.team === 'atk') hud.notice('CHARGE DROPPED', 2, game.now);
}

function giveCharge(fighter) {
  fighter.hasCharge = true;
  game.charge.state = 'carried';
  chargeMesh.visible = false;
  if (fighter.isPlayer) hud.notice('YOU HAVE THE CHARGE — PLANT AT A OR B [E]', 3.4, game.now);
}

function plantCharge(site, planter) {
  planter.hasCharge = false;
  game.charge.state = 'planted';
  game.charge.site = site;
  game.charge.pos.set(world.sites[site].x, 0.16, world.sites[site].z);
  game.charge.detonateAt = game.now + MATCH.chargeTime;
  game.charge.lastBeepAt = 0;
  chargeMesh.position.copy(game.charge.pos);
  chargeMesh.visible = true;
  planter.money += REWARDS.plantPlanter;
  for (const f of fighters) if (f.team === 'atk') f.money += REWARDS.plantTeam;
  game.phase = 'planted';
  hud.setSiteBanner(site);
  sfx.playPlantDone();
  hud.notice(`CHARGE PLANTED AT SITE ${site}`, 3, game.now);
  pushNoise(game.charge.pos.x, game.charge.pos.z, 'atk', 40, 1);
}

// ---------------------------------------------------------------- rounds

function teamAlive(team) {
  return fighters.filter((f) => f.team === team && f.alive).length;
}

function buyForBot(bot) {
  const fighter = bot.fighter;
  const plan = BOT_BUY_TABLE.find((r) => fighter.money < r.maxMoney) ?? BOT_BUY_TABLE[BOT_BUY_TABLE.length - 1];
  const wants = fighter.money >= 3400 ? ['carbine', 'vesthelm'] : plan.buy;
  for (const id of wants) {
    if (id === 'vest') {
      if (fighter.armor < 100 && fighter.money >= 650) { fighter.money -= 650; fighter.armor = 100; }
    } else if (id === 'vesthelm') {
      if (fighter.money >= 1000) { fighter.money -= 1000; fighter.armor = 100; fighter.helmet = true; }
    } else {
      const def = WEAPONS[id];
      if (def && !fighter.hasWeapon(id) && fighter.money >= def.price) {
        fighter.money -= def.price;
        fighter.giveWeapon(id);
        fighter.currentSlot = 1;
      }
    }
  }
  if (fighter.team === 'def' && !fighter.kit && fighter.money >= 900 && Math.random() < 0.5) {
    fighter.money -= 400;
    fighter.kit = true;
  }
}

function assignPlans() {
  game.targetSite = Math.random() < 0.52 ? 'A' : 'B';
  const otherSite = game.targetSite === 'A' ? 'B' : 'A';
  const atkBots = bots.filter((b) => b.fighter.team === 'atk');
  const defBots = bots.filter((b) => b.fighter.team === 'def');
  // Attack: carrier + two escorts to the target site, one lurks mid.
  atkBots.forEach((bot, i) => {
    bot.plan = i === atkBots.length - 1
      ? { role: 'lurk', site: otherSite, postNode: 'mid_in' }
      : { role: 'push', site: game.targetSite, postNode: null };
  });
  // Defence: two posts per site, one watching mid.
  defBots.forEach((bot, i) => {
    if (i === defBots.length - 1) {
      bot.plan = { role: 'hold', site: Math.random() < 0.5 ? 'A' : 'B', postNode: 'mid_n' };
      return;
    }
    const site = i < 2 ? 'A' : 'B';
    const posts = world.sites[site].defendNodes;
    bot.plan = { role: 'hold', site, postNode: posts[i % posts.length] };
  });
}

function startRound() {
  game.round += 1;
  game.phase = 'buy';
  game.phaseEndsAt = game.now + MATCH.buyTime;
  game.channels.clear();
  game.charge.state = 'carried';
  game.charge.site = null;
  chargeMesh.visible = false;
  hud.setSiteBanner(null);
  hud.hideBanner();
  game.spectating = null;
  viewmodel.group.visible = true;

  for (const f of fighters) {
    if (!f.alive && f.deaths > 0) f.dropToSidearm();
    f.resetForRound();
    f.hasCharge = false;
  }
  // Spawns and facings: attackers look north-east into the yard, defenders south-west.
  fighters.forEach((f, i) => {
    const spawn = world.spawns[f.team][i % world.spawns[f.team].length];
    if (f.isPlayer) player.spawn(spawn, -Math.PI * 0.22);
  });
  bots.forEach((bot, i) => {
    const spawn = world.spawns[bot.fighter.team][(i + 1) % world.spawns[bot.fighter.team].length];
    bot.spawn(spawn, bot.fighter.team === 'atk' ? -Math.PI * 0.22 : Math.PI * 0.78);
  });
  // The charge goes to a random Vanguard — sometimes the player.
  const atkFighters = fighters.filter((f) => f.team === 'atk');
  const carrier = atkFighters[Math.floor(Math.random() * atkFighters.length)];
  giveCharge(carrier);
  assignPlans();
  for (const bot of bots) buyForBot(bot);
  hud.setScores(game.scores.atk, game.scores.def);
  hud.show();
  openBuy();
  hud.notice(`ROUND ${game.round} — TARGET SITE ${game.targetSite}`, 3, game.now);
}

function endRound(winner, reason) {
  game.phase = 'end';
  game.phaseEndsAt = game.now + MATCH.endTime;
  game.channels.clear();
  game.scores[winner] += 1;
  hud.setScores(game.scores.atk, game.scores.def);
  hud.setSiteBanner(null);

  const loser = winner === 'atk' ? 'def' : 'atk';
  game.lossStreak[winner] = 0;
  game.lossStreak[loser] += 1;
  const winPay = reason === 'objective' ? REWARDS.winObjective : reason === 'timeout' ? REWARDS.winTimeout : REWARDS.winElimination;
  const lossPay = REWARDS.lossBase + Math.min(REWARDS.lossStreakCap, (game.lossStreak[loser] - 1) * REWARDS.lossStreakStep);
  for (const f of fighters) {
    f.money += f.team === winner ? winPay : lossPay;
  }
  const titles = {
    elimination: ['WIPED OUT', 'TARGET NEUTRALISED'],
    objective: winner === 'atk' ? ['CHARGE DETONATED', 'PIER BREACHED'] : ['CHARGE DEFUSED', 'PIER HELD'],
    timeout: ['TIME HELD', 'THE CLOCK RAN OUT'],
  };
  const [title, sub] = titles[reason] ?? titles.elimination;
  hud.showBanner(`${TEAMS[winner].name} WINS`, `${title} — ${sub}`, winner, MATCH.endTime - 0.4, game.now);
  sfx.playRoundWin(winner === 'atk');
  if (reason === 'objective' && winner === 'atk') {
    effects.explosion(game.charge.pos.clone().setY(0.5));
    sfx.playExplosion();
    chargeMesh.visible = false;
  }
  game.charge.state = 'done';

  if (game.scores.atk >= MATCH.roundsToWin || game.scores.def >= MATCH.roundsToWin || game.round >= MATCH.maxRounds) {
    game.over = true;
  }
}

function endMatch() {
  game.phase = 'over';
  const winner = game.scores.atk === game.scores.def ? null : game.scores.atk > game.scores.def ? 'atk' : 'def';
  const menu = document.getElementById('menu');
  document.getElementById('menu-title').innerHTML = winner ? `${TEAMS[winner].name} <span>TAKES THE PIER</span>` : 'DEAD <span>HEAT</span>';
  document.querySelector('#menu .tag').textContent =
    `Final score — Vanguard ${game.scores.atk}, Harbor Watch ${game.scores.def}, over ${game.round} rounds at Port Sable. ` +
    (winner === 'atk' ? 'The vault pier is breached and the yard is yours.' : winner === 'def' ? 'The yard holds. The charge never sang.' : 'Neither crew could take the yard.');
  document.getElementById('play').textContent = 'Play again';
  menu.hidden = false;
  input.unlockPointer();
  hud.hide();
}

// ---------------------------------------------------------------- buy menu

function openBuy() {
  if (SHOT) return;
  game.buyOpen = true;
  hud.showBuy(true);
  renderBuy();
}

function closeBuy() {
  game.buyOpen = false;
  hud.showBuy(false);
}

function renderBuy() {
  hud.renderBuy(playerFighter, game.phaseEndsAt - game.now, (item) => {
    sfx.playClick();
    if (item.kind === 'weapon') {
      const def = WEAPONS[item.id];
      if (playerFighter.money >= def.price && !playerFighter.hasWeapon(item.id)) {
        playerFighter.money -= def.price;
        playerFighter.giveWeapon(item.id);
        playerFighter.currentSlot = def.slot;
        viewmodel.show(item.id);
      }
    } else if (item.kind === 'armor') {
      if (playerFighter.money >= item.price) {
        playerFighter.money -= item.price;
        playerFighter.armor = 100;
        if (item.id === 'vesthelm') playerFighter.helmet = true;
      }
    } else if (item.kind === 'gear' && item.id === 'charge') {
      if (playerFighter.money >= item.price) {
        playerFighter.money -= item.price;
        const mate = bots.find((b) => b.fighter.team === 'atk' && b.fighter.alive && !b.fighter.hasCharge);
        if (mate) giveCharge(mate.fighter);
      }
    }
    hud.setMoney(playerFighter.money);
    hud.setVitals(playerFighter);
    renderBuy();
  });
}

// ---------------------------------------------------------------- channels

function channelDuration(type, fighter) {
  if (type === 'plant') return MATCH.plantTime;
  return fighter.kit ? MATCH.defuseTimeKit : MATCH.defuseTime;
}

function startChannel(fighter, type, site) {
  game.channels.set(fighter, { type, site, startAt: game.now, duration: channelDuration(type, fighter) });
  const bot = botByFighter.get(fighter);
  if (bot) bot.channel = { type, site };
}

function cancelChannel(fighter) {
  game.channels.delete(fighter);
  const bot = botByFighter.get(fighter);
  if (bot) bot.channel = null;
}

function updateChannels() {
  // Adopt bot requests that are legal right now.
  for (const bot of bots) {
    if (!bot.channel || game.channels.has(bot.fighter) || !bot.fighter.alive) continue;
    const { type, site } = bot.channel;
    const p = bot.pos;
    const s = world.sites[site];
    const inSite = Math.hypot(p.x - s.x, p.z - s.z) <= s.radius + 1.5;
    if (type === 'plant' && game.phase === 'live' && bot.fighter.hasCharge && inSite) {
      startChannel(bot.fighter, type, site);
    } else if (type === 'defuse' && game.phase === 'planted' && game.charge.site === site && inSite) {
      startChannel(bot.fighter, type, site);
    } else {
      bot.channel = null;
    }
  }
  for (const [fighter, ch] of [...game.channels]) {
    const bot = botByFighter.get(fighter);
    const p = positionOf(fighter);
    const s = world.sites[ch.site];
    const inSite = Math.hypot(p.x - s.x, p.z - s.z) <= s.radius + 1.5;
    const hurt = fighter.lastDamageAt > ch.startAt;
    const moved = fighter.isPlayer ? player.speedNow > 1.4 : bot && bot.speedNow > 0.4;
    if (!fighter.alive || hurt || moved || !inSite) {
      cancelChannel(fighter);
      continue;
    }
    const progress = (game.now - ch.startAt) / ch.duration;
    if (fighter.isPlayer) {
      hud.setInteract(ch.type === 'plant' ? 'HOLD E — PLANTING THE CHARGE' : 'DEFUSING', Math.min(1, progress));
    }
    if (progress >= 1) {
      cancelChannel(fighter);
      if (ch.type === 'plant') {
        plantCharge(ch.site, fighter);
      } else {
        fighter.money += REWARDS.defuse;
        endRound('def', 'objective');
      }
    }
  }
  if (!game.channels.has(playerFighter)) {
    // The interact prompt also covers "you could plant here".
    if (game.phase === 'live' && playerFighter.alive && playerFighter.hasCharge) {
      const site = Object.values(world.sites).find((s) => Math.hypot(player.pos.x - s.x, player.pos.z - s.z) <= s.radius);
      hud.setInteract(site ? `HOLD E — PLANT AT SITE ${site.id}` : null, 0);
    } else {
      hud.setInteract(null, 0);
    }
  }
}

// ---------------------------------------------------------------- bot context

const botCtx = {
  get now() { return game.now; },
  get phase() { return game.phase; },
  get sites() { return world.sites; },
  get plantedSite() { return game.charge.site; },
  get noiseEvents() { return game.noiseEvents.filter((e) => e.expiresAt > game.now); },
  get defuseClear() {
    if (game.charge.state !== 'planted') return false;
    return !fighters.some((f) => f.team === 'atk' && f.alive &&
      Math.hypot(positionOf(f).x - game.charge.pos.x, positionOf(f).z - game.charge.pos.z) < 7);
  },
  rotateHint: null,
  enemiesOf(fighter) { return fighters.filter((f) => f.team !== fighter.team); },
  positionOf,
  hasLineOfSight,
  shoot(fighter, weaponState, origin, direction, muzzle, now) {
    const bot = botByFighter.get(fighter);
    if (bot && bot.reloadingUntil > now) return null;
    return shoot(fighter, weaponState, origin, direction, muzzle, now);
  },
  onReload(fighter) {
    if (fighter.isPlayer) return;
    const p = positionOf(fighter);
    const dist = Math.hypot(p.x - player.pos.x, p.z - player.pos.z);
    if (dist < 16) sfx.playReload(fighter.weapon()?.def.id ?? 'carbine');
  },
};

// ---------------------------------------------------------------- player combat

function handlePlayerCombat(dt) {
  const fighter = playerFighter;
  const weapon = fighter.weapon();
  if (!fighter.alive || !weapon) return;
  const now = game.now;

  if (playerGun.reloadingUntil > 0 && now >= playerGun.reloadingUntil) finishReload(fighter, playerGun);
  const reloading = playerGun.reloadingUntil > now;

  for (const code of input.takePresses()) {
    if (code === 'KeyR' && !reloading) startReload(fighter, playerGun, now);
    if (code === 'Digit1' || code === 'Digit2' || code === 'Digit3') {
      const slot = Number(code.slice(-1));
      if (fighter.slots.has(slot) && fighter.currentSlot !== slot) {
        fighter.currentSlot = slot;
        playerGun.reloadingUntil = 0;
        viewmodel.show(fighter.weapon().def.id);
        hud.setWeapon(fighter.weapon());
      }
    }
    if (code === 'KeyB' && game.phase === 'buy') {
      if (game.buyOpen) { closeBuy(); input.lockPointer(renderer.domElement); }
      else openBuy();
    }
  }

  const aiming = input.isAiming() && weapon.def.id !== 'blade';
  const scoped = aiming && weapon.def.scoped;
  const targetFov = scoped ? 34 : aiming ? 58 : 72;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
  camera.updateProjectionMatrix();
  player.applyLook(0.0021 * (scoped ? 0.45 : aiming ? 0.8 : 1));

  const trigger = input.isFiring() && input.isLocked(renderer.domElement);
  const canFire = !reloading && (game.phase === 'live' || game.phase === 'planted') && !game.buyOpen;
  if (trigger && canFire && now >= playerGun.nextShotAt) {
    if (weapon.mag <= 0) {
      sfx.playDryFire();
      playerGun.nextShotAt = now + 0.3;
      startReload(fighter, playerGun, now);
    } else if (weapon.def.auto || !playerGun.triggerWasDown) {
      const muzzlePos = new THREE.Vector3();
      viewmodel.muzzleWorld(muzzlePos);
      const summary = shoot(fighter, weapon, player.eye, player.lookDirection(), muzzlePos, now);
      if (summary !== null) {
        playerGun.nextShotAt = now + 60 / weapon.def.rpm;
        viewmodel.onFire(weapon.def.kick);
        player.pitch = Math.min(1.4, player.pitch + weapon.def.kick * 0.55);
        player.yaw += (Math.random() - 0.5) * weapon.def.kick * 0.2;
        if (weapon.mag <= 0) startReload(fighter, playerGun, now);
      }
    }
  }
  playerGun.triggerWasDown = trigger;

  viewmodel.update(dt, {
    speed: player.speedNow,
    ads: aiming,
    reloading,
  });
  hud.setWeapon(weapon);
}

// ---------------------------------------------------------------- per-frame update

let minimapAt = 0;
let vitalsAt = 0;

function update(dt) {
  const now = game.now;
  game.noiseEvents = game.noiseEvents.filter((e) => e.expiresAt > now);
  effects.update(dt);
  hud.tick(now);

  // Phase clock.
  if (game.phase === 'buy' && now >= game.phaseEndsAt) {
    game.phase = 'live';
    game.phaseEndsAt = now + MATCH.roundTime;
    closeBuy();
    hud.notice(`ROUND ${game.round} — LIVE`, 1.6, now);
  } else if (game.phase === 'end' && now >= game.phaseEndsAt) {
    if (game.over) endMatch();
    else startRound();
  }

  // Round-end conditions.
  if (game.phase === 'live') {
    if (teamAlive('def') === 0) endRound('atk', 'elimination');
    else if (teamAlive('atk') === 0) endRound('def', 'elimination');
    else if (now >= game.phaseEndsAt) endRound('def', 'timeout');
  } else if (game.phase === 'planted') {
    if (teamAlive('def') === 0) endRound('atk', 'elimination');
    else if (now >= game.charge.detonateAt) endRound('atk', 'objective');
    else {
      // The charge beeps faster as it runs down; its lamp strobes with it.
      const left = game.charge.detonateAt - now;
      const interval = Math.max(0.22, Math.min(1.1, left / 12));
      if (now - game.charge.lastBeepAt >= interval) {
        game.charge.lastBeepAt = now;
        sfx.playBeep(left < 3);
        const lamp = chargeMesh.getObjectByName('charge-lamp');
        if (lamp) lamp.material.emissiveIntensity = 5;
        setTimeout(() => { if (lamp) lamp.material.emissiveIntensity = 1.2; }, 90);
      }
    }
  }

  // Clock readout.
  if (game.phase === 'buy') hud.setClock(game.phaseEndsAt - now, `ROUND ${game.round} — BUY`, false);
  else if (game.phase === 'live') hud.setClock(game.phaseEndsAt - now, `ROUND ${game.round}`, game.phaseEndsAt - now < 11);
  else if (game.phase === 'planted') hud.setClock(game.charge.detonateAt - now, 'CHARGE PLANTED', true);
  else if (game.phase === 'end') hud.setClock(0, 'ROUND OVER', false);
  if (game.buyOpen) hud.updateBuyClock(playerFighter, game.phaseEndsAt - now);
  if (game.phase === 'menu' || game.phase === 'over') input.takePresses(); // stale presses never leak into a round

  // The player's hitbox follows the body, lower when crouched, gone when down.
  if (playerFighter.alive) {
    playerHitbox.position.set(player.pos.x, player.pos.y, player.pos.z);
    playerHitbox.scale.y = player.crouching ? 0.76 : 1;
  } else {
    playerHitbox.position.set(0, -60, 0);
  }

  // Player body.
  const playing = game.phase === 'buy' || game.phase === 'live' || game.phase === 'planted' || game.phase === 'end';
  if (playerFighter.alive && playing && !SHOT) {
    player.update(dt, now, { frozen: game.phase === 'end' });
    handlePlayerCombat(dt);
  } else if (!playerFighter.alive && game.spectating) {
    const bot = game.spectating;
    camera.position.copy(bot.eye);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = bot.yaw;
    camera.rotation.x = bot.pitch;
    if (!bot.fighter.alive) {
      game.spectating = bots.find((b) => b.fighter.team === 'atk' && b.fighter.alive) ?? null;
    }
  }

  // Charge pickup for the player (bots pick it up in their think step).
  if (game.charge.state === 'dropped' && game.phase === 'live') {
    for (const f of fighters) {
      if (f.team !== 'atk' || !f.alive || f.hasCharge) continue;
      const p = positionOf(f);
      if (Math.hypot(p.x - game.charge.pos.x, p.z - game.charge.pos.z) < 1.4) {
        giveCharge(f);
        break;
      }
    }
  }
  if (game.charge.state === 'carried') chargeMesh.visible = false;

  // Player plant channel: holding E inside a site with the charge.
  if (game.phase === 'live' && playerFighter.alive && playerFighter.hasCharge && input.keys.has('KeyE')) {
    const site = Object.values(world.sites).find((s) => Math.hypot(player.pos.x - s.x, player.pos.z - s.z) <= s.radius);
    if (site && !game.channels.has(playerFighter)) startChannel(playerFighter, 'plant', site.id);
  }
  if (!input.keys.has('KeyE') && game.channels.has(playerFighter)) cancelChannel(playerFighter);
  updateChannels();

  // Bots.
  if (!SHOT) {
    for (const bot of bots) bot.update(dt, now, botCtx);
    // Bot footsteps: heard, and felt through the noise system.
    for (const bot of bots) {
      if (!bot.fighter.alive || bot.speedNow < 3) continue;
      if (now - (bot.lastStepAt ?? 0) > 0.42) {
        bot.lastStepAt = now;
        pushNoise(bot.pos.x, bot.pos.z, bot.fighter.team, 11, 0.3);
        const dist = Math.hypot(bot.pos.x - player.pos.x, bot.pos.z - player.pos.z);
        if (dist < 15) sfx.playStep(dist, 0);
      }
    }
  }

  // HUD refresh on a heartbeat, minimap likewise.
  if (now - vitalsAt > 0.1) {
    vitalsAt = now;
    hud.setVitals(playerFighter);
    hud.setMoney(playerFighter.money);
  }
  if (now - minimapAt > 0.12) {
    minimapAt = now;
    hud.drawMinimap(world, fighters, positionOf, player.yaw, game.charge.state === 'planted' ? game.charge.site : null);
  }
  hud.showBoard(input.keys.has('Tab') && playing);

  // Crane hook sway, barely: the yard is not quite still.
  if (world.hook) world.hook.position.y = 6.4 + Math.sin(now * 0.4) * 0.15;
}

// ---------------------------------------------------------------- shot director

function stageFighters(list) {
  // list: [fighter, x, z, yaw, pitch]
  for (const [fighter, x, z, yaw, pitch = 0] of list) {
    if (fighter.isPlayer) {
      player.spawn({ x, z }, yaw);
      player.pitch = pitch;
      player.update(0.016, 0, { frozen: true });
      player.applyLook(0); // flush any queued look deltas
    } else {
      const bot = botByFighter.get(fighter);
      bot.spawn({ x, z }, yaw);
      bot.pitch = pitch;
      bot.syncFigure(0);
    }
  }
}

function armEveryone(primary = 'carbine') {
  for (const f of fighters) {
    f.giveWeapon(primary);
    f.currentSlot = 1;
    f.armor = 100;
  }
}

function setupShot(name) {
  document.getElementById('menu').hidden = name !== 'start';
  hud.show();
  game.scores.atk = 3;
  game.scores.def = 2;
  game.round = 6;
  hud.setScores(3, 2);
  armEveryone('carbine');
  const atk = fighters.filter((f) => f.team === 'atk');
  const def = fighters.filter((f) => f.team === 'def');

  if (name === 'start') {
    game.phase = 'menu';
    hud.hide();
    stageFighters([
      [atk[1], -30, -20, 2.4], [atk[2], -23, -26, -0.6],
      [def[0], -20, -30, 2.8], [def[1], -33, -14, 0.4],
    ]);
    return;
  }
  if (name === 'buy') {
    game.phase = 'buy';
    game.phaseEndsAt = game.now + 11;
    playerFighter.money = 3400;
    playerFighter.giveWeapon('carbine');
    playerFighter.currentSlot = 1;
    stageFighters([
      [playerFighter, -35.5, 26.5, -Math.PI * 0.22],
      [atk[1], -38.5, 23.5, -2.2], [atk[2], -34, 22.5, -2.6], [atk[3], -31.5, 24.5, -2.9], [atk[4], -37, 20.5, -2.4],
      [def[0], 36, -28, -0.8], [def[1], 33, -26, -0.4],
    ]);
    hud.showBuy(true);
    renderBuy();
    hud.setMoney(playerFighter.money);
    hud.setWeapon(playerFighter.weapon());
    hud.setClock(11, 'ROUND 6 — BUY', false);
    return;
  }
  if (name === 'play') {
    game.phase = 'live';
    game.phaseEndsAt = game.now + 47;
    playerFighter.health = 78;
    playerFighter.armor = 64;
    playerFighter.money = 2350;
    const weapon = playerFighter.weapon();
    weapon.mag = 24;
    viewmodel.show('carbine');
    stageFighters([
      [playerFighter, -19, -13, 0.675, -0.01],
      [atk[1], -16.5, -10, 0.72], [atk[2], -13, -21, 1.1],
      [def[0], -30.5, -26.5, -2.43], [def[1], -21.5, -20.5, -2.82], [def[2], -27, -31, -2.72],
    ]);
    hud.setMoney(playerFighter.money);
    hud.setWeapon(weapon);
    // The carrier went down in A-main: the charge is on the ground ahead.
    game.charge.state = 'dropped';
    game.charge.pos.set(-26.5, 0.16, -18.5);
    chargeMesh.position.copy(game.charge.pos);
    chargeMesh.visible = true;
    hud.kill({ killer: 'Petra', killerTeam: 'def', victim: 'Rook', victimTeam: 'atk', weapon: 'VK-7 Carbine', headshot: false }, true);
    hud.kill({ killer: 'You', killerTeam: 'atk', victim: 'Hollis', victimTeam: 'def', weapon: 'VK-7 Carbine', headshot: true }, true);
    hud.notice('CHARGE DROPPED — RECOVER IT', 999, game.now);
    hud.setClock(47, 'ROUND 6', false);
    return;
  }
  if (name === 'end') {
    game.phase = 'end';
    game.scores.atk = 6;
    game.scores.def = 3;
    hud.setScores(6, 3);
    game.charge.state = 'planted';
    game.charge.site = 'A';
    game.charge.pos.set(-27, 0.16, -23);
    chargeMesh.position.copy(game.charge.pos);
    chargeMesh.visible = true;
    stageFighters([
      [playerFighter, -13, -19, 1.29, -0.03],
      [atk[1], -23.5, -20.5, 1.5], [atk[2], -29.5, -25.5, 0.9],
      [def[0], -25, -18.5, 0],
    ]);
    const deadBot = botByFighter.get(def[0]);
    deadBot.fighter.alive = false;
    deadBot.figure.die();
    deadBot.figure.update(2);
    hud.showBanner('VANGUARD WINS', 'CHARGE DETONATED — PIER BREACHED', 'atk', 999, game.now);
    hud.setClock(0, 'ROUND 9 — OVER', false);
    return;
  }
  game.phase = 'live';
}

// ---------------------------------------------------------------- boot & loop

function resetMatch() {
  game.scores.atk = 0;
  game.scores.def = 0;
  game.lossStreak.atk = 0;
  game.lossStreak.def = 0;
  game.round = 0;
  game.over = false;
  for (const f of fighters) {
    f.money = MATCH.startMoney;
    f.slots.clear();
    f.giveWeapon('kestrel');
    f.giveWeapon('blade');
    f.currentSlot = 2;
    f.armor = 0;
    f.helmet = false;
    f.kit = false;
    f.kills = 0;
    f.deaths = 0;
    f.assists = 0;
    f.alive = true;
  }
  viewmodel.show('kestrel');
}

document.getElementById('play').addEventListener('click', () => {
  sfx.initAudio();
  sfx.resumeAudio();
  document.getElementById('menu').hidden = true;
  resetMatch();
  startRound();
  input.lockPointer(renderer.domElement);
});

renderer.domElement.addEventListener('click', () => {
  sfx.initAudio();
  sfx.resumeAudio();
  if ((game.phase === 'live' || game.phase === 'planted' || game.phase === 'buy') && !game.buyOpen) {
    input.lockPointer(renderer.domElement);
  }
});

input.initInput(renderer.domElement, { onFirstGesture: () => { sfx.initAudio(); sfx.resumeAudio(); } });
player.onStep = (noise) => {
  if (noise > 0.45) pushNoise(player.pos.x, player.pos.z, 'atk', 16 * noise, 0.3);
  sfx.playStep(0, 0);
};

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

if (SHOT) setupShot(SHOT);

// A small handle for automated smoke tests (and curious consoles).
window.__breachline = { game, fighters, bots, player };

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  window.__breachlineReady = true;
  const dt = Math.min(0.1, clock.getDelta());
  game.now += dt;
  if (SHOT === 'start') {
    // A slow orbit over the crane bay behind the menu.
    const t = game.now * 0.07;
    camera.position.set(-27 + Math.cos(t) * 17, 7.5, -23 + Math.sin(t) * 17);
    camera.lookAt(-27, 1, -23);
    for (const bot of bots) bot.figure.update(dt);
    effects.update(dt);
  } else if (SHOT) {
    // Staged scene: hold the tableau, keep the world breathing.
    player.update(0.0001, game.now, { frozen: true });
    hud.setVitals(playerFighter);
    hud.drawMinimap(world, fighters, positionOf, player.yaw, game.charge.state === 'planted' ? game.charge.site : null);
    effects.update(dt);
  } else {
    update(dt);
  }
  renderer.render(scene, camera);
}
frame();
