// Bot crews: perception, plans, and trigger discipline.
//
// A bot is a Fighter with a body and a small mind. It thinks four times a
// second: what can I see (a real line-of-sight ray against the world), what
// have I heard (gunfire and sprinting feet carry), what is my plan. Plans
// are dealt by the round at spawn: attackers push a site behind the charge
// carrier or lurk mid; defenders hold posts at both sites and mid, then
// rotate on information — a plant, a kill, a teammate's call. In a fight a
// bot stops, settles its aim over a human reaction time, and fires bursts;
// its spread and ballistics are the player's own (weapons.js), only its aim
// error and nerve differ. Skill varies per bot so Rook is not Petra.

import * as THREE from 'three';
import { findPath, nearestNode, resolveCollision } from './world.js';
import { PLAYER } from './config.js';

const EYE = 1.52;
const SPEED = 4.15;
const ARRIVE = 0.7;

export class Bot {
  constructor(fighter, figure, world, skill = 1) {
    this.fighter = fighter;
    this.figure = figure;
    this.world = world;
    this.skill = skill; // 0.85 shaky .. 1.15 sharp
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.walkPhase = 0;
    this.speedNow = 0;
    this.path = [];
    this.pathIndex = 0;
    this.moveGoal = null; // {x, z} final stand point
    this.plan = { role: 'hold', site: 'A', postNode: null };
    this.target = null; // fighter currently visible
    this.lastSeen = null; // { fighter, pos, at }
    this.aimAt = new THREE.Vector3();
    this.aimSettle = 0; // seconds the current target has been tracked
    this.nextThinkAt = 0;
    this.nextShotAt = 0;
    this.burstLeft = 0;
    this.burstPauseUntil = 0;
    this.reloadingUntil = 0;
    this.channel = null; // { type: 'plant'|'defuse', site } requested of the round
    this.laneOffset = ((fighter.id * 37) % 5 - 2) * 0.38; // personal lane so a push is a file, not a stack
    this.holdUntil = 0;
    this.strafeDir = 1;
    this.strafeFlipAt = 0;
    this.noise = 0;
  }

  spawn(point, facingYaw) {
    this.pos.set(point.x, 0, point.z);
    this.yaw = facingYaw;
    this.pitch = 0;
    this.path = [];
    this.target = null;
    this.lastSeen = null;
    this.channel = null;
    this.figure.reset();
    this.syncFigure(0);
  }

  get eye() {
    return new THREE.Vector3(this.pos.x, EYE, this.pos.z);
  }

  currentNode() {
    return nearestNode(this.world.nodes, this.pos.x, this.pos.z);
  }

  goTo(nodeId) {
    const from = this.currentNode();
    this.path = findPath(this.world.edges, from, nodeId);
    this.pathIndex = this.path[0] === from ? 1 : 0;
    this.moveGoal = null;
  }

  goToPoint(x, z) {
    const nodeId = nearestNode(this.world.nodes, x, z);
    this.goTo(nodeId);
    const [nx, nz] = this.world.nodes[nodeId];
    this.moveGoal = Math.hypot(nx - x, nz - z) > 0.4 ? { x, z } : null;
  }

  pathTarget() {
    if (this.pathIndex < this.path.length) {
      const [x, z] = this.world.nodes[this.path[this.pathIndex]];
      return { x, z, node: true };
    }
    return this.moveGoal;
  }

  arrived() {
    return this.pathIndex >= this.path.length && this.moveGoal === null;
  }

  // --- perception ------------------------------------------------------------

  perceive(now, ctx) {
    let best = null;
    let bestDist = Infinity;
    for (const enemy of ctx.enemiesOf(this.fighter)) {
      if (!enemy.alive) continue;
      const ePos = ctx.positionOf(enemy);
      const dist = Math.hypot(ePos.x - this.pos.x, ePos.z - this.pos.z);
      if (dist > 58) continue;
      // Facing check: bots watch a wide cone, wider up close.
      const toEnemy = Math.atan2(-(ePos.x - this.pos.x), -(ePos.z - this.pos.z));
      let facing = Math.abs(((toEnemy - this.yaw) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
      if (facing > 1.9 && dist > 7) continue;
      const eyeTarget = new THREE.Vector3(ePos.x, (enemy.isPlayer ? 1.35 : 1.25), ePos.z);
      if (!ctx.hasLineOfSight(this.eye, eyeTarget)) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = { fighter: enemy, pos: ePos.clone(), dist };
      }
    }
    if (best) {
      if (this.lastSeen?.fighter !== best.fighter) this.aimSettle = 0;
      this.target = best.fighter;
      this.lastSeen = { fighter: best.fighter, pos: best.pos, at: now, dist: bestDist };
    } else {
      this.target = null;
    }
    // Hearing: the round passes noise events (shots, sprints) with positions.
    for (const event of ctx.noiseEvents) {
      if (event.team === this.fighter.team) continue;
      const dist = Math.hypot(event.x - this.pos.x, event.z - this.pos.z);
      if (dist < event.radius && (this.lastSeen === null || now - this.lastSeen.at > 1.2)) {
        this.lastSeen = { fighter: null, pos: new THREE.Vector3(event.x, 0, event.z), at: now, dist };
      }
    }
  }

  // --- combat ------------------------------------------------------------------

  combatStep(dt, now, ctx) {
    const weapon = this.fighter.weapon();
    if (!weapon || this.channel) return;
    if (now < this.reloadingUntil) return;
    if (weapon.mag <= 0) {
      this.startReload(now, ctx);
      return;
    }
    const seen = this.lastSeen;
    const fresh = seen && now - seen.at < 0.4 && this.target;
    if (!fresh) return;
    this.aimSettle += dt;
    const targetPos = ctx.positionOf(this.target);
    const dist = Math.hypot(targetPos.x - this.pos.x, targetPos.z - this.pos.z);
    // Aim point: chest, drifting to the head as the settle completes.
    const settleNeed = 0.38 / this.skill;
    const settled = Math.min(1, this.aimSettle / settleNeed);
    const aimHeight = this.target.isPlayer ? 1.3 : 1.22 + settled * 0.28;
    this.aimAt.set(targetPos.x, aimHeight, targetPos.z);
    const desiredYaw = Math.atan2(-(this.aimAt.x - this.pos.x), -(this.aimAt.z - this.pos.z));
    this.yaw = turnToward(this.yaw, desiredYaw, dt * 9);
    const eyePos = this.eye;
    this.pitch = Math.atan2(this.aimAt.y - eyePos.y, Math.hypot(this.aimAt.x - eyePos.x, this.aimAt.z - eyePos.z));

    if (this.aimSettle < 0.3 / this.skill) return; // still reacting
    if (now < this.burstPauseUntil || now < this.nextShotAt) return;
    if (this.burstLeft <= 0) {
      // Burst length scales down with range: taps at distance, dumps up close.
      this.burstLeft = dist > 26 ? 2 : dist > 13 ? 3 : 5;
    }
    // Aim error: settles from wild to tight; worse when the target is far.
    const error = (0.055 - settled * 0.04) / this.skill + dist * 0.0006;
    const dir = this.aimAt.clone().sub(eyePos).normalize();
    dir.x += (Math.random() * 2 - 1) * error;
    dir.y += (Math.random() * 2 - 1) * error * 0.7;
    dir.z += (Math.random() * 2 - 1) * error;
    dir.normalize();
    const muzzle = new THREE.Vector3();
    this.figure.gunTip.getWorldPosition(muzzle);
    const summary = ctx.shoot(this.fighter, weapon, eyePos, dir, muzzle, now);
    if (summary === null) return; // out of ammo mid-burst: reload handled above
    this.burstLeft -= 1;
    this.nextShotAt = now + 60 / weapon.def.rpm;
    if (this.burstLeft <= 0) this.burstPauseUntil = now + (0.34 + Math.random() * 0.3) / this.skill;
    if (weapon.mag <= 0) this.startReload(now, ctx);
  }

  startReload(now, ctx) {
    const weapon = this.fighter.weapon();
    if (!weapon || weapon.reserve <= 0 || weapon.mag >= weapon.def.mag) return;
    this.reloadingUntil = now + weapon.def.reloadTime;
    ctx.onReload(this.fighter);
    // The reload completes in updateTimers, called by the round each frame.
  }

  updateTimers(now) {
    const weapon = this.fighter.weapon();
    if (weapon && this.reloadingUntil > 0 && now >= this.reloadingUntil) {
      const take = Math.min(weapon.def.mag - weapon.mag, weapon.reserve);
      weapon.mag += take;
      weapon.reserve -= take;
      this.reloadingUntil = 0;
    }
  }

  // --- plan execution -------------------------------------------------------------

  planStep(now, ctx) {
    if (this.target) return; // fighting: hold ground, combatStep handles the gun
    const plan = this.plan;
    const site = ctx.sites[plan.site];
    if (ctx.phase !== 'live' && ctx.phase !== 'planted') return;

    if (this.fighter.team === 'atk') {
      if (ctx.phase === 'planted') {
        // Hold near the charge, but far enough back that a defuser has to
        // come and take the ground: the outer defend nodes, not the ring.
        const planted = ctx.sites[ctx.plantedSite];
        const outer = planted.defendNodes.slice(2);
        if (!outer.includes(this.currentNode()) && this.arrived()) {
          this.goTo(outer[Math.floor(Math.random() * outer.length)]);
        }
        return;
      }
      if (this.fighter.hasCharge) {
        // Carrier: get into the site ring, then plant.
        const d = Math.hypot(this.pos.x - site.x, this.pos.z - site.z);
        if (d > site.radius * 0.55) {
          if (this.arrived()) this.goToPoint(site.x + 1.5, site.z + 1);
        } else if (!this.channel) {
          this.channel = { type: 'plant', site: plan.site };
        }
        return;
      }
      // Escort / lurk: move with the push; the lurker's post is mid itself.
      const destination = plan.role === 'lurk' ? 'mid_in' : siteNodeFor(plan.site);
      if (this.arrived() && this.currentNode() !== destination) {
        this.goTo(destination);
      }
      return;
    }

    // Defenders.
    if (ctx.phase === 'planted') {
      const planted = ctx.sites[ctx.plantedSite];
      const d = Math.hypot(this.pos.x - planted.x, this.pos.z - planted.z);
      if (d > planted.radius * 0.6) {
        if (this.arrived()) this.goToPoint(planted.x - 1.5, planted.z - 1);
      } else if (!this.channel && ctx.defuseClear) {
        this.channel = { type: 'defuse', site: ctx.plantedSite };
      }
      return;
    }
    if (plan.role === 'rotate' && ctx.rotateHint === plan.site) {
      if (this.arrived()) this.goTo(siteNodeFor(plan.site));
      return;
    }
    if (this.arrived() && plan.postNode && this.currentNode() !== plan.postNode) {
      this.goTo(plan.postNode);
    }
    // Investigate a heard contact near the post.
    if (this.lastSeen && now - this.lastSeen.at < 3 && !this.lastSeen.fighter) {
      const near = nearestNode(this.world.nodes, this.lastSeen.pos.x, this.lastSeen.pos.z);
      if (this.arrived()) this.goTo(near);
    }
  }

  // --- movement ---------------------------------------------------------------------

  moveStep(dt, now) {
    let moving = false;
    let speedTarget = 0;
    const fighting = this.target !== null && now - (this.lastSeen?.at ?? -9) < 0.4;
    if (this.channel) {
      speedTarget = 0;
    } else if (fighting) {
      // Fight on the spot with a small strafe so a duel is not a turkey shoot.
      if (now > this.strafeFlipAt) {
        this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        this.strafeFlipAt = now + 0.7 + Math.random() * 0.9;
      }
      const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      this.pos.addScaledVector(side, this.strafeDir * dt * 1.1);
      speedTarget = 1.1;
      moving = true;
    } else {
      const goal = this.pathTarget();
      if (goal) {
        // Aim at a point shifted sideways by the bot's lane offset,
        // perpendicular to the line of travel so the offset is stable.
        const rawX = goal.x - this.pos.x;
        const rawZ = goal.z - this.pos.z;
        const rawDist = Math.hypot(rawX, rawZ) || 1;
        const gx = goal.x + (-rawZ / rawDist) * this.laneOffset;
        const gz = goal.z + (rawX / rawDist) * this.laneOffset;
        const dx = gx - this.pos.x;
        const dz = gz - this.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < ARRIVE) {
          if (goal.node) this.pathIndex += 1;
          else this.moveGoal = null;
        } else {
          const desiredYaw = Math.atan2(-dx, -dz);
          this.yaw = turnToward(this.yaw, desiredYaw, dt * 7);
          speedTarget = SPEED;
          this.pos.x += (dx / dist) * SPEED * dt;
          this.pos.z += (dz / dist) * SPEED * dt;
          moving = true;
        }
      }
    }
    const resolved = resolveCollision(this.world.colliders, { x: this.pos.x, z: this.pos.z }, PLAYER.radius);
    this.pos.x = resolved.x;
    this.pos.z = resolved.z;
    this.speedNow = moving ? speedTarget : 0;
    this.noise = this.speedNow > 3 ? 0.8 : this.speedNow > 0.5 ? 0.3 : 0;
    if (moving) this.walkPhase += dt * this.speedNow * 1.7;
    this.syncFigure(dt);
  }

  syncFigure(dt) {
    this.figure.group.position.set(this.pos.x, 0, this.pos.z);
    this.figure.group.rotation.y = this.yaw;
    this.figure.setAim(this.pitch);
    this.figure.walk(this.walkPhase, this.speedNow > 0.3);
    this.figure.update(dt);
  }

  update(dt, now, ctx) {
    if (!this.fighter.alive) {
      this.figure.update(dt);
      return;
    }
    this.updateTimers(now);
    if (now >= this.nextThinkAt) {
      this.nextThinkAt = now + 0.14;
      this.perceive(now, ctx);
      this.planStep(now, ctx);
    }
    this.combatStep(dt, now, ctx);
    this.moveStep(dt, now);
  }
}

function siteNodeFor(site) {
  return site === 'A' ? 'site_a' : 'site_b';
}

function turnToward(current, target, maxStep) {
  let delta = ((target - current) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  delta = Math.max(-maxStep, Math.min(maxStep, delta));
  return current + delta;
}
