// The player's body: first-person movement with yard physics.
//
// WASD plus mouse, with the tactical rules that make BREACHLINE play like a
// round shooter rather than an arena game: full speed is loud and wild,
// walking (Shift) is quiet and steadier, crouching is slowest and tightest,
// and you cannot steer much mid-jump. Movement resolves as a circle against
// the world's box colliders, so shoulders slide along containers instead of
// sticking to them. The controller reports a noise level and a spread
// multiplier every frame; weapons and bot ears both read them.

import * as THREE from 'three';
import { PLAYER } from './config.js';
import { resolveCollision } from './world.js';
import { moveAxes, wantsWalk, wantsCrouch, wantsJump, takeLook } from './input.js';

export class PlayerController {
  constructor(fighter, colliders, camera) {
    this.fighter = fighter;
    this.colliders = colliders;
    this.camera = camera;
    this.pos = new THREE.Vector3(0, 0, 0); // at the feet
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.grounded = true;
    this.crouching = false;
    this.eyeHeight = PLAYER.eyeHeight;
    this.stepPhase = 0;
    this.stepDistance = 0;
    this.noise = 0; // 0 silent .. 1 sprinting
    this.spreadMult = 1;
    this.speedNow = 0;
    this.lastStepAt = 0;
  }

  spawn(point, facingYaw) {
    this.pos.set(point.x, 0, point.z);
    this.vel.set(0, 0, 0);
    this.yaw = facingYaw;
    this.pitch = 0;
    this.grounded = true;
  }

  get eye() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  forward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** Consume mouse look; sensitivity scales down while scoped. */
  applyLook(sensitivity = 0.0021) {
    const { dx, dy } = takeLook();
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    const limit = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
  }

  update(dt, now, { frozen = false } = {}) {
    const axes = frozen ? { forward: 0, strafe: 0 } : moveAxes();
    this.crouching = !frozen && wantsCrouch();
    const walking = !frozen && wantsWalk();

    const targetEye = this.crouching ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 10);

    let speed = PLAYER.walkSpeed;
    if (this.crouching) speed = PLAYER.crouchSpeed;
    else if (walking) speed = PLAYER.walkQuietSpeed;

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // Wish direction in world space: forward is -Z rotated by yaw.
    const wish = new THREE.Vector3(
      (-sin * axes.forward + cos * axes.strafe),
      0,
      (-cos * axes.forward - sin * axes.strafe),
    );
    const moving = wish.lengthSq() > 0;
    if (moving) wish.normalize();

    const accel = this.grounded ? 14 : 14 * PLAYER.airControl;
    this.vel.x += wish.x * speed * accel * dt;
    this.vel.z += wish.z * speed * accel * dt;
    if (this.grounded) {
      // Ground friction: exponential approach to the wish velocity.
      const targetX = wish.x * speed;
      const targetZ = wish.z * speed;
      const blend = Math.min(1, dt * 11);
      this.vel.x += (targetX - this.vel.x) * blend;
      this.vel.z += (targetZ - this.vel.z) * blend;
      if (!frozen && wantsJump()) {
        this.vel.y = PLAYER.jumpVelocity;
        this.grounded = false;
      }
    }
    this.vel.y -= PLAYER.gravity * dt;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= 0) {
      this.pos.y = 0;
      this.vel.y = 0;
      this.grounded = true;
    }
    const resolved = resolveCollision(this.colliders, { x: this.pos.x, z: this.pos.z }, PLAYER.radius);
    this.pos.x = resolved.x;
    this.pos.z = resolved.z;

    this.speedNow = Math.hypot(this.vel.x, this.vel.z);
    const speedRatio = this.speedNow / PLAYER.walkSpeed;
    this.noise = this.grounded ? Math.min(1, speedRatio) * (this.crouching ? 0.15 : 1) : 0.4;
    // Spread: still = 1, full sprint = moveSpread (per weapon), crouch helps.
    this.spreadMult = 1 + speedRatio * 2.2 - (this.crouching ? 0.35 : 0);
    if (!this.grounded) this.spreadMult += 0.8;
    this.spreadMult = Math.max(0.6, this.spreadMult);

    // Footsteps: distance-based, so a sprint clicks out a steady rhythm.
    if (this.grounded && this.speedNow > 0.6) {
      this.stepDistance += this.speedNow * dt;
      this.stepPhase += dt * this.speedNow * 1.6;
      if (this.stepDistance > 2.3) {
        this.stepDistance = 0;
        this.lastStepAt = now;
        this.onStep?.(this.noise);
      }
    }

    // Camera: eye position, look direction, a breath of head-bob.
    const bob = this.grounded && this.speedNow > 0.6 ? Math.sin(this.stepPhase * 2) * 0.028 * Math.min(1, speedRatio) : 0;
    this.camera.position.set(this.pos.x, this.pos.y + this.eyeHeight + bob, this.pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = 0;
  }

  /** Direction the camera faces, for shots and sound panning. */
  lookDirection() {
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    return dir;
  }
}
