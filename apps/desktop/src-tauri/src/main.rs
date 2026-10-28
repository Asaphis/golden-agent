#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::{json, Value};
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::Command;
use uuid::Uuid;

fn connector_data_path(name: &str) -> PathBuf {
    if let Ok(path) = env::var("CONNECTOR_DATA_PATH") { return PathBuf::from(path).join(name); }
    #[cfg(windows)]
    if let Ok(app_data) = env::var("APPDATA") { return PathBuf::from(app_data).join("GoldenAgent").join(name); }
    PathBuf::from(".data/connector").join(name)
}

#[cfg(unix)]
fn ipc_request(mut request: Value) -> Result<Value, String> {
    use std::os::unix::net::UnixStream;
    let socket_path = env::var("CONNECTOR_IPC_PATH").unwrap_or_else(|_| ".data/connector/connector.sock".to_string());
    let secret_path = env::var("CONNECTOR_IPC_SECRET_PATH").unwrap_or_else(|_| connector_data_path("ipc-secret").to_string_lossy().into_owned());
    let secret = fs::read_to_string(secret_path).map_err(|error| format!("Unable to read connector IPC secret: {error}"))?;
    request["auth"] = Value::String(secret.trim().to_string());
    request["nonce"] = Value::String(Uuid::new_v4().to_string());
    let mut socket = UnixStream::connect(socket_path).map_err(|error| format!("Unable to connect to connector IPC: {error}"))?;
    socket.write_all(format!("{}\n", request).as_bytes()).map_err(|error| error.to_string())?;
    let mut body = String::new();
    socket.read_to_string(&mut body).map_err(|error| error.to_string())?;
    serde_json::from_str(&body).map_err(|error| format!("Invalid connector response: {error}"))
}

#[cfg(windows)]
fn ipc_request(mut request: Value) -> Result<Value, String> {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;

    let secret_path = env::var("CONNECTOR_IPC_SECRET_PATH")
        .unwrap_or_else(|_| connector_data_path("ipc-secret").to_string_lossy().into_owned());
    let secret = fs::read_to_string(secret_path)
        .map_err(|error| format!("Unable to read connector IPC secret: {error}"))?;
    request["auth"] = Value::String(secret.trim().to_string());
    request["nonce"] = Value::String(Uuid::new_v4().to_string());
    let host = env::var("CONNECTOR_IPC_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = env::var("CONNECTOR_IPC_PORT").unwrap_or_else(|_| "4101".to_string());
    let mut stream = TcpStream::connect(format!("{host}:{port}"))
        .map_err(|error| format!("Unable to connect to connector IPC at {host}:{port}: {error}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .map_err(|error| error.to_string())?;
    stream
        .write_all(format!("{}\n", request).as_bytes())
        .map_err(|error| error.to_string())?;
    let mut body = String::new();
    stream
        .read_to_string(&mut body)
        .map_err(|error| error.to_string())?;
    serde_json::from_str(&body).map_err(|error| format!("Invalid connector response: {error}"))
}

#[cfg(not(any(unix, windows)))]
fn ipc_request(_request: Value) -> Result<Value, String> {
    Err("Native IPC transport is not implemented for this platform".to_string())
}

#[tauri::command]
fn connector_status() -> Result<Value, String> {
    let response = ipc_request(json!({ "action": "status" }))?;
    response.get("status").cloned().ok_or_else(|| response.to_string())
}

#[tauri::command]
fn connector_capabilities() -> Result<Vec<String>, String> {
    let response = ipc_request(json!({ "action": "capabilities" }))?;
    response.get("capabilities").and_then(Value::as_array).map(|items| items.iter().filter_map(Value::as_str).map(String::from).collect()).ok_or_else(|| response.to_string())
}

#[tauri::command]
fn connector_execute(operation: String, input: Value) -> Result<Value, String> {
    let response = ipc_request(json!({ "action": "execute", "operation": operation, "input": input }))?;
    if response.get("ok").and_then(Value::as_bool) == Some(false) {
        return Err(response.get("error").and_then(Value::as_str).unwrap_or("Connector operation failed").to_string());
    }
    response.get("result").cloned().ok_or_else(|| response.to_string())
}

#[tauri::command]
fn connector_pair(pairing_code: String) -> Result<Value, String> {
    if pairing_code.trim().is_empty() { return Err("Pairing code is required".to_string()); }
    let project_path = env::var("GOLDEN_AGENT_PROJECT_PATH").unwrap_or_else(|_| ".".to_string());
    let entry = PathBuf::from(&project_path).join("dist/apps/connector/src/main.js");
    if !entry.exists() { return Err(format!("Compiled connector entrypoint not found: {}", entry.display())); }
    Command::new("node").arg(entry).arg("service").arg("--pairing-code").arg(pairing_code).spawn().map_err(|error| format!("Unable to start connector service: {error}"))?;
    Ok(json!({ "ok": true, "message": "Connector service is starting with the pairing code." }))
}

#[tauri::command]
fn connector_revoke() -> Result<Value, String> {
    Err("Revocation is a backend action and will be connected in the desktop account session milestone".to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![connector_status, connector_capabilities, connector_execute, connector_pair, connector_revoke])
        .run(tauri::generate_context!())
        .expect("error while running Golden Agent Desktop");
}
