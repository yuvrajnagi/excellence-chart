use crate::storage::{create_blank_workbook, StorageError, WorkbookStore};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tiny_http::{Header, Method, Response, Server, StatusCode};

pub struct DesktopServer {
    server: Server,
    store: Arc<Mutex<WorkbookStore>>,
    static_dir: Option<PathBuf>,
    host: String,
    port: u16,
}

impl DesktopServer {
    pub fn new(
        host: &str,
        port: u16,
        store: Arc<Mutex<WorkbookStore>>,
        static_dir: Option<PathBuf>,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let addr = format!("{}:{}", host, port);
        let server = Server::http(&addr)?;
        Ok(Self {
            server,
            store,
            static_dir,
            host: host.to_string(),
            port,
        })
    }

    pub fn port(&self) -> u16 {
        self.server.server_addr().to_ip().map(|a| a.port()).unwrap_or(self.port)
    }

    pub fn host(&self) -> &str {
        &self.host
    }

    /// Serves incoming requests until shutdown signal is set to true.
    pub fn run_with_shutdown(&self, shutdown: Arc<AtomicBool>) {
        while !shutdown.load(Ordering::Relaxed) {
            match self.server.recv_timeout(Duration::from_millis(100)) {
                Ok(Some(request)) => {
                    self.handle_request(request);
                }
                Ok(None) => {}
                Err(err) => {
                    eprintln!("Desktop server receive error: {}", err);
                    break;
                }
            }
        }
    }

    /// Runs server indefinitely until interrupted.
    pub fn run(&self) {
        let shutdown = Arc::new(AtomicBool::new(false));
        self.run_with_shutdown(shutdown);
    }

    fn handle_request(&self, mut request: tiny_http::Request) {
        let method = request.method().clone();
        let raw_url = request.url().to_string();
        let (path, query) = parse_url(&raw_url);

        // Handle CORS preflight
        if method == Method::Options {
            let resp = Response::empty(204)
                .with_header(header("Access-Control-Allow-Origin", "*"))
                .with_header(header(
                    "Access-Control-Allow-Methods",
                    "GET, POST, PUT, DELETE, OPTIONS",
                ))
                .with_header(header(
                    "Access-Control-Allow-Headers",
                    "Content-Type, If-Match, Authorization",
                ));
            let _ = request.respond(resp);
            return;
        }

        // API routing
        if path == "/api/health" && method == Method::Get {
            let json = serde_json::json!({
                "status": "ok",
                "apiVersion": 1,
                "workbookSchemaVersion": 1,
            });
            respond_json(request, 200, &json);
            return;
        }

        if path == "/api/workbooks" {
            match method {
                Method::Get => {
                    let limit = query_param(&query, "limit")
                        .and_then(|v| v.parse::<usize>().ok())
                        .unwrap_or(50);
                    let offset = query_param(&query, "cursor")
                        .or_else(|| query_param(&query, "offset"))
                        .and_then(|v| v.parse::<usize>().ok())
                        .unwrap_or(0);
                    let order = query_param(&query, "order").unwrap_or_else(|| "recent".to_string());

                    let store = self.store.lock().unwrap();
                    match store.list(limit, offset, &order) {
                        Ok(res) => respond_json(request, 200, &res),
                        Err(err) => respond_error(request, &err),
                    }
                    return;
                }
                Method::Post => {
                    let mut body_str = String::new();
                    if let Err(e) = request.as_reader().read_to_string(&mut body_str) {
                        respond_json_error(request, 400, "INVALID_INPUT", &e.to_string(), None);
                        return;
                    }

                    let parsed: serde_json::Value = match serde_json::from_str(&body_str) {
                        Ok(v) => v,
                        Err(e) => {
                            respond_json_error(request, 400, "INVALID_INPUT", &e.to_string(), None);
                            return;
                        }
                    };

                    // Check if request is a create command
                    let kind = parsed.get("kind").and_then(|k| k.as_str()).unwrap_or("blank");
                    let name = parsed
                        .get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or("Untitled");

                    let workbook_to_create = if kind == "snapshot" {
                        if let Some(wb) = parsed.get("workbook") {
                            wb.clone()
                        } else {
                            parsed.clone()
                        }
                    } else {
                        let id = format!("wb_{}", chrono::Utc::now().timestamp_millis());
                        create_blank_workbook(&id, name)
                    };

                    let mut store = self.store.lock().unwrap();
                    match store.create_from_json(&workbook_to_create) {
                        Ok(res) => respond_json(request, 201, &res),
                        Err(err) => respond_error(request, &err),
                    }
                    return;
                }
                _ => {
                    respond_json_error(request, 405, "METHOD_NOT_ALLOWED", "Method not allowed", None);
                    return;
                }
            }
        }

        if let Some(id) = path.strip_prefix("/api/workbooks/") {
            let id = urlencoding_decode(id);
            match method {
                Method::Get => {
                    let mut store = self.store.lock().unwrap();
                    match store.get_json(&id, true) {
                        Ok(res) => respond_json(request, 200, &res),
                        Err(err) => respond_error(request, &err),
                    }
                    return;
                }
                Method::Put => {
                    let if_match_version = request
                        .headers()
                        .iter()
                        .find(|h| h.field.equiv("If-Match"))
                        .and_then(|h| h.value.as_str().trim_matches('"').parse::<i64>().ok());

                    let mut body_str = String::new();
                    if let Err(e) = request.as_reader().read_to_string(&mut body_str) {
                        respond_json_error(request, 400, "INVALID_INPUT", &e.to_string(), None);
                        return;
                    }

                    let parsed: serde_json::Value = match serde_json::from_str(&body_str) {
                        Ok(v) => v,
                        Err(e) => {
                            respond_json_error(request, 400, "INVALID_INPUT", &e.to_string(), None);
                            return;
                        }
                    };

                    let (workbook_val, save_id, expected_ver) = if let Some(wb) = parsed.get("workbook") {
                        let s_id = parsed.get("saveId").and_then(|s| s.as_str()).unwrap_or("");
                        let ver = parsed.get("expectedVersion").and_then(|v| v.as_i64()).or(if_match_version);
                        (wb.clone(), s_id.to_string(), ver)
                    } else {
                        let s_id = parsed.get("saveId").and_then(|s| s.as_str()).unwrap_or("");
                        let ver = if_match_version;
                        (parsed.clone(), s_id.to_string(), ver)
                    };

                    let expected = match expected_ver {
                        Some(v) => v,
                        None => {
                            respond_json_error(
                                request,
                                428,
                                "VERSION_CONFLICT",
                                "If-Match storage version header or expectedVersion is required",
                                None,
                            );
                            return;
                        }
                    };

                    let save_id = if save_id.is_empty() {
                        format!("save_{}", chrono::Utc::now().timestamp_micros())
                    } else {
                        save_id
                    };

                    let name = workbook_val
                        .get("properties")
                        .and_then(|p| p.get("name"))
                        .and_then(|n| n.as_str())
                        .unwrap_or("Untitled");
                    let revision = workbook_val
                        .get("revision")
                        .and_then(|r| r.as_i64())
                        .unwrap_or(0);
                    let snapshot = serde_json::to_string(&workbook_val).unwrap_or_default();

                    let mut store = self.store.lock().unwrap();
                    match store.save(&id, name, &snapshot, revision, expected, &save_id) {
                        Ok(receipt) => respond_json(request, 200, &receipt),
                        Err(err) => respond_error(request, &err),
                    }
                    return;
                }
                Method::Delete => {
                    let mut store = self.store.lock().unwrap();
                    match store.delete(&id) {
                        Ok(_) => respond_json(request, 200, &serde_json::json!({ "ok": true })),
                        Err(err) => respond_error(request, &err),
                    }
                    return;
                }
                _ => {
                    respond_json_error(request, 405, "METHOD_NOT_ALLOWED", "Method not allowed", None);
                    return;
                }
            }
        }

        // If path starts with /api/ but did not match above, return 404
        if path.starts_with("/api/") {
            respond_json_error(request, 404, "NOT_FOUND", "Endpoint not found", None);
            return;
        }

        // Static files fallback
        if let Some(ref static_dir) = self.static_dir {
            if static_dir.exists() {
                let clean_rel = path.trim_start_matches('/');
                let mut target_path = static_dir.join(clean_rel);

                if !target_path.is_file() {
                    target_path = static_dir.join("index.html");
                }

                if target_path.is_file() {
                    if let Ok(content) = fs::read(&target_path) {
                        let content_type = mime_type_for_path(&target_path);
                        let resp = Response::from_data(content)
                            .with_header(header("Content-Type", content_type))
                            .with_header(header("Access-Control-Allow-Origin", "*"));
                        let _ = request.respond(resp);
                        return;
                    }
                }
            }
        }

        respond_json_error(request, 404, "NOT_FOUND", "Resource not found", None);
    }
}

fn header(field: &str, value: &str) -> Header {
    Header::from_bytes(field.as_bytes(), value.as_bytes()).unwrap()
}

fn respond_json<T: serde::Serialize>(request: tiny_http::Request, status: u16, value: &T) {
    let body = serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string());
    let resp = Response::from_string(body)
        .with_status_code(StatusCode(status))
        .with_header(header("Content-Type", "application/json; charset=utf-8"))
        .with_header(header("Access-Control-Allow-Origin", "*"))
        .with_header(header("Cache-Control", "no-store"));
    let _ = request.respond(resp);
}

fn respond_json_error(
    request: tiny_http::Request,
    status: u16,
    code: &str,
    message: &str,
    current_version: Option<i64>,
) {
    let mut err_obj = serde_json::json!({
        "code": code,
        "message": message,
    });
    if let Some(ver) = current_version {
        err_obj["currentVersion"] = serde_json::json!(ver);
    }
    let body = serde_json::json!({ "error": err_obj });
    respond_json(request, status, &body);
}

fn respond_error(request: tiny_http::Request, err: &StorageError) {
    let status = err.status_code();
    let code = err.error_code();
    let message = format!("{}", err);
    let current_version = match err {
        StorageError::VersionConflict { current, .. } => Some(*current),
        _ => None,
    };
    respond_json_error(request, status, code, &message, current_version);
}

fn parse_url(url: &str) -> (String, Vec<(String, String)>) {
    let mut parts = url.splitn(2, '?');
    let path = parts.next().unwrap_or("/").to_string();
    let query_str = parts.next().unwrap_or("");
    let mut params = Vec::new();
    for pair in query_str.split('&') {
        if pair.is_empty() {
            continue;
        }
        let mut kv = pair.splitn(2, '=');
        let key = kv.next().unwrap_or("").to_string();
        let val = kv.next().unwrap_or("").to_string();
        params.push((urlencoding_decode(&key), urlencoding_decode(&val)));
    }
    (path, params)
}

fn query_param(params: &[(String, String)], key: &str) -> Option<String> {
    params
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.clone())
}

fn urlencoding_decode(s: &str) -> String {
    let mut out = String::new();
    let mut chars = s.chars();
    while let Some(ch) = chars.next() {
        if ch == '%' {
            let h1 = chars.next();
            let h2 = chars.next();
            if let (Some(c1), Some(c2)) = (h1, h2) {
                let hex_str = format!("{}{}", c1, c2);
                if let Ok(byte) = u8::from_str_radix(&hex_str, 16) {
                    out.push(byte as char);
                    continue;
                }
            }
        } else if ch == '+' {
            out.push(' ');
        } else {
            out.push(ch);
        }
    }
    out
}

fn mime_type_for_path(path: &Path) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript",
        "css" => "text/css",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}
