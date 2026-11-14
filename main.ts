// BREACHLINE's hand-in program (Node 22, standard library only).
//
// The game itself is the game/ folder beside this file: plain static files
// the browser loads as ES modules, three.js vendored under game/vendor/.
// This program copies game/ and screenshots/ to /output and writes
// /output/dossier.json — the summary the judge reads — with the vendored
// make.fun library, using the scorer's own caps so an entry the scorer
// would refuse is refused here first.
//
// Serve the game locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Fail loudly rather than hand in an empty shell: the game folder is the entry.
if (!existsSync(join(here, 'game', 'index.html'))) {
  throw new Error('game/index.html is missing beside main.ts: nothing to hand in');
}
if (!existsSync(join(here, 'screenshots'))) {
  throw new Error('screenshots/ is missing beside main.ts: the dossier needs its cover');
}

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
