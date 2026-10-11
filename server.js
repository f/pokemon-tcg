// Local server: serves the game and routes Brock's decisions to the chosen decision engine.
//
// Engines (switchable from the game's Settings window):
//   cpu   – rule-based player that runs in the browser; the server isn't involved.
//   jev   – TypeSafe's hosted Jev API; the key is kept in .env and never sent to the browser.
//   local – an open decision model from Hugging Face, run by this server as a child process
//           (Kev via its own repo, Laya via uvx). Weights download on first start.
import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { homedir } from 'node:os';
import { promisify } from 'node:util';

const run = promisify(execFile);
if (existsSync('.env')) process.loadEnvFile('.env');

const { PORT = 8787, JEV_BASE_URL = 'https://api.typesafe.ai', LOCAL_PORT = 8009 } = process.env;
const KEV_DIR = resolve(process.env.KEV_DIR || join(import.meta.dirname, '..', 'kev'));
const HF_HUB = join(process.env.HF_HOME || join(homedir(), '.cache', 'huggingface'), 'hub');
const CONFIG_FILE = join(import.meta.dirname, 'decision.json');
const LOCAL_URL = `http://127.0.0.1:${LOCAL_PORT}`;

// Local decision models this server knows how to download and run.
const MODELS = {
  'kev-0.8b': { name: 'Kev-0.8B', family: 'kev', run: 'jaredpalmer/kev-0.8b@v1.0', repos: ['jaredpalmer/kev-0.8b', 'Qwen/Qwen3.5-0.8B-Base'], accuracy: 0.70, speed: 'fast' },
  'kev-4b': { name: 'Kev-4B', family: 'kev', run: 'jaredpalmer/kev-4b@v1.0', repos: ['jaredpalmer/kev-4b', 'Qwen/Qwen3.5-4B-Base'], accuracy: 0.84, speed: 'medium' },
  'kev-9b': { name: 'Kev-9B', family: 'kev', run: 'jaredpalmer/kev-9b@v1.0', repos: ['jaredpalmer/kev-9b', 'Qwen/Qwen3.5-9B-Base'], accuracy: 0.85, speed: 'slow', recommended: true },
  laya: { name: 'Laya', family: 'laya', repos: ['convaiinnovations/laya', 'convaiinnovations/laya-multilingual', 'convaiinnovations/laya-typed-decisions'], accuracy: null, speed: 'instant' },
};

// ---------------------------------------------------------------- config (.env + decision.json)
let config = { engine: 'local', model: 'kev-9b' };
try { config = { ...config, ...JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) }; } catch { /* first run */ }
let jevKey = process.env.JEV_API_KEY || process.env.DECISION_API_KEY || '';
const saveConfig = () => writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');

async function saveJevKey(key) {
  jevKey = key;
  let env = existsSync('.env') ? await readFile('.env', 'utf8') : '';
  env = env.split('\n').filter((l) => !/^JEV_API_KEY=/.test(l)).join('\n').trimEnd();
  await writeFile('.env', `${env}\nJEV_API_KEY=${key}\n`, { mode: 0o600 });
}

// ---------------------------------------------------------------- local model process
// `gen` increases on every start/stop, so an older start that is still awaiting something bails out instead of racing.
const local = { model: null, status: 'stopped', error: '', proc: null, total: 0, startedAt: 0, log: [], gen: 0 };

async function repoBytes(repo) {
  // Size of a repo's weight files in the Hugging Face cache, including partial downloads.
  const dir = join(HF_HUB, `models--${repo.replace('/', '--')}`, 'blobs');
  try {
    let sum = 0;
    for (const f of await readdir(dir)) sum += (await stat(join(dir, f))).size;
    return sum;
  } catch { return 0; }
}

async function expectedBytes(repo) {
  try {
    const r = await fetch(`https://huggingface.co/api/models/${repo}/tree/main?recursive=true`, { signal: AbortSignal.timeout(8000) });
    const files = await r.json();
    return files.filter((f) => /\.(safetensors|pt|bin|json|txt|jinja)$/.test(f.path)).reduce((s, f) => s + (f.lfs?.size || f.size || 0), 0);
  } catch { return 0; }
}

async function modelInfo(id) {
  const m = MODELS[id];
  const have = (await Promise.all(m.repos.map(repoBytes))).reduce((a, b) => a + b, 0);
  return { id, ...m, downloadedBytes: have, installed: have > 0 && !(await hasIncomplete(m)) && (m.size ? have >= m.size * 0.98 : have > 1e8) };
}

async function hasIncomplete(m) {
  for (const repo of m.repos) {
    const dir = join(HF_HUB, `models--${repo.replace('/', '--')}`, 'blobs');
    try { if ((await readdir(dir)).some((f) => f.endsWith('.incomplete'))) return true; } catch { /* not downloaded */ }
  }
  return false;
}

async function localReady() {
  try { return (await fetch(`${LOCAL_URL}/v1/models`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}

function pushLog(line) {
  local.log.push(line);
  if (local.log.length > 40) local.log.shift();
}

async function ensureKevRuntime() {
  if (existsSync(join(KEV_DIR, 'pyproject.toml'))) return;
  local.status = 'installing';
  await run('git', ['clone', '--depth', '1', 'https://github.com/jaredpalmer/kev.git', KEV_DIR]);
  await run('uv', ['sync', '--extra', 'serve'], { cwd: KEV_DIR, maxBuffer: 1 << 26 });
}

// The model server runs in its own process group (uv/uvx start a Python child), so stop the whole group.
function killGroup(proc, sig = 'SIGTERM') {
  try { process.kill(-proc.pid, sig); } catch { try { proc.kill(sig); } catch { /* already gone */ } }
}

function stopLocal() {
  local.gen++;
  if (local.proc) {
    const proc = local.proc;
    killGroup(proc);
    setTimeout(() => { if (proc.exitCode === null) killGroup(proc, 'SIGKILL'); }, 5000);
    local.proc = null;
  }
  local.status = 'stopped';
  local.model = null;
}

async function waitPortFree(ms = 15000) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (!(await localReady())) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function startLocal(id) {
  const m = MODELS[id];
  if (!m) throw new Error('unknown model');
  if (local.model === id && ['downloading', 'starting', 'ready', 'installing'].includes(local.status)) return;
  stopLocal();
  const gen = local.gen;
  const stale = () => gen !== local.gen;
  Object.assign(local, { model: id, status: 'starting', error: '', log: [], startedAt: Date.now(), total: 0 });
  if (!(await waitPortFree())) {
    if (stale()) return;
    local.status = 'error';
    local.error = `port ${LOCAL_PORT} is already in use by another program`;
    return;
  }
  let total = 0;
  for (const r of m.repos) total += await expectedBytes(r);
  if (stale()) return;
  local.total = total;
  if (total) m.size = total;
  try {
    let cmd, args, env = { ...process.env };
    if (m.family === 'kev') {
      await ensureKevRuntime();
      if (stale()) return;
      cmd = 'uv';
      args = ['run', '--directory', KEV_DIR, '--extra', 'serve', 'python', '-m', 'kev.serve', '--run', m.run, '--port', String(LOCAL_PORT)];
    } else {
      cmd = 'uvx';
      args = ['--python', '3.12', '--from', 'laya[serve]', 'laya-serve'];
      Object.assign(env, { LAYA_HOST: '127.0.0.1', LAYA_PORT: String(LOCAL_PORT), LAYA_DEVICE: 'mps', LAYA_PRELOAD: '1' });
    }
    local.status = 'downloading';
    const proc = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    local.proc = proc;
    const onData = (d) => String(d).split(/[\r\n]+/).filter(Boolean).forEach(pushLog);
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => {
      if (local.proc !== proc) return;
      local.proc = null;
      if (local.status !== 'stopped') {
        local.status = 'error';
        local.error = `model server exited (code ${code}): ${local.log.slice(-3).join(' | ')}`;
      }
    });
    // Wait for the server to answer, up to an hour for big first downloads.
    for (let i = 0; i < 3600 && local.proc === proc; i++) {
      if (await localReady()) { if (!stale()) local.status = 'ready'; return; }
      const have = (await Promise.all(m.repos.map(repoBytes))).reduce((a, b) => a + b, 0);
      if (local.total && have >= local.total * 0.99) local.status = 'starting';
      await new Promise((r) => setTimeout(r, 1000));
    }
  } catch (err) {
    if (stale()) return;
    local.status = 'error';
    local.error = err.message;
  }
}

async function engineState() {
  const have = local.model ? (await Promise.all(MODELS[local.model].repos.map(repoBytes))).reduce((a, b) => a + b, 0) : 0;
  return {
    engine: config.engine, model: config.model, jevKeySet: Boolean(jevKey),
    models: await Promise.all(Object.keys(MODELS).map(modelInfo)),
    local: { model: local.model, status: local.status, error: local.error, downloadedBytes: have, totalBytes: local.total, log: local.log.slice(-1)[0] || '' },
  };
}

// ---------------------------------------------------------------- HTTP
const PUBLIC = join(import.meta.dirname, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const BINARY = new Set(['.png', '.jpg', '.webp']);

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8` });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readBody(req, limit = 256 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

async function proxyDecision(req, res) {
  let input;
  try { input = await readBody(req); } catch (err) { return send(res, 400, { error: err.message }); }
  let url, model, headers = { 'Content-Type': 'application/json' };
  if (config.engine === 'jev') {
    if (!jevKey) return send(res, 400, { error: 'no Jev API key set' });
    url = JEV_BASE_URL;
    model = 'jev-latest';
    headers.Authorization = `Bearer ${jevKey}`;
  } else if (config.engine === 'local') {
    if (local.status !== 'ready') return send(res, 503, { error: `local model is ${local.status}` });
    url = LOCAL_URL;
    model = MODELS[local.model].family === 'kev' ? 'kev-latest' : undefined;
  } else {
    return send(res, 409, { error: 'the CPU engine runs in the browser' });
  }
  try {
    const upstream = await fetch(`${url}/v1/systemone`, {
      method: 'POST', headers,
      body: JSON.stringify({ model, state: input.state, questions: input.questions }),
      signal: AbortSignal.timeout(60000),
    });
    send(res, upstream.status, await upstream.text());
  } catch (err) {
    send(res, 502, { error: err.name === 'TimeoutError' ? 'timed out' : 'decision server not reachable' });
  }
}

async function setEngine(req, res) {
  let input;
  try { input = await readBody(req); } catch (err) { return send(res, 400, { error: err.message }); }
  if (typeof input.jevKey === 'string' && input.jevKey.trim()) await saveJevKey(input.jevKey.trim());
  if (input.engine && !['cpu', 'jev', 'local'].includes(input.engine)) return send(res, 400, { error: 'unknown engine' });
  if (input.model && !MODELS[input.model]) return send(res, 400, { error: 'unknown model' });
  if (input.engine) config.engine = input.engine;
  if (input.model) config.model = input.model;
  await saveConfig();
  if (config.engine === 'local') startLocal(config.model); // runs in the background; poll GET /api/engine
  else if (input.stopLocal) stopLocal();
  send(res, 200, await engineState());
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/decide' && req.method === 'POST') return proxyDecision(req, res);
  if (url.pathname === '/api/engine' && req.method === 'GET') return send(res, 200, await engineState());
  if (url.pathname === '/api/engine' && req.method === 'POST') return setEngine(req, res);
  if (url.pathname === '/api/engine/stop' && req.method === 'POST') { stopLocal(); return send(res, 200, await engineState()); }

  const path = normalize(join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!path.startsWith(PUBLIC)) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    const ext = extname(path);
    if (BINARY.has(ext)) {
      // Card images never change once downloaded: let the browser keep them.
      res.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': 'public, max-age=604800' });
      return res.end(await readFile(path));
    }
    send(res, 200, await readFile(path, 'utf8'), MIME[ext] || 'text/plain');
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopLocal(); process.exit(0); });
process.on('exit', () => { if (local.proc) killGroup(local.proc); });

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Pokémon TCG Academy → http://localhost:${PORT}`);
  console.log(`Decision engine: ${config.engine}${config.engine === 'local' ? ` (${config.model})` : ''}`);
  if (config.engine === 'local') startLocal(config.model);
});
