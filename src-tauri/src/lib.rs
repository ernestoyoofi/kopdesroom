use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager};

struct ServerPort(u16);

const BASE_URL: &str = "https://kopdesroom.yupibknpermen.my.id";
const CONCURRENT_LIMIT: usize = 50;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Manifest {
    #[allow(dead_code)]
    build: String,
    #[allow(dead_code)]
    app_support: String,
    #[allow(dead_code)]
    version: String,
    list: Vec<ManifestEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ManifestEntry {
    file: String,
    hash: String,
}

#[derive(Debug, Clone, Serialize)]
struct SyncProgress {
    current: usize,
    total: usize,
    file: String,
    action: String,
}

#[derive(Debug, Clone, Serialize)]
struct SyncResult {
    ready: bool,
    synced: bool,
    build: Option<String>,
}

fn get_app_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("failed to resolve app data dir")
}

fn get_assets_dir(app: &tauri::AppHandle) -> PathBuf {
    get_app_dir(app).join("assets")
}

fn get_cache_path(app: &tauri::AppHandle) -> PathBuf {
    get_app_dir(app).join("manifest-cache.json")
}

fn file_md5(path: &std::path::Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|e| format!("Failed to open {}: {e}", path.display()))?;
    let mut hasher = Md5::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn read_cached_manifest(app: &tauri::AppHandle) -> Option<Manifest> {
    let path = get_cache_path(app);
    if !path.exists() {
        return None;
    }
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn save_cached_manifest(app: &tauri::AppHandle, manifest: &Manifest) {
    let path = get_cache_path(app);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(content) = serde_json::to_string(manifest) {
        let _ = std::fs::write(&path, &content);
    }
}

fn remove_dir_contents(dir: &std::path::Path) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            std::fs::remove_dir_all(&path)
                .map_err(|e| format!("Failed to remove dir {}: {e}", path.display()))?;
        } else {
            std::fs::remove_file(&path)
                .map_err(|e| format!("Failed to remove file {}: {e}", path.display()))?;
        }
    }
    Ok(())
}

fn remove_stale_files(dir: &std::path::Path, expected: &HashSet<String>) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    let entries: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read assets dir: {e}"))?
        .filter_map(|e| e.ok())
        .collect();

    for entry in entries {
        let path = entry.path();
        if path.is_dir() {
            remove_stale_files(&path, expected)?;
            let is_empty =
                path.read_dir().ok().map_or(true, |mut rd| rd.next().is_none());
            if is_empty {
                let _ = std::fs::remove_dir(&path);
            }
            continue;
        }

        let relative = path
            .strip_prefix(dir.parent().unwrap_or(dir))
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");

        let relative_trimmed = relative
            .strip_prefix("assets/")
            .unwrap_or(&relative)
            .to_string();

        if path.is_file() && !expected.contains(&relative_trimmed) {
            std::fs::remove_file(&path)
                .map_err(|e| format!("Failed to remove stale file {relative_trimmed}: {e}"))?;
        }
    }

    Ok(())
}

fn verify_local_files(assets_dir: &std::path::Path, manifest: &Manifest) -> bool {
    for entry in &manifest.list {
        let path = assets_dir.join(&entry.file);
        if !path.exists() {
            return false;
        }
        match file_md5(&path) {
            Ok(h) if h == entry.hash => {}
            _ => return false,
        }
    }
    true
}

fn os_string() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "Windows"
    }
    #[cfg(target_os = "linux")]
    {
        "Linux"
    }
    #[cfg(target_os = "macos")]
    {
        "MacOS"
    }
    #[cfg(target_os = "ios")]
    {
        "iOS"
    }
    #[cfg(target_os = "android")]
    {
        "Android"
    }
    #[cfg(not(any(
        target_os = "windows",
        target_os = "linux",
        target_os = "macos",
        target_os = "ios",
        target_os = "android"
    )))]
    {
        "Unknown"
    }
}

fn mime_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("html") | Some("htm") => "text/html",
        Some("js") | Some("mjs") => "text/javascript",
        Some("css") => "text/css",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") | Some("svgz") => "image/svg+xml",
        Some("json") => "application/json",
        Some("wasm") => "application/wasm",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("ico") => "image/x-icon",
        Some("webp") => "image/webp",
        Some("pdf") => "application/pdf",
        Some("xml") => "application/xml",
        Some("map") => "application/json",
        _ => "application/octet-stream",
    }
}

fn start_asset_server(assets_dir: PathBuf, app: tauri::AppHandle) -> u16 {
    let server = tiny_http::Server::http("127.0.0.1:0")
        .expect("Failed to start local asset server");
    let port = server.server_addr().to_ip().unwrap().port();
    let os = os_string();

    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            let url = request.url().to_string();
            let url_path = url.split('?').next().unwrap_or("/")
                .split('#').next().unwrap_or("/");
            let trimmed = url_path.trim_start_matches('/');

            // Tauri control routes
            if let Some(cmd) = trimmed.strip_prefix("__tauri/") {
                match cmd {
                    "exit" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.close();
                        }
                    }
                    "fsc" => {
                        let state = app.get_webview_window("main").and_then(|w| {
                            let fs = w.is_fullscreen().ok()?;
                            w.set_fullscreen(!fs).ok()?;
                            Some(!fs)
                        });
                        let body = state.map(|s| s.to_string()).unwrap_or_default();
                        let _ = request.respond(
                            tiny_http::Response::from_string(body).with_status_code(200),
                        );
                        continue;
                    }
                    "minimize" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.minimize();
                        }
                    }
                    "debug" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.eval("try{__TAURI__.webview.getCurrent().openDevTools()}catch(e){}");
                        }
                    }
                    _ => {}
                }
                let _ = request.respond(
                    tiny_http::Response::from_string("ok").with_status_code(200),
                );
                continue;
            }

            // Normal file serving
            let file_path = if trimmed.is_empty() {
                assets_dir.join("index.html")
            } else {
                assets_dir.join(trimmed)
            };

            let response = if file_path.exists() && file_path.is_file() {
                match std::fs::read(&file_path) {
                    Ok(content) => {
                        let mime = mime_type(&file_path);
                        let content = if mime == "text/html" {
                            let html = String::from_utf8_lossy(&content);
                            let js = format!(
                                r#"<script>
window.isAppTauriRunning=true;
window.tauriInfo={{
  os:"{os}",
  fsc_status:false,
  exit:function(){{fetch('/__tauri/exit')}},
  minimize:function(){{fetch('/__tauri/minimize')}},
  fsc:function(){{var t=this;fetch('/__tauri/fsc').then(function(r){{return r.text()}}).then(function(s){{t.fsc_status=s==='true';window.dispatchEvent(new CustomEvent('fsc_screen',{{detail:t.fsc_status}}))}})}},
  debug:function(){{fetch('/__tauri/debug')}}
}};
</script>"#,
                            );
                            let full = format!("{js}</head>");
                            html.replace("</head>", &full).into_bytes()
                        } else {
                            content
                        };
                        tiny_http::Response::from_data(content)
                            .with_header(
                                format!("Content-Type: {mime}")
                                    .parse::<tiny_http::Header>()
                                    .unwrap(),
                            )
                            .with_header(
                                "Access-Control-Allow-Origin: *"
                                    .parse::<tiny_http::Header>()
                                    .unwrap(),
                            )
                    }
                    Err(e) => tiny_http::Response::from_string(format!("Error: {e}"))
                        .with_status_code(500),
                }
            } else {
                tiny_http::Response::from_string("404 Not Found")
                    .with_status_code(404)
            };

            let _ = request.respond(response);
        }
    });

    port
}

#[tauri::command]
async fn sync_assets(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<SyncResult, String> {
    let manifest_url = format!("{BASE_URL}/assets-list.json");

    let client = reqwest::Client::builder()
        .user_agent("Kopdesroom/1.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let fetch_result = client.get(&manifest_url).send().await;

    match fetch_result {
        Ok(response) => {
            let manifest: Manifest = response
                .json::<Manifest>()
                .await
                .map_err(|e| format!("Failed to parse asset manifest: {e}"))?;

            let build = Some(manifest.build.clone());
            let entries = manifest.list.clone();

            if entries.is_empty() {
                return Err("Asset manifest is empty".into());
            }

            save_cached_manifest(&app, &manifest);

            let expected: HashSet<String> =
                entries.iter().map(|e| e.file.clone()).collect();
            let assets_dir = get_assets_dir(&app);

            std::fs::create_dir_all(&assets_dir)
                .map_err(|e| format!("Failed to create assets directory: {e}"))?;
            remove_stale_files(&assets_dir, &expected)?;

            let needed_entries: Vec<ManifestEntry> = entries
                .into_iter()
                .filter(|entry| {
                    let path = assets_dir.join(&entry.file);
                    if path.exists() {
                        match file_md5(&path) {
                            Ok(h) => h != entry.hash,
                            Err(_) => true,
                        }
                    } else {
                        true
                    }
                })
                .collect();

            if needed_entries.is_empty() {
                return Ok(SyncResult {
                    ready: true,
                    synced: false,
                    build,
                });
            }

            let _ = window.emit(
                "sync-progress",
                SyncProgress {
                    current: 0,
                    total: needed_entries.len(),
                    file: String::new(),
                    action: "Downloading".into(),
                },
            );

            let completed = Arc::new(AtomicUsize::new(0));
            let total_needed = needed_entries.len();

            let download_futures = needed_entries.into_iter().map(|entry| {
                let client = client.clone();
                let assets_dir = assets_dir.clone();
                let completed = Arc::clone(&completed);
                async move {
                    let file_path = assets_dir.join(&entry.file);
                    if let Some(parent) = file_path.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }

                    let file_url = format!("{BASE_URL}/{}", entry.file);
                    let response = client
                        .get(&file_url)
                        .send()
                        .await
                        .map_err(|e| format!("Failed to download {}: {e}", entry.file))?;

                    let bytes = response.bytes().await.map_err(|e| {
                        format!("Failed to read response for {}: {e}", entry.file)
                    })?;

                    std::fs::write(&file_path, &bytes)
                        .map_err(|e| format!("Failed to write {}: {e}", entry.file))?;

                    completed.fetch_add(1, Ordering::SeqCst);
                    Ok::<String, String>(entry.file)
                }
            });

            let mut stream =
                futures::stream::iter(download_futures).buffer_unordered(CONCURRENT_LIMIT);

            use futures::StreamExt;
            while let Some(result) = stream.next().await {
                let file = result?;
                let current = completed.load(Ordering::SeqCst);
                let _ = window.emit(
                    "sync-progress",
                    SyncProgress {
                        current,
                        total: total_needed,
                        file,
                        action: "Downloading".into(),
                    },
                );
            }

            let _ = window.emit("sync-complete", ());

            Ok(SyncResult {
                ready: true,
                synced: true,
                build,
            })
        }
        Err(_) => {
            let cached = read_cached_manifest(&app);
            match cached {
                Some(cached_manifest) => {
                    let assets_dir = get_assets_dir(&app);
                    let all_ok = verify_local_files(&assets_dir, &cached_manifest);
                    if all_ok {
                        Ok(SyncResult {
                            ready: true,
                            synced: false,
                            build: Some(cached_manifest.build),
                        })
                    } else {
                        Err("No internet connection. Local data is incomplete. Please connect to the internet to download the required data.".into())
                    }
                }
                None => Err("No internet connection and no cached data found. Please connect to the internet to download the required data.".into()),
            }
        }
    }
}

#[tauri::command]
async fn clear_assets(app: tauri::AppHandle) -> Result<(), String> {
    let assets_dir = get_assets_dir(&app);
    let cache_path = get_cache_path(&app);

    if assets_dir.exists() {
        remove_dir_contents(&assets_dir)?;
        let _ = std::fs::remove_dir(&assets_dir);
    }
    if cache_path.exists() {
        let _ = std::fs::remove_file(&cache_path);
    }

    Ok(())
}

#[tauri::command]
async fn load_main_webview(app: tauri::AppHandle) -> Result<(), String> {
    let path = get_assets_dir(&app).join("index.html");
    if !path.exists() {
        return Err("Main asset (index.html) not found".into());
    }

    let port = app.state::<ServerPort>().inner().0;
    let url_str = format!("http://127.0.0.1:{port}/index.html");
    let url = tauri::Url::parse(&url_str)
        .map_err(|e| format!("Invalid URL: {e}"))?;

    let webview = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;
    webview
        .navigate(url)
        .map_err(|e| format!("Navigation failed: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init::<tauri::Wry>())
        .setup(|app| {
            let handle = app.handle().clone();
            let assets_dir = get_assets_dir(app.handle());
            let port = start_asset_server(assets_dir, handle);
            app.manage(ServerPort(port));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sync_assets,
            clear_assets,
            load_main_webview
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
