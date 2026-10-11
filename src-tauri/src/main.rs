// Pokémon TCG Academy for macOS. The window shows the game (public/, copied to dist/ at build time) with no title
// bar; this file is the backend that server.js is in the browser version. It answers the same /api paths through
// one Tauri command (`api`):
//   GET  /api/engine       the decision engine settings and the local model's status
//   POST /api/engine       choose cpu / jev / local (and a model), or save the Jev key
//   POST /api/engine/stop  stop the local model server
//   POST /api/decide       one decision for Gary or the Professor, from Jev or the local model
// The Jev API key lives in the macOS Keychain. Without internet Jev is off; the CPU engine (in the page) and local
// models (Kev or Laya, run with uv; their weights stay in the Hugging Face cache) keep working.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read},
    os::unix::process::CommandExt,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{Manager, RunEvent, State};

const JEV_URL: &str = "https://api.typesafe.ai";
const LOCAL_PORT: u16 = 8009;
const KEYCHAIN_SERVICE: &str = "io.github.f.pokemon-tcg";
const KEYCHAIN_USER: &str = "jev-api-key";

// Local decision models the app knows how to download and run (same list as server.js).
struct ModelDef {
    id: &'static str,
    name: &'static str,
    family: &'static str,
    run: &'static str,
    repos: &'static [&'static str],
    accuracy: Option<f64>,
    speed: &'static str,
    recommended: bool,
}
const MODELS: &[ModelDef] = &[
    ModelDef { id: "kev-0.8b", name: "Kev-0.8B", family: "kev", run: "jaredpalmer/kev-0.8b@v1.0", repos: &["jaredpalmer/kev-0.8b", "Qwen/Qwen3.5-0.8B-Base"], accuracy: Some(0.70), speed: "fast", recommended: false },
    ModelDef { id: "kev-4b", name: "Kev-4B", family: "kev", run: "jaredpalmer/kev-4b@v1.0", repos: &["jaredpalmer/kev-4b", "Qwen/Qwen3.5-4B-Base"], accuracy: Some(0.84), speed: "medium", recommended: false },
    ModelDef { id: "kev-9b", name: "Kev-9B", family: "kev", run: "jaredpalmer/kev-9b@v1.0", repos: &["jaredpalmer/kev-9b", "Qwen/Qwen3.5-9B-Base"], accuracy: Some(0.85), speed: "slow", recommended: true },
    ModelDef { id: "laya", name: "Laya", family: "laya", run: "", repos: &["convaiinnovations/laya", "convaiinnovations/laya-multilingual", "convaiinnovations/laya-typed-decisions"], accuracy: None, speed: "instant", recommended: false },
];
fn model_def(id: &str) -> Option<&'static ModelDef> {
    MODELS.iter().find(|m| m.id == id)
}

#[derive(Serialize, Deserialize, Clone)]
struct Config {
    engine: String,
    model: String,
}

#[derive(Default)]
struct Local {
    model: Option<String>,
    status: String,
    error: String,
    child: Option<Child>,
    total: u64,
    log: Vec<String>,
    gen: u64,
    adopted: bool, // a model server that was already running (not ours to stop)
}

struct Inner {
    config: Mutex<Config>,
    local: Mutex<Local>,
    sizes: Mutex<HashMap<String, u64>>, // expected download size per model, once known
    jev_set: Mutex<bool>,
    data_dir: PathBuf,
    http: reqwest::Client,
}
type AppState = Arc<Inner>;

#[derive(Serialize)]
struct ApiResponse {
    status: u16,
    body: Value,
}
fn reply(status: u16, body: Value) -> ApiResponse {
    ApiResponse { status, body }
}

// ---------------------------------------------------------------- Keychain (the Jev key)
fn keychain() -> Option<keyring::Entry> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).ok()
}
fn jev_key() -> Option<String> {
    keychain()?.get_password().ok().filter(|k| !k.trim().is_empty())
}
fn save_jev_key(key: &str) -> Result<(), String> {
    keychain().ok_or("Keychain unavailable")?.set_password(key).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- config
fn config_path(dir: &Path) -> PathBuf {
    dir.join("decision.json")
}
fn load_config(dir: &Path) -> Config {
    fs::read_to_string(config_path(dir))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(Config { engine: "cpu".into(), model: "kev-0.8b".into() }) // CPU: plays offline from the first launch
}
fn save_config(dir: &Path, c: &Config) {
    let _ = fs::create_dir_all(dir);
    let _ = fs::write(config_path(dir), serde_json::to_string_pretty(c).unwrap_or_default() + "\n");
}

// ---------------------------------------------------------------- Hugging Face cache (where model weights live)
fn hf_hub() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    std::env::var("HF_HOME").map(PathBuf::from).unwrap_or_else(|_| Path::new(&home).join(".cache/huggingface")).join("hub")
}
fn blobs(repo: &str) -> PathBuf {
    hf_hub().join(format!("models--{}", repo.replace('/', "--"))).join("blobs")
}
fn repo_bytes(repo: &str) -> u64 {
    fs::read_dir(blobs(repo)).map(|d| d.flatten().filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum()).unwrap_or(0)
}
fn has_incomplete(m: &ModelDef) -> bool {
    m.repos.iter().any(|r| fs::read_dir(blobs(r)).map(|d| d.flatten().any(|e| e.file_name().to_string_lossy().ends_with(".incomplete"))).unwrap_or(false))
}
async fn expected_bytes(http: &reqwest::Client, repo: &str) -> u64 {
    let url = format!("https://huggingface.co/api/models/{repo}/tree/main?recursive=true");
    let Ok(res) = http.get(url).timeout(Duration::from_secs(8)).send().await else { return 0 };
    let Ok(files) = res.json::<Vec<Value>>().await else { return 0 };
    files
        .iter()
        .filter(|f| {
            let p = f["path"].as_str().unwrap_or("");
            ["safetensors", "pt", "bin", "json", "txt", "jinja"].iter().any(|x| p.ends_with(&format!(".{x}")))
        })
        .map(|f| f["lfs"]["size"].as_u64().or(f["size"].as_u64()).unwrap_or(0))
        .sum()
}

async fn online(http: &reqwest::Client) -> bool {
    http.head("https://huggingface.co").timeout(Duration::from_secs(3)).send().await.is_ok()
}
async fn local_ready(http: &reqwest::Client) -> bool {
    match http.get(format!("http://127.0.0.1:{LOCAL_PORT}/v1/models")).timeout(Duration::from_millis(1500)).send().await {
        Ok(r) => r.status().is_success(),
        Err(_) => false,
    }
}

// ---------------------------------------------------------------- local model process
// Apps opened from Finder get a minimal PATH; uv and git usually live in these places.
fn tool_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let base = std::env::var("PATH").unwrap_or_default();
    format!("{home}/.local/bin:{home}/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:{base}")
}
fn push_log(local: &Mutex<Local>, line: String) {
    let mut l = local.lock().unwrap();
    l.log.push(line);
    if l.log.len() > 40 {
        l.log.remove(0);
    }
}
fn set_error(app: &AppState, gen: u64, msg: String) {
    let mut l = app.local.lock().unwrap();
    if l.gen == gen {
        l.status = "error".into();
        l.error = msg;
    }
}
fn run_blocking(cmd: &str, args: &[&str], cwd: Option<&Path>) -> Result<(), String> {
    let mut c = Command::new(cmd);
    c.args(args).env("PATH", tool_path()).stdout(Stdio::null()).stderr(Stdio::piped());
    if let Some(d) = cwd {
        c.current_dir(d);
    }
    let out = c.output().map_err(|e| format!("{cmd} is needed for local models ({e}); install it with Homebrew"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("{cmd} failed: {}", String::from_utf8_lossy(&out.stderr).lines().last().unwrap_or("")))
    }
}

// The model server runs in its own process group (uv starts a Python child), so the whole group is stopped.
fn kill_group(child: &mut Child) {
    let pid = child.id() as i32;
    unsafe { libc::killpg(pid, libc::SIGTERM) };
    for _ in 0..50 {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        thread::sleep(Duration::from_millis(100));
    }
    unsafe { libc::killpg(pid, libc::SIGKILL) };
    let _ = child.wait();
}

fn stop_local(app: &AppState) {
    let child = {
        let mut l = app.local.lock().unwrap();
        l.gen += 1;
        l.status = "stopped".into();
        l.model = None;
        l.adopted = false;
        l.child.take()
    };
    if let Some(mut c) = child {
        thread::spawn(move || kill_group(&mut c));
    }
}

async fn start_local(app: AppState, id: String) {
    let Some(m) = model_def(&id) else { return };
    {
        let l = app.local.lock().unwrap();
        if l.model.as_deref() == Some(&id) && ["downloading", "starting", "ready", "installing"].contains(&l.status.as_str()) {
            return;
        }
    }
    stop_local(&app);
    let gen = {
        let mut l = app.local.lock().unwrap();
        l.model = Some(id.clone());
        l.status = "starting".into();
        l.error.clear();
        l.log.clear();
        l.total = 0;
        l.gen
    };
    let stale = |app: &AppState| app.local.lock().unwrap().gen != gen;

    // A model server is already answering on the port (e.g. the browser version's): use it.
    if local_ready(&app.http).await {
        if stale(&app) {
            return;
        }
        let mut l = app.local.lock().unwrap();
        l.status = "ready".into();
        l.adopted = true;
        l.log.push(format!("using the model server already running on port {LOCAL_PORT}"));
        return;
    }

    let net = online(&app.http).await;
    if net {
        let mut total = 0;
        for r in m.repos {
            total += expected_bytes(&app.http, r).await;
        }
        if stale(&app) {
            return;
        }
        if total > 0 {
            app.sizes.lock().unwrap().insert(id.clone(), total);
        }
        app.local.lock().unwrap().total = total;
    }

    // Kev runs from its own repo with uv; Laya with uvx.
    let kev_dir = app.data_dir.join("kev");
    let mut cmd;
    if m.family == "kev" {
        if !kev_dir.join("pyproject.toml").exists() {
            if !net {
                return set_error(&app, gen, "Kev isn't installed yet: connect to the internet once to download it.".into());
            }
            app.local.lock().unwrap().status = "installing".into();
            let dir = kev_dir.clone();
            let res = tauri::async_runtime::spawn_blocking(move || {
                run_blocking("git", &["clone", "--depth", "1", "https://github.com/jaredpalmer/kev.git", &dir.to_string_lossy()], None)?;
                run_blocking("uv", &["sync", "--extra", "serve"], Some(&dir))
            })
            .await
            .unwrap_or_else(|e| Err(e.to_string()));
            if let Err(e) = res {
                return set_error(&app, gen, e);
            }
            if stale(&app) {
                return;
            }
        }
        cmd = Command::new("uv");
        cmd.arg("run");
        if !net {
            cmd.arg("--offline");
        }
        let port = LOCAL_PORT.to_string();
        cmd.args(["--directory", &kev_dir.to_string_lossy(), "--extra", "serve", "python", "-m", "kev.serve", "--run", m.run, "--port", &port]);
    } else {
        cmd = Command::new("uvx");
        if !net {
            cmd.arg("--offline");
        }
        cmd.args(["--python", "3.12", "--from", "laya[serve]", "laya-serve"]);
        cmd.envs([("LAYA_HOST", "127.0.0.1".to_string()), ("LAYA_PORT", LOCAL_PORT.to_string()), ("LAYA_DEVICE", "mps".into()), ("LAYA_PRELOAD", "1".into())]);
    }
    cmd.env("PATH", tool_path()).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).process_group(0);
    if !net {
        cmd.envs([("HF_HUB_OFFLINE", "1"), ("TRANSFORMERS_OFFLINE", "1")]); // weights come from the cache only
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return set_error(&app, gen, format!("couldn't start the model server ({e}); is uv installed? (brew install uv)")),
    };
    for pipe in [child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>), child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>)].into_iter().flatten() {
        let app = app.clone();
        thread::spawn(move || {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                for part in line.split('\r').filter(|s| !s.trim().is_empty()) {
                    push_log(&app.local, part.to_string());
                }
            }
        });
    }
    {
        let mut l = app.local.lock().unwrap();
        if l.gen != gen {
            drop(l);
            let mut c = child;
            thread::spawn(move || kill_group(&mut c));
            return;
        }
        l.child = Some(child);
        l.status = "downloading".into();
    }
    // Watch it: ready when it answers; an exit is an error (up to an hour for big first downloads).
    loop {
        tokio::time::sleep(Duration::from_secs(1)).await;
        {
            let mut l = app.local.lock().unwrap();
            if l.gen != gen {
                return;
            }
            let exited = l.child.as_mut().and_then(|c| c.try_wait().ok().flatten());
            if let Some(code) = exited {
                l.child = None;
                l.status = "error".into();
                let tail = l.log.iter().rev().take(3).rev().cloned().collect::<Vec<_>>().join(" | ");
                l.error = format!("model server exited ({code}): {tail}");
                return;
            }
            if l.status == "ready" {
                continue;
            }
        }
        if local_ready(&app.http).await {
            let mut l = app.local.lock().unwrap();
            if l.gen == gen {
                l.status = "ready".into();
            }
            continue;
        }
        let have: u64 = m.repos.iter().map(|r| repo_bytes(r)).sum();
        let mut l = app.local.lock().unwrap();
        if l.gen == gen && l.total > 0 && have as f64 >= l.total as f64 * 0.99 {
            l.status = "starting".into();
        }
    }
}

// ---------------------------------------------------------------- engine state and decisions
fn engine_state(app: &AppState) -> Value {
    let config = app.config.lock().unwrap().clone();
    let sizes = app.sizes.lock().unwrap().clone();
    let models: Vec<Value> = MODELS
        .iter()
        .map(|m| {
            let have: u64 = m.repos.iter().map(|r| repo_bytes(r)).sum();
            let size = sizes.get(m.id).copied();
            let installed = have > 0 && !has_incomplete(m) && size.map_or(have > 100_000_000, |s| have as f64 >= s as f64 * 0.98);
            json!({ "id": m.id, "name": m.name, "family": m.family, "repos": m.repos, "accuracy": m.accuracy, "speed": m.speed,
                    "recommended": m.recommended, "size": size, "downloadedBytes": have, "installed": installed })
        })
        .collect();
    let l = app.local.lock().unwrap();
    let have: u64 = l.model.as_deref().and_then(model_def).map_or(0, |m| m.repos.iter().map(|r| repo_bytes(r)).sum());
    json!({
        "engine": config.engine, "model": config.model, "jevKeySet": *app.jev_set.lock().unwrap(), "app": true,
        "models": models,
        "local": { "model": l.model, "status": if l.status.is_empty() { "stopped" } else { &l.status }, "error": l.error,
                   "downloadedBytes": have, "totalBytes": l.total, "log": l.log.last().cloned().unwrap_or_default() },
    })
}

async fn set_engine(app: &AppState, body: Value) -> ApiResponse {
    if let Some(key) = body["jevKey"].as_str().map(str::trim).filter(|k| !k.is_empty()) {
        if let Err(e) = save_jev_key(key) {
            return reply(500, json!({ "error": format!("couldn't save the key in the Keychain: {e}") }));
        }
        *app.jev_set.lock().unwrap() = true;
    }
    let engine = body["engine"].as_str();
    if engine.is_some_and(|e| !["cpu", "jev", "local"].contains(&e)) {
        return reply(400, json!({ "error": "unknown engine" }));
    }
    let model = body["model"].as_str();
    if model.is_some_and(|m| model_def(m).is_none()) {
        return reply(400, json!({ "error": "unknown model" }));
    }
    let config = {
        let mut c = app.config.lock().unwrap();
        if let Some(e) = engine {
            c.engine = e.into();
        }
        if let Some(m) = model {
            c.model = m.into();
        }
        save_config(&app.data_dir, &c);
        c.clone()
    };
    if config.engine == "local" {
        tauri::async_runtime::spawn(start_local(app.clone(), config.model.clone()));
    } else if body["stopLocal"].as_bool() == Some(true) {
        stop_local(app);
    }
    reply(200, engine_state(app))
}

async fn decide(app: &AppState, body: Value) -> ApiResponse {
    let engine = app.config.lock().unwrap().engine.clone();
    let (url, model, key) = match engine.as_str() {
        "jev" => {
            let Some(key) = jev_key() else { return reply(400, json!({ "error": "no Jev API key set" })) };
            (format!("{JEV_URL}/v1/systemone"), Some("jev-latest"), Some(key))
        }
        "local" => {
            let (status, family) = {
                let l = app.local.lock().unwrap();
                (l.status.clone(), l.model.as_deref().and_then(model_def).map(|m| m.family))
            };
            if status != "ready" {
                return reply(503, json!({ "error": format!("local model is {status}") }));
            }
            (format!("http://127.0.0.1:{LOCAL_PORT}/v1/systemone"), if family == Some("kev") { Some("kev-latest") } else { None }, None)
        }
        _ => return reply(409, json!({ "error": "the CPU engine runs in the page" })),
    };
    let mut req = app.http.post(url).timeout(Duration::from_secs(60)).json(&json!({ "model": model, "state": body["state"], "questions": body["questions"] }));
    if let Some(k) = key {
        req = req.bearer_auth(k);
    }
    match req.send().await {
        Ok(res) => {
            let status = res.status().as_u16();
            let text = res.text().await.unwrap_or_default();
            reply(status, serde_json::from_str(&text).unwrap_or_else(|_| json!({ "error": text })))
        }
        Err(e) if e.is_timeout() => reply(502, json!({ "error": "timed out" })),
        Err(_) => reply(502, json!({ "error": if engine == "jev" { "Jev isn't reachable (no internet?)" } else { "decision server not reachable" } })),
    }
}

#[tauri::command]
async fn api(app: State<'_, AppState>, method: String, path: String, body: Option<Value>) -> Result<ApiResponse, String> {
    let app = app.inner().clone();
    let body = body.unwrap_or(Value::Null);
    Ok(match (method.as_str(), path.as_str()) {
        ("GET", "/api/engine") => reply(200, engine_state(&app)),
        ("POST", "/api/engine") => set_engine(&app, body).await,
        ("POST", "/api/engine/stop") => {
            stop_local(&app);
            reply(200, engine_state(&app))
        }
        ("POST", "/api/decide") => decide(&app, body).await,
        _ => reply(404, json!({ "error": "not found" })),
    })
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("pokemon-tcg"));
            let _ = fs::create_dir_all(&data_dir);
            let config = load_config(&data_dir);
            let start = (config.engine == "local").then(|| config.model.clone());
            let inner: AppState = Arc::new(Inner {
                config: Mutex::new(config),
                local: Mutex::new(Local { status: "stopped".into(), ..Default::default() }),
                sizes: Mutex::new(HashMap::new()),
                jev_set: Mutex::new(jev_key().is_some()),
                data_dir,
                http: reqwest::Client::builder().user_agent("pokemon-tcg-app").build().expect("http client"),
            });
            app.manage(inner.clone());
            if let Some(model) = start {
                tauri::async_runtime::spawn(start_local(inner, model));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![api])
        .build(tauri::generate_context!())
        .expect("error while building the app");
    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            // Leave no model server running behind (unless it was already running before the app).
            if let Some(state) = handle.try_state::<AppState>() {
                let child = state.local.lock().unwrap().child.take();
                if let Some(mut c) = child {
                    kill_group(&mut c);
                }
            }
        }
    });
}
