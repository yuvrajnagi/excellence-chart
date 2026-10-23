use openexcel_desktop::server::DesktopServer;
use openexcel_desktop::storage::WorkbookStore;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

fn http_send(
    port: u16,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: &str,
) -> (u16, serde_json::Value) {
    let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port))
        .expect("Failed to connect to local test server");

    let mut custom_headers = String::new();
    for (k, v) in headers {
        custom_headers.push_str(&format!("{}: {}\r\n", k, v));
    }

    let req = format!(
        "{} {} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nContent-Length: {}\r\nConnection: close\r\n{}\r\n{}",
        method,
        path,
        port,
        body.len(),
        custom_headers,
        body
    );

    stream.write_all(req.as_bytes()).unwrap();
    let mut resp = String::new();
    stream.read_to_string(&mut resp).unwrap();

    let first_line = resp.lines().next().unwrap_or("HTTP/1.1 500");
    let status: u16 = first_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(500);

    let body_part = resp.split("\r\n\r\n").nth(1).unwrap_or("");
    let json_val = serde_json::from_str(body_part).unwrap_or(serde_json::Value::Null);

    (status, json_val)
}

#[test]
fn test_embedded_server_full_crud_and_concurrency() {
    let store = Arc::new(Mutex::new(WorkbookStore::in_memory().unwrap()));
    // Port 0 binds an ephemeral port
    let server = DesktopServer::new("127.0.0.1", 0, store, None).unwrap();
    let port = server.port();

    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = shutdown.clone();

    let server_handle = thread::spawn(move || {
        server.run_with_shutdown(shutdown_clone);
    });

    thread::sleep(Duration::from_millis(50));

    // 1. Health check
    let (status, health) = http_send(port, "GET", "/api/health", &[], "");
    assert_eq!(status, 200);
    assert_eq!(health["status"], "ok");
    assert_eq!(health["apiVersion"], 1);

    // 2. Create workbook via POST /api/workbooks
    let create_body = r#"{"name":"HTTP Model"}"#;
    let (status, created) = http_send(
        port,
        "POST",
        "/api/workbooks",
        &[("Content-Type", "application/json")],
        create_body,
    );
    assert_eq!(status, 201);
    assert_eq!(created["storageVersion"], 1);
    let wb_id = created["workbook"]["id"].as_str().unwrap().to_string();
    assert_eq!(created["workbook"]["properties"]["name"], "HTTP Model");

    // 3. List workbooks via GET /api/workbooks
    let (status, list) = http_send(port, "GET", "/api/workbooks", &[], "");
    assert_eq!(status, 200);
    let items = list["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], wb_id);

    // 4. Get specific workbook
    let (status, fetched) = http_send(
        port,
        "GET",
        &format!("/api/workbooks/{}", wb_id),
        &[],
        "",
    );
    assert_eq!(status, 200);
    assert_eq!(fetched["storageVersion"], 1);
    assert_eq!(fetched["workbook"]["id"], wb_id);

    // 5. Update workbook with PUT /api/workbooks/{id} and If-Match
    let updated_wb = serde_json::json!({
        "workbook": {
            "schemaVersion": 1,
            "id": wb_id,
            "revision": 1,
            "properties": {
                "name": "Updated HTTP Model",
                "dateSystem": "1900",
                "locale": "en-US"
            },
            "sheetOrder": ["sheet1"],
            "sheets": {},
            "styles": {},
            "names": []
        },
        "saveId": "save_req_1"
    });
    let put_body = serde_json::to_string(&updated_wb).unwrap();

    let (status, save_res) = http_send(
        port,
        "PUT",
        &format!("/api/workbooks/{}", wb_id),
        &[
            ("Content-Type", "application/json"),
            ("If-Match", "\"1\""),
        ],
        &put_body,
    );
    assert_eq!(status, 200);
    assert_eq!(save_res["storageVersion"], 2);

    // 6. Test optimistic concurrency conflict (new saveId with stale If-Match 1)
    let conflict_wb = serde_json::json!({
        "workbook": {
            "id": wb_id,
            "revision": 3,
            "properties": {
                "name": "Conflicting Edit",
                "dateSystem": "1900",
                "locale": "en-US"
            },
            "sheetOrder": ["sheet1"],
            "sheets": {},
            "styles": {},
            "names": []
        },
        "saveId": "save_req_2"
    });
    let conflict_body = serde_json::to_string(&conflict_wb).unwrap();

    let (status, conflict_res) = http_send(
        port,
        "PUT",
        &format!("/api/workbooks/{}", wb_id),
        &[
            ("Content-Type", "application/json"),
            ("If-Match", "\"1\""),
        ],
        &conflict_body,
    );
    // Stale version must yield 409 Conflict
    assert_eq!(status, 409);
    assert_eq!(conflict_res["error"]["code"], "VERSION_CONFLICT");

    // 7. Delete workbook
    let (status, del_res) = http_send(
        port,
        "DELETE",
        &format!("/api/workbooks/{}", wb_id),
        &[],
        "",
    );
    assert_eq!(status, 200);
    assert_eq!(del_res["ok"], true);

    // 8. Verify GET returns 404
    let (status, not_found) = http_send(
        port,
        "GET",
        &format!("/api/workbooks/{}", wb_id),
        &[],
        "",
    );
    assert_eq!(status, 404);
    assert_eq!(not_found["error"]["code"], "NOT_FOUND");

    // Cleanup server
    shutdown.store(true, Ordering::Relaxed);
    server_handle.join().unwrap();
}
