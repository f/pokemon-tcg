// Builds site-versus-play/: the game frame of two-player matches, for its own cookie-free Space
// (pokemon-versus-play.space.fast). The lobby (versus/, a Spacefast Zero app at pokemon-versus.space.fast) shows it in
// an iframe and passes messages in and out (public/net/bridge.js).
//   node scripts/build-versus.mjs            production (only the real lobby may frame it)
//   VERSUS_DEV=1 node scripts/build-versus.mjs   local testing with `sf dev` (localhost lobbies may frame it)
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlay } from './lib/build-play.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'site-versus-play'), play = join(out, 'play');
const dev = process.env.VERSUS_DEV === '1';
const LOBBY = 'https://pokemon-versus.space.fast';

await buildPlay(play, [{
  entry: 'versus.js', script: 'versus-app.js', to: 'versus.html',
  head: '\n  <meta name="tcg-mode" content="versus">\n  <meta name="referrer" content="no-referrer">\n  <meta name="robots" content="noindex">',
  title: '<title>Versus · Pokémon TCG Academy</title>',
}]);

const ancestors = dev ? `${LOBBY} http://localhost:* http://127.0.0.1:*` : LOBBY;
await writeFile(join(out, '_headers'), `/play/versus.html
  Content-Security-Policy: frame-ancestors ${ancestors}
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
`);
await writeFile(join(out, '_redirects'), `/ ${LOBBY}/ 302\n`);
await writeFile(join(out, 'sf.jsonc'), JSON.stringify({
  $schema: 'https://spacefast.com/schemas/sf.json',
  name: 'Pokémon TCG Academy · Versus game',
  access: 'public',
  listing: false,
}, null, 2) + '\n');
console.log(`site-versus-play/ ready${dev ? ' (dev: localhost lobbies allowed)' : ''}`);
