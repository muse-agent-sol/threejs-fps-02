// BREACHLINE's numbers: teams, weapons, economy, round flow.
//
// Everything tunable lives here so the rest of the code reads as rules, not
// constants. Damage is tuned for short rounds: a rifle kills in one headshot
// or four body shots, armour absorbs two thirds of a hit until it breaks,
// and accuracy is the economy of the game — moving multiplies spread hard,
// crouching and standing still are how you earn a tight cone.

export const TEAMS = {
  atk: {
    id: 'atk',
    name: 'VANGUARD',
    short: 'VAN',
    color: 0xd9822b, // rust orange
    trim: 0xf5a524,
    spawnLabel: 'Vanguard staging',
  },
  def: {
    id: 'def',
    name: 'HARBOR WATCH',
    short: 'HW',
    color: 0x2e6da4, // harbour blue
    trim: 0x57b7e8,
    spawnLabel: 'Watch post',
  },
};

export const MATCH = {
  teamSize: 5, // per side, the player included on attack
  roundsToWin: 7,
  maxRounds: 12,
  startMoney: 800,
  roundTime: 100, // seconds of live play
  buyTime: 15,
  endTime: 5, // banner time between rounds
  plantTime: 3.0,
  defuseTime: 5.0,
  defuseTimeKit: 2.5,
  chargeTime: 35, // seconds from plant to detonation
  freezeTime: 1.2, // a breath at live start
};

export const REWARDS = {
  winElimination: 3000,
  winObjective: 3250, // plant detonated / charge defused
  winTimeout: 3000, // defenders hold the clock
  lossBase: 1900,
  lossStreakStep: 500, // +500 per consecutive loss beyond the first, capped
  lossStreakCap: 1400,
  kill: 300,
  plantPlanter: 300,
  plantTeam: 800,
  defuse: 300,
};

// slot: 1 primary, 2 sidearm, 3 blade. rpm: rounds per minute. spread is in
// radians at the hip; adsSpread applies while aiming down the scope/sights.
// falloff: damage multiplier at falloffStart..falloffEnd metres.
export const WEAPONS = {
  kestrel: {
    id: 'kestrel', name: 'P9 Kestrel', slot: 2, price: 0,
    blurb: 'Standard sidearm. Free, honest, slow.',
    damage: 34, headMult: 3.2, rpm: 320, auto: false,
    mag: 12, reserve: 48, reloadTime: 1.5,
    spread: 0.011, adsSpread: 0.004, moveSpread: 3.2,
    range: 42, falloffStart: 14, falloffEnd: 40, falloffMin: 0.55,
    pellets: 1, kick: 0.011, weight: 1.0,
  },
  sidekick: {
    id: 'sidekick', name: 'Sidekick .45', slot: 2, price: 700,
    blurb: 'Heavy pistol. Two body shots at close range.',
    damage: 53, headMult: 3.0, rpm: 260, auto: false,
    mag: 8, reserve: 32, reloadTime: 1.7,
    spread: 0.013, adsSpread: 0.005, moveSpread: 3.4,
    range: 46, falloffStart: 12, falloffEnd: 38, falloffMin: 0.5,
    pellets: 1, kick: 0.02, weight: 1.05,
  },
  hornet: {
    id: 'hornet', name: 'Hornet SMG', slot: 1, price: 1500,
    blurb: 'Fast, light, hungry. Owns the warehouse corners.',
    damage: 26, headMult: 2.6, rpm: 820, auto: true,
    mag: 32, reserve: 96, reloadTime: 2.1,
    spread: 0.02, adsSpread: 0.009, moveSpread: 2.4,
    range: 38, falloffStart: 10, falloffEnd: 32, falloffMin: 0.45,
    pellets: 1, kick: 0.008, weight: 0.92,
  },
  breach12: {
    id: 'breach12', name: 'Breach-12', slot: 1, price: 1100,
    blurb: 'Door gun. Eight pellets, one argument, very close.',
    damage: 15, headMult: 1.6, rpm: 68, auto: false,
    mag: 6, reserve: 24, reloadTime: 2.9,
    spread: 0.05, adsSpread: 0.038, moveSpread: 2.8,
    range: 22, falloffStart: 5, falloffEnd: 16, falloffMin: 0.25,
    pellets: 8, kick: 0.05, weight: 1.1,
  },
  carbine: {
    id: 'carbine', name: 'VK-7 Carbine', slot: 1, price: 2700,
    blurb: 'The rifle the yard is balanced around. Tap, do not spray.',
    damage: 33, headMult: 3.05, rpm: 640, auto: true,
    mag: 30, reserve: 90, reloadTime: 2.4,
    spread: 0.013, adsSpread: 0.0035, moveSpread: 3.6,
    range: 90, falloffStart: 26, falloffEnd: 80, falloffMin: 0.62,
    pellets: 1, kick: 0.013, weight: 1.0,
  },
  longbow: {
    id: 'longbow', name: 'Longbow DMR', slot: 1, price: 3200,
    blurb: 'Scoped marksman rifle. One head, one body at any pier range.',
    damage: 78, headMult: 2.4, rpm: 92, auto: false,
    mag: 10, reserve: 30, reloadTime: 2.8,
    spread: 0.016, adsSpread: 0.0006, moveSpread: 5.0,
    range: 140, falloffStart: 40, falloffEnd: 130, falloffMin: 0.8,
    pellets: 1, kick: 0.045, weight: 1.12, scoped: true,
  },
  blade: {
    id: 'blade', name: 'Yard Blade', slot: 3, price: 0,
    blurb: 'Last argument. Silent, and it pays double.',
    damage: 55, headMult: 1.0, rpm: 110, auto: false,
    mag: Infinity, reserve: Infinity, reloadTime: 0,
    spread: 0, adsSpread: 0, moveSpread: 1,
    range: 2.1, falloffStart: 2.1, falloffEnd: 2.1, falloffMin: 1,
    pellets: 1, kick: 0, weight: 0.85,
  },
};

export const BUY_MENU = [
  { kind: 'weapon', id: 'hornet' },
  { kind: 'weapon', id: 'breach12' },
  { kind: 'weapon', id: 'carbine' },
  { kind: 'weapon', id: 'longbow' },
  { kind: 'weapon', id: 'sidekick' },
  { kind: 'armor', id: 'vest', name: 'Kevlar Vest', price: 650, blurb: 'Armour 100. Soaks two thirds of every hit until it breaks.' },
  { kind: 'armor', id: 'vesthelm', name: 'Vest + Helmet', price: 1000, blurb: 'Armour 100 and a helmet: headshots hurt 40% less.' },
  { kind: 'gear', id: 'kit', name: 'Defuse Kit', price: 400, blurb: 'Halves defuse time. Harbor Watch only.', team: 'def' },
  { kind: 'gear', id: 'charge', name: 'Spare Charge', price: 200, blurb: 'A second breach charge for the team. Vanguard only.', team: 'atk' },
];

export const BOT_NAMES = {
  atk: ['Rook', 'Maren', 'Ilya', 'Sable', 'Ondo'],
  def: ['Petra', 'Hollis', 'Brandt', 'Vesna', 'Corin'],
};

// How bots spend in the buy phase: the same menu, poorer judgement.
export const BOT_BUY_TABLE = [
  { maxMoney: 900, buy: [] },
  { maxMoney: 1600, buy: ['hornet'] },
  { maxMoney: 2400, buy: ['breach12', 'vest'] },
  { maxMoney: 3600, buy: ['carbine', 'vest'] },
  { maxMoney: 100000, buy: ['carbine', 'vesthelm'] },
];

export const PLAYER = {
  walkSpeed: 4.6, // m/s, rifle in hand
  walkQuietSpeed: 2.4, // shift: silent, steadier
  crouchSpeed: 1.9,
  airControl: 0.12,
  jumpVelocity: 4.9,
  gravity: 13.5,
  eyeHeight: 1.62,
  crouchEyeHeight: 1.12,
  radius: 0.42,
  health: 100,
  noiseRadius: 18, // metres a sprinting step carries to bot ears
};
