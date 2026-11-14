// Keyboard and mouse state, pointer lock, and the one-frame event queue.
//
// The game reads two things from here: `keys`, a live set of held codes the
// movement code polls every frame, and a queue of discrete presses (reload,
// weapon slots, buy, interact) drained once per frame by the state machine.
// Mouse look accumulates into yaw/pitch deltas the player consumes, so look
// speed never depends on frame rate.

export const keys = new Set();
const pressedQueue = [];
let lookDX = 0;
let lookDY = 0;
let firing = false;
let aiming = false;

export function initInput(canvas, { onFirstGesture } = {}) {
  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    keys.add(event.code);
    pressedQueue.push(event.code);
    if (['Tab', 'Space', 'KeyB'].includes(event.code)) event.preventDefault();
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => {
    keys.clear();
    firing = false;
    aiming = false;
  });

  canvas.addEventListener('mousedown', (event) => {
    onFirstGesture?.();
    if (event.button === 0) firing = true;
    if (event.button === 2) aiming = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) firing = false;
    if (event.button === 2) aiming = false;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  document.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement !== canvas) return;
    lookDX += event.movementX;
    lookDY += event.movementY;
  });
}

export function lockPointer(canvas) {
  if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
}

export function unlockPointer() {
  if (document.pointerLockElement) document.exitPointerLock();
}

export function isLocked(canvas) {
  return document.pointerLockElement === canvas;
}

/** Consume the accumulated mouse movement, in pixels since the last call. */
export function takeLook() {
  const out = { dx: lookDX, dy: lookDY };
  lookDX = 0;
  lookDY = 0;
  return out;
}

/** Drain the discrete key presses since the last call, as KeyboardEvent codes. */
export function takePresses() {
  return pressedQueue.splice(0, pressedQueue.length);
}

export function isFiring() {
  return firing;
}

export function isAiming() {
  return aiming;
}

export function moveAxes() {
  // Strafe/forward intent in -1..1, from the live key set.
  let forward = 0;
  let strafe = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) forward += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) forward -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) strafe += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) strafe -= 1;
  return { forward, strafe };
}

export function wantsWalk() {
  return keys.has('ShiftLeft') || keys.has('ShiftRight');
}

export function wantsCrouch() {
  return keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
}

export function wantsJump() {
  return keys.has('Space');
}
