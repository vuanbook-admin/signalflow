use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{mpsc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const GEMINI_WEBVIEW_LABEL: &str = "gemini-browser";
const GEMINI_WEBVIEW_URL: &str = "https://gemini.google.com/app";
const CHATGPT_WEBVIEW_LABEL: &str = "chatgpt-browser";
const CHATGPT_WEBVIEW_URL: &str = "https://chatgpt.com/";
static GEMINI_REQUEST_LOCK: Mutex<()> = Mutex::new(());
static CHATGPT_REQUEST_LOCK: Mutex<()> = Mutex::new(());
static GEMINI_RESULT_CHANNEL: Mutex<Option<(String, mpsc::Sender<Result<Value, String>>)>> = Mutex::new(None);

macro_rules! subscription_commands {
    ($callback:ident) => {
        $callback!(
            gemini_web_result,
            gemini_web_open,
            gemini_web_status,
            gemini_web_complete,
            chatgpt_web_open,
            chatgpt_web_status,
            chatgpt_web_complete,
        )
    };
}

macro_rules! generate_registered_handler {
    ($($subscription_command:ident),* $(,)?) => {
        tauri::generate_handler![
            greet,
            export_json,
            secret_set,
            secret_get,
            secret_delete,
            meta_discover_accounts,
            meta_save_access_token,
            meta_exchange_long_lived_token,
            meta_publish_unpublished_page_post,
            meta_publish_page_job,
            meta_publish_page_photo_job,
            meta_publish_instagram_job,
            $($subscription_command),*
        ]
    };
}

#[cfg(test)]
macro_rules! command_names {
    ($($command:ident),* $(,)?) => {
        &[$(stringify!($command)),*]
    };
}

#[cfg(test)]
mod tests {
    use super::{account_env_key, account_webview_store_id, account_webview_user_agent, chatgpt_latest_response_script, chatgpt_send_visible_script, chatgpt_status_script, chatgpt_submit_and_send_script, delete_env_secret, encode_env_value, format_meta_api_error, gemini_subscription_script, meta_access_token_manifest, meta_long_lived_token_config, normalize_chatgpt_visible_text, complete_chatgpt_payload, parse_gemini_chromium_response, parse_meta_access_token_manifest, parse_webview_json, read_env_secret, redact_meta_detail, secret_set, secret_get, split_meta_access_token, validate_chatgpt_prompt, validate_chatgpt_response, validate_curl_config_value, validate_export_filename, validate_gemini_prompt, validate_gemini_result, validate_meta_app_id, CHATGPT_WEBVIEW_LABEL, CHATGPT_WEBVIEW_URL, GEMINI_WEBVIEW_LABEL};
    use serde_json::Value;

    #[test]
    fn subscription_commands_are_part_of_the_registered_command_surface() {
        assert_eq!(
            subscription_commands!(command_names),
            &[
                "gemini_web_result",
                "gemini_web_open",
                "gemini_web_status",
                "gemini_web_complete",
                "chatgpt_web_open",
                "chatgpt_web_status",
                "chatgpt_web_complete",
            ],
        );
    }

    #[test]
    fn export_filename_rejects_path_traversal() {
        assert!(validate_export_filename("signalflow-report.json").is_ok());
        assert!(validate_export_filename("../secrets.json").is_err());
        assert!(validate_export_filename("folder/report.json").is_err());
    }

    #[test]
    fn curl_config_escapes_header_and_message_values() {
        let escaped = validate_curl_config_value("token\"\\\nnext");
        assert!(escaped.contains("\\\""));
        assert!(escaped.contains("\\\\"));
        assert!(escaped.contains("\\n"));
        assert!(!escaped.contains('\n'));
    }

    #[test]
    fn portable_env_secret_round_trip_uses_encoded_account_keys() {
        let env_path = std::env::temp_dir().join(format!("signalflow-tauri-env-{}.env", std::process::id()));
        let previous = std::env::var_os("SIGNALFLOW_ENV_FILE");
        std::env::set_var("SIGNALFLOW_ENV_FILE", &env_path);
        let account = "workspace:test:meta:app-secret";
        assert_eq!(encode_env_value("value with spaces # and ="), "\"value with spaces # and =\"");
        secret_set(account, "value with spaces # and =").expect("write portable env secret");
        assert_eq!(secret_get(account).expect("read portable env secret").as_deref(), Some("value with spaces # and ="));
        assert!(std::fs::read_to_string(&env_path).expect("read env file").contains(&account_env_key(account)));
        delete_env_secret(account).expect("delete portable env secret");
        assert_eq!(secret_get(account).expect("read deleted portable env secret"), None);
        let _ = std::fs::remove_file(&env_path);
        match previous { Some(value) => std::env::set_var("SIGNALFLOW_ENV_FILE", value), None => std::env::remove_var("SIGNALFLOW_ENV_FILE") };
        assert_eq!(read_env_secret(account).expect("read missing env file"), None);
    }

    #[test]
    fn meta_access_token_chunking_keeps_each_env_value_below_cli_limit() {
        let token = "x".repeat(252);
        let chunks = split_meta_access_token(&token);
        assert!(chunks.len() > 1);
        assert!(chunks.iter().all(|chunk| chunk.len() <= 96));
        assert_eq!(chunks.concat(), token);
        let manifest = meta_access_token_manifest("generation-1", chunks.len());
        assert_eq!(parse_meta_access_token_manifest(&manifest), Some(("generation-1".to_string(), chunks.len())));
    }

    #[test]
    fn gemini_prompt_validation_rejects_empty_control_and_oversized_input() {
        assert!(validate_gemini_prompt("Return JSON").is_ok());
        assert!(validate_gemini_prompt("").is_err());
        assert!(validate_gemini_prompt("bad\u{0000}prompt").is_err());
        assert!(validate_gemini_prompt(&"x".repeat(100_001)).is_err());
    }

    #[test]
    fn gemini_subscription_script_uses_the_in_app_session_without_reading_cookies() {
        let script = gemini_subscription_script("\"READY\"", "request-1");
        assert!(script.contains("StreamGenerate"));
        assert!(script.contains("credentials: 'include'"));
        assert!(script.contains("__TAURI_INTERNALS__"));
        assert!(script.contains("gemini_web_result"));
        assert!(script.contains("SNlM0e"));
        assert!(!script.contains("document.cookie"));
    }

    #[test]
    fn gemini_result_validation_accepts_text_or_safe_error_only() {
        assert!(validate_gemini_result("request-1", Some("READY"), None).is_ok());
        assert!(validate_gemini_result("request-1", None, Some("GEMINI_WEB_RESPONSE_TIMEOUT")).is_ok());
        assert!(validate_gemini_result("request-1", None, None).is_err());
        assert!(validate_gemini_result("request-1", None, Some("provider-secret")).is_err());
        assert!(validate_gemini_result("request-1", Some(&"x".repeat(100_001)), None).is_err());
    }

    #[test]
    fn chromium_gemini_bridge_accepts_text_and_safe_error_payloads() {
        let value = parse_gemini_chromium_response(r#"{"text":"READY","model":"gemini-3.7-flash"}"#).expect("text response");
        assert_eq!(value["text"], "READY");
        assert_eq!(parse_gemini_chromium_response(r#"{"error":"GEMINI_WEB_LOGIN_REQUIRED"}"#).unwrap_err(), "GEMINI_WEB_LOGIN_REQUIRED");
        assert!(parse_gemini_chromium_response(r#"{"error":"provider-secret"}"#).is_err());
    }

    #[test]
    fn account_webview_profiles_are_stable_and_separate() {
        assert_eq!(GEMINI_WEBVIEW_LABEL, "gemini-browser");
        assert_eq!(CHATGPT_WEBVIEW_LABEL, "chatgpt-browser");
        assert_eq!(CHATGPT_WEBVIEW_URL, "https://chatgpt.com/");
        assert_ne!(account_webview_store_id("gemini"), account_webview_store_id("chatgpt"));
    }

    #[test]
    fn account_webviews_advertise_a_supported_engine_without_runtime_secrets() {
        let user_agent = account_webview_user_agent();
        assert!(user_agent.starts_with("Mozilla/5.0"));
        assert!(user_agent.contains("Chrome"));
        assert!(!user_agent.contains("SignalFlow"));
    }

    #[test]
    fn webview_json_parser_handles_direct_and_nested_eval_results() {
        assert_eq!(parse_webview_json(r#"{"connected":true}"#).unwrap()["connected"], true);
        assert_eq!(parse_webview_json(r#""{\"connected\":true}""#).unwrap()["connected"], true);
    }

    #[test]
    fn account_status_scripts_read_dom_only() {
        for script in [chatgpt_status_script()] {
            assert!(script.contains("document.body"));
            assert!(script.contains("location.href"));
            assert!(!script.contains("document.cookie"));
            assert!(!script.contains("localStorage"));
        }
        assert!(chatgpt_status_script().contains("candidateSummary"));
    }

    #[test]
    fn chatgpt_subscription_bridge_stays_in_the_webview() {
        assert!(validate_chatgpt_prompt("Return JSON").is_ok());
        assert!(validate_chatgpt_prompt("").is_err());
        assert!(validate_chatgpt_response(Some("OK"), None).is_ok());
        assert!(validate_chatgpt_response(None, Some("CHATGPT_WEB_RESPONSE_TIMEOUT")).is_ok());
        let exact = r#"{"variants":[{"platform":"facebook","kind":"text","title":"OK","body":"OK","hashtags":[],"metadata":{},"safetyNotes":[]}],"platform":"facebook","kind":"text","title":"OK","body":"OK","hashtags":[],"metadata":{},"safetyNotes":[]}"#;
        let normalized = normalize_chatgpt_visible_text(exact);
        let value: Value = serde_json::from_str(&normalized).expect("normalized visible JSON");
        assert_eq!(value["variants"][0]["body"], "OK");
        let nested = serde_json::to_string(exact).expect("nested visible JSON");
        let nested_normalized = normalize_chatgpt_visible_text(&nested);
        assert_eq!(serde_json::from_str::<Value>(&nested_normalized).expect("nested normalized JSON")["variants"][0]["platform"], "facebook");
        assert!(complete_chatgpt_payload(r#"{"variants":[{"body":"OK"}"#).is_none());
        assert!(complete_chatgpt_payload(exact).is_some());
        let latest_script = chatgpt_latest_response_script();
        assert!(latest_script.contains("assistant"));
        assert!(latest_script.contains("extractJson"));
        assert!(latest_script.contains("normalizeJson"));
        assert!(latest_script.contains("JSON.stringify(parsed)"));
        assert!(latest_script.contains("stop\\s+(?:generating|answering|responding|thinking)"));
        assert!(latest_script.contains("aria-busy=\"true\""));
        let submit_and_send_script = chatgpt_submit_and_send_script("\"prompt\"");
        assert!(submit_and_send_script.contains("contenteditable=\"true\""));
        assert!(submit_and_send_script.contains("beforeinput"));
        assert!(submit_and_send_script.contains("document.addEventListener('click'"));
        assert!(submit_and_send_script.contains("capture: false"));
        assert!(!submit_and_send_script.contains("addEventListener('submit'"));
        assert!(submit_and_send_script.contains("clicked"));
        assert!(submit_and_send_script.contains("confirmed"));
        assert!(submit_and_send_script.contains("send-button"));
        assert!(!submit_and_send_script.contains("location.href"));
        assert!(submit_and_send_script.contains(".ProseMirror[contenteditable=\"true\"]"));
        assert!(submit_and_send_script.contains("getClientRects"));
        let retry_script = chatgpt_send_visible_script();
        assert!(retry_script.contains("KeyboardEvent"));
        assert!(retry_script.contains("send-button"));
        for script in [submit_and_send_script.as_str(), retry_script, latest_script] {
            assert!(!script.contains("document.cookie"));
            assert!(!script.contains("localStorage"));
        }
    }

    #[test]
    fn meta_expired_token_error_is_actionable() {
        let error = format_meta_api_error(&serde_json::json!({ "code": 190, "error_subcode": 463, "message": "expired" }));
        assert!(error.starts_with("META_ACCESS_TOKEN_EXPIRED:"));
    }

    #[test]
    fn meta_long_lived_exchange_validates_app_id_and_keeps_credentials_in_stdin_config() {
        assert!(validate_meta_app_id("1234567890123456").is_ok());
        assert!(validate_meta_app_id("not-numeric").is_err());
        let config = meta_long_lived_token_config("1234567890123456", "app-secret", "short-token");
        assert!(config.contains("\nget\n"));
        assert!(!config.contains("get = true"));
        assert!(config.contains("grant_type=fb_exchange_token"));
        assert!(config.contains("client_secret=app-secret"));
        assert!(config.contains("fb_exchange_token=short-token"));
    }

    #[test]
    fn meta_error_redaction_removes_app_secret_and_token() {
        let detail = redact_meta_detail("secret=app-secret token=short-token".to_string(), &["app-secret", "short-token"]);
        assert_eq!(detail, "secret=[redacted] token=[redacted]");
    }

}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn validate_account(account: &str) -> Result<(), String> {
    if account.is_empty()
        || account.len() > 240
        || account.chars().any(|character| character.is_control())
    {
        return Err("Invalid .env account identifier".to_string());
    }
    Ok(())
}

fn validate_export_filename(filename: &str) -> Result<(), String> {
    if filename.is_empty()
        || filename.len() > 160
        || filename.contains("..")
        || filename.contains('/')
        || filename.contains('\\')
        || filename.chars().any(|character| character.is_control())
    {
        return Err("Invalid export filename".to_string());
    }
    Ok(())
}

#[tauri::command]
fn export_json(filename: &str, contents: &str) -> Result<String, String> {
    validate_export_filename(filename)?;
    if contents.len() > 4 * 1024 * 1024 {
        return Err("Export payload is too large".to_string());
    }
    let home = std::env::var_os("HOME").ok_or_else(|| "Home directory is unavailable".to_string())?;
    let downloads = PathBuf::from(home).join("Downloads");
    fs::create_dir_all(&downloads).map_err(|error| format!("Unable to prepare Downloads directory: {error}"))?;
    let destination = downloads.join(filename);
    fs::write(&destination, contents).map_err(|error| format!("Unable to write export: {error}"))?;
    Ok(destination.to_string_lossy().to_string())
}

fn portable_env_path() -> PathBuf {
    if let Some(path) = std::env::var_os("SIGNALFLOW_ENV_FILE") {
        return PathBuf::from(path);
    }
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    home.map(|value| PathBuf::from(value).join(".signalflow").join(".env")).unwrap_or_else(|| PathBuf::from(".env"))
}

fn account_env_key(account: &str) -> String {
    let encoded = account.as_bytes().iter().map(|byte| format!("{byte:02X}")).collect::<String>();
    format!("SIGNALFLOW_SECRET_{encoded}")
}

fn parse_env_value(raw: &str) -> String {
    let value = raw.trim();
    if value.starts_with('"') && value.ends_with('"') && value.len() >= 2 {
        return serde_json::from_str::<String>(value).unwrap_or_else(|_| value[1..value.len() - 1].to_string());
    }
    if value.starts_with('\'') && value.ends_with('\'') && value.len() >= 2 {
        return value[1..value.len() - 1].replace("\\'", "'");
    }
    value.to_string()
}

fn encode_env_value(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

fn env_line_matches(line: &str, key: &str) -> bool {
    let trimmed = line.trim_start();
    trimmed.strip_prefix(key).is_some_and(|rest| rest.trim_start().starts_with('='))
}

fn read_env_secret(account: &str) -> Result<Option<String>, String> {
    let path = portable_env_path();
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(&path).map_err(|_| "PORTABLE_ENV_READ_FAILED".to_string())?;
    let key = account_env_key(account);
    for line in contents.lines() {
        if let Some(raw) = line.trim_start().strip_prefix(&key).and_then(|rest| rest.trim_start().strip_prefix('=')) {
            return Ok(Some(parse_env_value(raw)));
        }
    }
    Ok(None)
}

fn write_env_secret(account: &str, value: &str) -> Result<(), String> {
    let path = portable_env_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| "PORTABLE_ENV_DIRECTORY_FAILED".to_string())?;
    }
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let key = account_env_key(account);
    let line = format!("{key}={}", encode_env_value(value));
    let mut lines = Vec::new();
    let mut replaced = false;
    for current in existing.lines() {
        if env_line_matches(current, &key) {
            if !replaced {
                lines.push(line.clone());
            }
            replaced = true;
        } else {
            lines.push(current.to_string());
        }
    }
    if !replaced {
        while lines.last().is_some_and(|current: &String| current.is_empty()) {
            lines.pop();
        }
        if !lines.is_empty() {
            lines.push(String::new());
        }
        lines.push(line);
    }
    let temporary = PathBuf::from(format!("{}.{}.tmp", path.display(), std::process::id()));
    let mut contents = lines.join("\n");
    contents.push('\n');
    fs::write(&temporary, contents).map_err(|_| "PORTABLE_ENV_WRITE_FAILED".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600)).map_err(|_| "PORTABLE_ENV_PERMISSION_FAILED".to_string())?;
    }
    fs::rename(&temporary, &path).map_err(|_| "PORTABLE_ENV_RENAME_FAILED".to_string())?;
    Ok(())
}

fn delete_env_secret(account: &str) -> Result<(), String> {
    let path = portable_env_path();
    if !path.exists() {
        return Ok(());
    }
    let contents = fs::read_to_string(&path).map_err(|_| "PORTABLE_ENV_READ_FAILED".to_string())?;
    let key = account_env_key(account);
    let lines: Vec<String> = contents.lines().filter(|line| !env_line_matches(line, &key)).map(str::to_string).collect();
    let mut next = lines.join("\n");
    next.push('\n');
    let temporary = PathBuf::from(format!("{}.{}.tmp", path.display(), std::process::id()));
    fs::write(&temporary, next).map_err(|_| "PORTABLE_ENV_WRITE_FAILED".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600)).map_err(|_| "PORTABLE_ENV_PERMISSION_FAILED".to_string())?;
    }
    fs::rename(&temporary, &path).map_err(|_| "PORTABLE_ENV_RENAME_FAILED".to_string())?;
    Ok(())
}

#[tauri::command]
fn secret_set(account: &str, secret: &str) -> Result<(), String> {
    validate_account(account)?;
    if secret.is_empty() {
        return Err("Secret cannot be empty".to_string());
    }
    write_env_secret(account, secret)
}

#[tauri::command]
fn secret_get(account: &str) -> Result<Option<String>, String> {
    validate_account(account)?;
    read_env_secret(account)
}

#[tauri::command]
fn secret_delete(account: &str) -> Result<(), String> {
    validate_account(account)?;
    delete_env_secret(account)
}

fn validate_gemini_prompt(prompt: &str) -> Result<(), String> {
    if prompt.trim().is_empty()
        || prompt.len() > 100_000
        || prompt.chars().any(|character| character.is_control() && character != '\n' && character != '\r' && character != '\t')
    {
        return Err("GEMINI_PROMPT_INVALID".to_string());
    }
    Ok(())
}

fn validate_gemini_result(request_id: &str, text: Option<&str>, error: Option<&str>) -> Result<(), String> {
    if request_id.is_empty() || request_id.len() > 80 || request_id.chars().any(|character| character.is_control()) {
        return Err("GEMINI_RESULT_REQUEST_INVALID".to_string());
    }
    if text.is_some() == error.is_some() {
        return Err("GEMINI_RESULT_PAYLOAD_INVALID".to_string());
    }
    if let Some(value) = text {
        if value.is_empty() || value.len() > 100_000 || value.chars().any(|character| character.is_control() && character != '\n' && character != '\r' && character != '\t') {
            return Err("GEMINI_RESULT_TEXT_INVALID".to_string());
        }
    }
    if let Some(value) = error {
        if !value.starts_with("GEMINI_") || value.len() > 100 {
            return Err("GEMINI_RESULT_ERROR_INVALID".to_string());
        }
    }
    Ok(())
}

fn validate_chatgpt_prompt(prompt: &str) -> Result<(), String> {
    if prompt.trim().is_empty()
        || prompt.len() > 100_000
        || prompt.chars().any(|character| character.is_control() && character != '\n' && character != '\r' && character != '\t')
    {
        return Err("CHATGPT_PROMPT_INVALID".to_string());
    }
    Ok(())
}

fn normalize_chatgpt_visible_text(text: &str) -> String {
    let mut candidate: String = text
        .chars()
        .filter(|character| !matches!(character, '\u{200B}'..='\u{200D}' | '\u{FEFF}'))
        .collect();
    candidate = candidate.trim().to_string();
    for _ in 0..2 {
        let json_candidate = candidate
            .strip_prefix("```json")
            .or_else(|| candidate.strip_prefix("```JSON"))
            .unwrap_or(&candidate)
            .trim()
            .strip_suffix("```")
            .unwrap_or_else(|| candidate.trim())
            .trim();
        if json_candidate != candidate {
            candidate = json_candidate.to_string();
        }
        match serde_json::from_str::<Value>(&candidate) {
            Ok(Value::String(nested)) => {
                candidate = nested.trim().to_string();
            }
            Ok(value @ Value::Object(_))
                if value.get("variants").and_then(Value::as_array).is_some() =>
            {
                return serde_json::to_string(&value).unwrap_or(candidate);
            }
            _ => break,
        }
    }
    candidate
}

fn complete_chatgpt_payload(text: &str) -> Option<String> {
    let normalized = normalize_chatgpt_visible_text(text);
    let value = serde_json::from_str::<Value>(&normalized).ok()?;
    if value.get("variants").and_then(Value::as_array).is_none() {
        return None;
    }
    Some(serde_json::to_string(&value).unwrap_or(normalized))
}

fn validate_chatgpt_response(text: Option<&str>, error: Option<&str>) -> Result<(), String> {
    if text.is_some() == error.is_some() {
        return Err("CHATGPT_RESPONSE_PAYLOAD_INVALID".to_string());
    }
    if let Some(value) = text {
        if value.is_empty() || value.len() > 100_000 || value.chars().any(|character| character.is_control() && character != '\n' && character != '\r' && character != '\t') {
            return Err("CHATGPT_RESPONSE_TEXT_INVALID".to_string());
        }
    }
    if let Some(value) = error {
        if !value.starts_with("CHATGPT_") || value.len() > 100 {
            return Err("CHATGPT_RESPONSE_ERROR_INVALID".to_string());
        }
    }
    Ok(())
}

fn account_webview_store_id(provider: &str) -> [u8; 16] {
    match provider {
        "gemini" => *b"sf-gemini-store0",
        "chatgpt" => *b"sf-chatgpt-store",
        _ => *b"sf-account-store",
    }
}

#[cfg(target_os = "macos")]
fn account_webview_user_agent() -> &'static str {
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
}

#[cfg(target_os = "windows")]
fn account_webview_user_agent() -> &'static str {
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"
}

#[cfg(target_os = "linux")]
fn account_webview_user_agent() -> &'static str {
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn account_webview_user_agent() -> &'static str {
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
}

fn account_webview_data_directory(app: &AppHandle, label: &str) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("webview-profiles").join(label))
        .map_err(|_| "ACCOUNT_WEBVIEW_DATA_DIRECTORY_UNAVAILABLE".to_string())
}

fn ensure_gemini_webview(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(GEMINI_WEBVIEW_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(window);
    }
    WebviewWindowBuilder::new(
        app,
        GEMINI_WEBVIEW_LABEL,
        WebviewUrl::External(GEMINI_WEBVIEW_URL.parse().map_err(|_| "GEMINI_WEBVIEW_URL_INVALID")?),
    )
    .data_directory(account_webview_data_directory(app, GEMINI_WEBVIEW_LABEL)?)
    .data_store_identifier(account_webview_store_id("gemini"))
    .user_agent(account_webview_user_agent())
    .title("Gemini Pro · SignalFlow")
    .inner_size(1200.0, 820.0)
    .min_inner_size(800.0, 600.0)
    .resizable(true)
    .build()
    .map_err(|error| format!("GEMINI_WEBVIEW_OPEN_FAILED: {error}"))
}

fn parse_webview_json(raw: &str) -> Result<Value, String> {
    let value = serde_json::from_str::<Value>(raw).map_err(|_| "ACCOUNT_WEBVIEW_INVALID_RESULT".to_string())?;
    match value {
        Value::String(nested) => serde_json::from_str::<Value>(&nested).map_err(|_| "ACCOUNT_WEBVIEW_INVALID_RESULT".to_string()),
        value => Ok(value),
    }
}

fn parse_gemini_chromium_response(raw: &str) -> Result<Value, String> {
    let value = parse_webview_json(raw).map_err(|_| "BRIDGE_RESPONSE_INVALID".to_string())?;
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        if error.starts_with("GEMINI_") && error.chars().all(|character| character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_') {
            return Err(error.to_string());
        }
        return Err("BRIDGE_RESPONSE_INVALID".to_string());
    }
    let text = value.get("text").and_then(Value::as_str).filter(|text| !text.trim().is_empty() && text.len() <= 100_000).ok_or_else(|| "BRIDGE_RESPONSE_INVALID".to_string())?;
    Ok(serde_json::json!({ "text": text, "model": value.get("model") }))
}

fn eval_webview_json(window: &WebviewWindow, script: &str, timeout: Duration) -> Result<Value, String> {
    let (sender, receiver) = mpsc::sync_channel(1);
    window
        .eval_with_callback(script.to_string(), move |raw| {
            let _ = sender.send(raw);
        })
        .map_err(|_| "ACCOUNT_WEBVIEW_EVAL_FAILED".to_string())?;
    let raw = receiver
        .recv_timeout(timeout)
        .map_err(|_| "ACCOUNT_WEBVIEW_EVAL_TIMEOUT".to_string())?;
    parse_webview_json(&raw)
}

fn gemini_status_script() -> &'static str {
    r#"JSON.stringify((() => {
        const accountLink = [...document.querySelectorAll('a')].some((element) => /accounts\.google\.com\/SignOutOptions/i.test(element.href || ''));
        const composer = Boolean(document.querySelector('[role="textbox"][contenteditable="true"], [role="textbox"][aria-label], textarea'));
        const body = document.body?.innerText || '';
        const loginRequired = /(^|\n)(Sign in|Đăng nhập)(\n|$)/i.test(body) && !accountLink;
        return { connected: composer && accountLink && !loginRequired, composer, accountLink, loginRequired, url: location.href };
    })())"#
}

fn gemini_probe(app: &AppHandle) -> Result<Value, String> {
    let Some(window) = app.get_webview_window(GEMINI_WEBVIEW_LABEL) else {
        return Ok(serde_json::json!({ "connected": false, "composer": false, "loginRequired": true, "windowOpen": false }));
    };
    eval_webview_json(&window, gemini_status_script(), Duration::from_secs(5))
}

#[tauri::command]
fn drive_inventory(_app: &AppHandle) -> Result<Value, String> {
    Err("ELECTRON_CHROMIUM_ACCOUNT_RUNTIME_REQUIRED".to_string())
}

fn chatgpt_status_script() -> &'static str {
    r#"JSON.stringify((() => {
        const body = document.body?.innerText || '';
        const candidates = [...document.querySelectorAll('textarea, [contenteditable], input, [role="textbox"]')].map((element) => ({ tag: element.tagName, id: element.id || '', name: element.getAttribute('name') || '', role: element.getAttribute('role') || '', editable: element.getAttribute('contenteditable') || '', rect: element.getClientRects().length > 0 }));
        const composer = candidates.some((candidate) => candidate.rect && (candidate.tag === 'TEXTAREA' || candidate.editable || candidate.role === 'textbox'));
        const profile = Boolean(document.querySelector('[data-testid*="profile" i], button[aria-label*="profile" i], img[alt*="profile" i]'));
        const loginRequired = /(^|\n)(Log in|Sign up|Đăng nhập|Đăng ký)(\n|$)/i.test(body) && !profile;
        const candidateSummary = candidates.map((candidate) => `${candidate.tag}:${candidate.id}:${candidate.name}:${candidate.role}:${candidate.editable}:${candidate.rect}`).join('|').slice(0, 1200);
        return { connected: composer && !loginRequired, composer, candidateSummary, profile, loginRequired, url: location.href };
    })())"#
}

fn chatgpt_submit_and_send_script(prompt_literal: &str) -> String {
    format!(
        r#"(() => {{
            const prompt = {prompt_literal};
            const visible = (element) => element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
            const selectors = [
                '.ProseMirror[contenteditable="true"]',
                'div#prompt-textarea[contenteditable="true"]',
                '[data-testid="prompt-textarea"][contenteditable]',
                '[role="textbox"][contenteditable]',
                '[contenteditable="true"]',
                'textarea[name="prompt-textarea"]',
                'textarea#prompt-textarea'
            ];
            const input = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]).find(visible);
            const readInput = () => input instanceof HTMLTextAreaElement ? input.value : (input?.innerText || input?.textContent || '');
            if (!input) return JSON.stringify({{ submitted: false, sent: false, reason: 'composer_not_found' }});
            try {{
                input.focus();
                if (input instanceof HTMLTextAreaElement) {{
                    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
                    setter?.call(input, prompt);
                    input.dispatchEvent(new Event('input', {{ bubbles: true, composed: true }}));
                    input.dispatchEvent(new Event('change', {{ bubbles: true }}));
                }} else {{
                    const selection = window.getSelection();
                    if (selection) {{
                        const range = document.createRange();
                        range.selectNodeContents(input);
                        selection.removeAllRanges();
                        selection.addRange(range);
                    }}
                    try {{ document.execCommand('delete', false); }} catch ({{}}) {{}}
                    let inserted = false;
                    try {{ inserted = document.execCommand('insertText', false, prompt); }} catch ({{}}) {{}}
                    if (!inserted || readInput().replace(/\u200b/g, '').trim() !== prompt.trim()) {{
                        input.textContent = prompt;
                        input.dispatchEvent(typeof InputEvent === 'function' ? new InputEvent('beforeinput', {{ bubbles: true, composed: true, inputType: 'insertText', data: prompt }}) : new Event('beforeinput', {{ bubbles: true }}));
                        input.dispatchEvent(typeof InputEvent === 'function' ? new InputEvent('input', {{ bubbles: true, composed: true, inputType: 'insertText', data: prompt }}) : new Event('input', {{ bubbles: true }}));
                    }}
                    input.dispatchEvent(new Event('change', {{ bubbles: true }}));
                }}
                if (readInput().replace(/\u200b/g, '').trim() !== prompt.trim()) return JSON.stringify({{ submitted: false, sent: false, reason: 'composer_rejected_text' }});
                const form = input.closest('form');
                const buttons = [...document.querySelectorAll('button')];
                const sendButton = [
                    form?.querySelector('button[type="submit"]'),
                    document.querySelector('button[data-testid="send-button"]'),
                    ...buttons.filter((button) => /send prompt|send message/i.test(`${{button.getAttribute('aria-label') || ''}} ${{button.innerText || ''}}`))
                ].find((button) => visible(button) && !button.disabled);
                if (!sendButton) return JSON.stringify({{ submitted: true, sent: false, reason: 'send_button_not_ready' }});
                const guard = (event) => {{
                    const target = event.target;
                    if (target === sendButton || sendButton.contains(target)) event.preventDefault();
                }};
                document.addEventListener('click', guard, {{ capture: false, once: true }});
                sendButton.click();
                return JSON.stringify({{ submitted: true, clicked: true, sent: false, confirmed: false, transport: 'button' }});
            }} catch {{
                return JSON.stringify({{ submitted: false, sent: false, reason: 'script_error' }});
            }}
        }})()"#,
        prompt_literal = prompt_literal,
    )
}

fn chatgpt_send_visible_script() -> &'static str {
    r#"JSON.stringify((() => {
        const visible = (element) => element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
        const input = [...document.querySelectorAll('.ProseMirror[contenteditable="true"], div#prompt-textarea[contenteditable="true"], [role="textbox"][contenteditable], [contenteditable="true"], textarea[name="prompt-textarea"], textarea#prompt-textarea')].find(visible);
        if (!input) return { submitted: false, sent: false, reason: 'composer_not_found' };
        const form = input.closest('form');
        const buttons = [...document.querySelectorAll('button')];
        const sendButton = [form?.querySelector('button[type="submit"]'), document.querySelector('button[data-testid="send-button"]'), ...buttons.filter((button) => /send prompt|send message/i.test(`${button.getAttribute('aria-label') || ''} ${button.innerText || ''}`))].find((button) => visible(button) && !button.disabled);
        if (sendButton) {
            const guard = (event) => {
                const target = event.target;
                if (target === sendButton || sendButton.contains(target)) event.preventDefault();
            };
            document.addEventListener('click', guard, { capture: false, once: true });
            sendButton.click();
            return { submitted: true, clicked: true, sent: false, confirmed: false, transport: 'button' };
        }
        const value = input instanceof HTMLTextAreaElement ? input.value : (input.innerText || input.textContent || '');
        if (!value.trim()) return { submitted: false, sent: false, reason: 'composer_empty' };
        input.focus();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true }));
        return { submitted: true, clicked: true, sent: false, confirmed: false, transport: 'enter' };
    })())"#
}

fn chatgpt_latest_response_script() -> &'static str {
    r#"JSON.stringify((() => {
        const assistantNodes = [...document.querySelectorAll('[data-message-author-role="assistant"]')].filter((node) => node.getClientRects().length > 0);
        const turnNodes = [...document.querySelectorAll('article[data-testid*="conversation-turn"]')].filter((node) => node.querySelector('[data-message-author-role="assistant"]'));
        const nodes = assistantNodes.length > 0 ? assistantNodes : turnNodes;
        const extractJson = (raw) => {
            for (let start = 0; start < raw.length; start += 1) {
                if (raw[start] !== '{') continue;
                let depth = 0;
                let inString = false;
                let escaped = false;
                for (let index = start; index < raw.length; index += 1) {
                    const character = raw[index];
                    if (inString) {
                        if (escaped) escaped = false;
                        else if (character === '\\') escaped = true;
                        else if (character === '"') inString = false;
                        continue;
                    }
                    if (character === '"') { inString = true; continue; }
                    if (character === '{') depth += 1;
                    if (character === '}') { depth -= 1; if (depth === 0) return raw.slice(start, index + 1); }
                }
            }
            return raw.trim();
        };
        const normalizeJson = (raw) => {
            let candidate = raw.trim();
            for (let attempt = 0; attempt < 3; attempt += 1) {
                candidate = candidate.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
                try {
                    const parsed = JSON.parse(candidate);
                    if (typeof parsed === 'string') { candidate = parsed; continue; }
                    if (parsed && typeof parsed === 'object') return JSON.stringify(parsed);
                } catch {
                    const repaired = candidate.replace(/\\"/g, '"').replace(/\\n/g, '\n').trim();
                    if (repaired !== candidate) { candidate = repaired; continue; }
                }
                break;
            }
            return candidate;
        };
        const rawText = extractJson(nodes.map((node) => node.innerText?.trim() || '').filter(Boolean).at(-1) || '');
        const text = normalizeJson(rawText);
        const visible = (element) => element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
        const generating = [...document.querySelectorAll('button, [role="button"]')].some((button) => {
            return visible(button) && /stop\s+(?:generating|answering|responding|thinking)/i.test(`${button.getAttribute('aria-label') || ''} ${button.innerText || ''}`);
        }) || [...document.querySelectorAll('[aria-busy="true"], [data-is-streaming="true"], [data-state="streaming"]')].some(visible);
        const composer = [...document.querySelectorAll('.ProseMirror[contenteditable="true"], div#prompt-textarea[contenteditable="true"], [role="textbox"][contenteditable], [contenteditable="true"], textarea[name="prompt-textarea"], textarea#prompt-textarea')].find((node) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none');
        const sendButton = [...document.querySelectorAll('button')].find((button) => button.getClientRects().length > 0 && !button.disabled && /send prompt|send message/i.test(`${button.getAttribute('aria-label') || ''} ${button.innerText || ''}`));
        return { text, count: nodes.length, generating, composerVisible: Boolean(composer), composerText: composer ? (composer instanceof HTMLTextAreaElement ? composer.value : (composer.innerText || composer.textContent || '')) : '', sendVisible: Boolean(sendButton), url: location.href };
    })())"#
}

fn chatgpt_probe(app: &AppHandle) -> Result<Value, String> {
    let Some(window) = app.get_webview_window(CHATGPT_WEBVIEW_LABEL) else {
        return Ok(serde_json::json!({ "connected": false, "composer": false, "loginRequired": true, "windowOpen": false }));
    };
    eval_webview_json(&window, chatgpt_status_script(), Duration::from_secs(5))
}

fn wait_for_chatgpt_ready(app: &AppHandle) -> Result<Value, String> {
    let mut last_status = None;
    for _ in 0..20 {
        match chatgpt_probe(app) {
            Ok(status) => {
                if status.get("loginRequired").and_then(Value::as_bool).unwrap_or(false) {
                    return Err("CHATGPT_WEB_LOGIN_REQUIRED".to_string());
                }
                if status.get("url").and_then(Value::as_str).map(|url| url.contains("prompt-textarea=")).unwrap_or(false) {
                    last_status = Some(status);
                    std::thread::sleep(Duration::from_millis(500));
                    continue;
                }
                if status.get("composer").and_then(Value::as_bool).unwrap_or(false) {
                    return Ok(status);
                }
                last_status = Some(status);
            }
            Err(_) => {}
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    if last_status.is_some() {
        Err("CHATGPT_COMPOSER_NOT_FOUND".to_string())
    } else {
        Err("CHATGPT_WEBVIEW_READY_TIMEOUT".to_string())
    }
}

fn ensure_chatgpt_webview(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(CHATGPT_WEBVIEW_LABEL) {
        if window.url().ok().and_then(|url| url.query().map(str::to_owned)).is_some() {
            let url = CHATGPT_WEBVIEW_URL.parse().map_err(|_| "CHATGPT_WEBVIEW_URL_INVALID")?;
            let _ = window.navigate(url);
        }
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(window);
    }
    WebviewWindowBuilder::new(
        app,
        CHATGPT_WEBVIEW_LABEL,
        WebviewUrl::External(CHATGPT_WEBVIEW_URL.parse().map_err(|_| "CHATGPT_WEBVIEW_URL_INVALID")?),
    )
    .data_directory(account_webview_data_directory(app, CHATGPT_WEBVIEW_LABEL)?)
    .data_store_identifier(account_webview_store_id("chatgpt"))
    .user_agent(account_webview_user_agent())
    .title("ChatGPT Plus · SignalFlow")
    .inner_size(1200.0, 820.0)
    .min_inner_size(800.0, 600.0)
    .resizable(true)
    .build()
    .map_err(|error| format!("CHATGPT_WEBVIEW_OPEN_FAILED: {error}"))
}

fn gemini_subscription_script(prompt_literal: &str, request_id: &str) -> String {
    format!(
        r#"(() => {{
            const prompt = {prompt_literal};
            const requestId = {request_id};
            const report = (payload) => {{
                const invoke = window.__TAURI_INTERNALS__?.invoke;
                return invoke ? invoke.call(window.__TAURI_INTERNALS__, 'gemini_web_result', payload).catch(() => undefined) : Promise.resolve();
            }};
            const fail = (code) => {{ void report({{ requestId, error: code }}); }};
            const deepLongest = (value, score) => {{
                let best = '';
                let bestScore = -1;
                const walk = (item) => {{
                    if (typeof item === 'string') {{
                        const candidateScore = item.length + score(item);
                        if (candidateScore > bestScore) {{ best = item; bestScore = candidateScore; }}
                    }} else if (Array.isArray(item)) item.forEach(walk);
                    else if (item && typeof item === 'object') Object.values(item).forEach(walk);
                }};
                walk(value);
                return best;
            }};
            const extractText = (value) => {{
                const node = value?.[4];
                if (Array.isArray(node) && node.length) {{
                    const first = node[0];
                    if (typeof first?.[1]?.[0] === 'string' && first[1][0].trim()) return first[1][0];
                    if (typeof first?.[1]?.[0]?.[0] === 'string' && first[1][0][0].trim()) return first[1][0][0];
                }}
                return deepLongest(value, (candidate) => candidate.includes('[') && candidate.includes(']') && /"?seq"?/.test(candidate) ? 100000 : 0);
            }};
            const parseResponse = (raw) => {{
                let best = '';
                const clean = raw.replace(/^\)\]\}}'\n?/, '');
                for (const line of clean.split('\n')) {{
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('[')) continue;
                    let batch;
                    try {{ batch = JSON.parse(trimmed); }} catch {{ continue; }}
                    if (!Array.isArray(batch)) continue;
                    for (const item of batch) {{
                        if (!Array.isArray(item) || item[0] !== 'wrb.fr' || typeof item[2] !== 'string') continue;
                        let nested;
                        try {{ nested = JSON.parse(item[2]); }} catch {{ continue; }}
                        const candidate = extractText(nested);
                        if (candidate && candidate.length > best.length) best = candidate;
                    }}
                }}
                return best.trim();
            }};
            const complete = async () => {{
                if (!window.__TAURI_INTERNALS__?.invoke) {{ fail('GEMINI_IPC_UNAVAILABLE'); return; }}
                const page = await fetch('https://gemini.google.com/app', {{ method: 'GET', credentials: 'include', headers: {{ accept: 'text/html' }} }});
                if (!page.ok) {{ fail('GEMINI_WEB_LOGIN_REQUIRED'); return; }}
                const html = await page.text();
                const snlm0e = html.match(/"SNlM0e":"([^"]+)"/)?.[1];
                if (!snlm0e) {{ fail('GEMINI_WEB_LOGIN_REQUIRED'); return; }}
                const bl = html.match(/"cfb2h":"([^"]+)"/)?.[1] || '';
                const fsid = html.match(/"FdrFJe":"([^\"]*?)"/)?.[1] || '';
                const reqid = String(Math.floor(100000 + Math.random() * 900000));
                const freqData = [[prompt, 0, null, null, null, null, 0], ['en'], ['', '', ''], null, null, null, [1], 0, [], [], 1, 0];
                const body = new URLSearchParams({{ 'f.req': JSON.stringify([null, JSON.stringify(freqData)]), at: snlm0e }});
                const endpoint = 'https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?' + new URLSearchParams({{ bl, 'f.sid': fsid, hl: 'en', _reqid: reqid, rt: 'c' }}).toString();
                const response = await fetch(endpoint, {{ method: 'POST', credentials: 'include', headers: {{ 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', 'x-same-domain': '1' }}, body: body.toString() }});
                if (response.status === 401 || response.status === 403) {{ fail('GEMINI_WEB_LOGIN_REQUIRED'); return; }}
                if (response.status === 429) {{ fail('GEMINI_RATE_LIMIT'); return; }}
                if (!response.ok) {{ fail('GEMINI_WEB_REQUEST_FAILED'); return; }}
                const text = parseResponse(await response.text());
                if (!text) {{ fail('GEMINI_BAD_RESPONSE'); return; }}
                await report({{ requestId, text }});
            }};
            void complete().catch(() => fail('GEMINI_WEB_REQUEST_FAILED'));
        }})()"#,
        prompt_literal = prompt_literal,
        request_id = serde_json::to_string(request_id).unwrap_or_else(|_| "\"invalid\"".to_string()),
    )
}

#[tauri::command]
fn gemini_web_result(window: WebviewWindow, request_id: String, text: Option<String>, error: Option<String>) -> Result<(), String> {
    if window.label() != GEMINI_WEBVIEW_LABEL {
        return Err("GEMINI_RESULT_WINDOW_INVALID".to_string());
    }
    let url = window.url().map_err(|_| "GEMINI_RESULT_URL_UNAVAILABLE".to_string())?;
    if url.scheme() != "https" || url.host_str() != Some("gemini.google.com") {
        return Err("GEMINI_RESULT_ORIGIN_INVALID".to_string());
    }
    validate_gemini_result(&request_id, text.as_deref(), error.as_deref())?;
    let payload = text.map(|value| Ok(serde_json::json!({ "text": value }))).or_else(|| error.map(|value| Err(value))).ok_or_else(|| "GEMINI_RESULT_PAYLOAD_INVALID".to_string())?;
    let sender = {
        let mut active = GEMINI_RESULT_CHANNEL.lock().map_err(|_| "GEMINI_RESULT_CHANNEL_FAILED".to_string())?;
        if active.as_ref().map(|(active_id, _)| active_id.as_str()) != Some(request_id.as_str()) {
            return Err("GEMINI_RESULT_REQUEST_MISMATCH".to_string());
        }
        active.take().map(|(_, sender)| sender).ok_or_else(|| "GEMINI_RESULT_REQUEST_MISSING".to_string())?
    };
    sender.send(payload).map_err(|_| "GEMINI_RESULT_RECEIVER_CLOSED".to_string())
}

#[tauri::command]
fn gemini_web_open(app: AppHandle) -> Result<Value, String> {
    let window = ensure_gemini_webview(&app)?;
    let _ = window.show();
    let _ = window.set_focus();
    Ok(serde_json::json!({ "opened": true, "window": GEMINI_WEBVIEW_LABEL, "persistentProfile": true }))
}

#[tauri::command]
async fn gemini_web_status(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || gemini_probe(&app))
        .await
        .map_err(|_| "GEMINI_STATUS_TASK_FAILED".to_string())?
}

#[tauri::command]
fn chatgpt_web_open(app: AppHandle) -> Result<Value, String> {
    let window = ensure_chatgpt_webview(&app)?;
    let _ = window.show();
    let _ = window.set_focus();
    Ok(serde_json::json!({ "opened": true, "window": CHATGPT_WEBVIEW_LABEL, "persistentProfile": true }))
}

#[tauri::command]
async fn chatgpt_web_status(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || chatgpt_probe(&app))
        .await
        .map_err(|_| "CHATGPT_STATUS_TASK_FAILED".to_string())?
}

#[tauri::command]
async fn chatgpt_web_complete(app: AppHandle, prompt: String, model: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || chatgpt_web_complete_blocking(app, &prompt, &model))
        .await
        .map_err(|_| "CHATGPT_REQUEST_TASK_FAILED".to_string())?
}

fn chatgpt_web_complete_blocking(app: AppHandle, prompt: &str, model: &str) -> Result<Value, String> {
    let _request_guard = CHATGPT_REQUEST_LOCK.lock().map_err(|_| "CHATGPT_REQUEST_LOCK_FAILED".to_string())?;
    validate_chatgpt_prompt(prompt)?;
    if model.trim().is_empty() || model.len() > 120 || model.chars().any(|character| character.is_control()) {
        return Err("CHATGPT_MODEL_INVALID".to_string());
    }
    let window = ensure_chatgpt_webview(&app)?;
    let _status = wait_for_chatgpt_ready(&app)?;
    let before = eval_webview_json(&window, chatgpt_latest_response_script(), Duration::from_secs(5)).unwrap_or_else(|_| serde_json::json!({ "text": "", "count": 0, "generating": false }));
    let before_text = before.get("text").and_then(Value::as_str).unwrap_or_default().to_string();
    let before_count = before.get("count").and_then(Value::as_u64).unwrap_or_default();
    let prompt_literal = serde_json::to_string(prompt).map_err(|_| "CHATGPT_PROMPT_INVALID".to_string())?;
    let _submit = eval_webview_json(&window, &chatgpt_submit_and_send_script(&prompt_literal), Duration::from_secs(5))?;
    let mut confirmed = false;
    let mut retry_attempted = false;
    for _ in 0..30 {
        std::thread::sleep(Duration::from_millis(200));
        let state = eval_webview_json(&window, chatgpt_latest_response_script(), Duration::from_secs(5)).unwrap_or_default();
        let count = state.get("count").and_then(Value::as_u64).unwrap_or_default();
        let text = state.get("text").and_then(Value::as_str).unwrap_or_default();
        let composer_visible = state.get("composerVisible").and_then(Value::as_bool).unwrap_or(false);
        let composer_text = state.get("composerText").and_then(Value::as_str).unwrap_or_default();
        let send_visible = state.get("sendVisible").and_then(Value::as_bool).unwrap_or(false);
        let generating = state.get("generating").and_then(Value::as_bool).unwrap_or(false);
        let url = state.get("url").and_then(Value::as_str).unwrap_or_default();
        let response_signal = !text.trim().is_empty() && (count > before_count || text != before_text);
        let post_send_signal = !composer_visible || composer_text.trim().is_empty() || generating || (url.contains("/c/") && !url.contains("?prompt-textarea="));
        if response_signal || post_send_signal {
            confirmed = true;
            break;
        }
        if !retry_attempted && composer_visible && send_visible && composer_text.replace('\u{200b}', "").trim() == prompt.trim() {
            retry_attempted = true;
            let _ = eval_webview_json(&window, chatgpt_send_visible_script(), Duration::from_secs(5));
        }
    }
    if !confirmed {
        return Err("CHATGPT_SEND_UNCONFIRMED".to_string());
    }
    for _ in 0..110 {
        std::thread::sleep(Duration::from_secs(1));
        let latest = eval_webview_json(&window, chatgpt_latest_response_script(), Duration::from_secs(5)).unwrap_or_default();
        let text = latest.get("text").and_then(Value::as_str).unwrap_or_default();
        let count = latest.get("count").and_then(Value::as_u64).unwrap_or_default();
        let generating = latest.get("generating").and_then(Value::as_bool).unwrap_or(false);
        if !text.trim().is_empty() && (count > before_count || text != before_text) && !generating {
            if let Some(normalized_text) = complete_chatgpt_payload(text) {
                validate_chatgpt_response(Some(&normalized_text), None)?;
                return Ok(serde_json::json!({ "text": normalized_text }));
            }
        }
    }
    validate_chatgpt_response(None, Some("CHATGPT_WEB_RESPONSE_TIMEOUT"))?;
    Err("CHATGPT_WEB_RESPONSE_TIMEOUT".to_string())
}

#[tauri::command]
async fn gemini_web_complete(app: AppHandle, prompt: String, model: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || gemini_web_complete_blocking(app, &prompt, &model))
        .await
        .map_err(|_| "GEMINI_REQUEST_TASK_FAILED".to_string())?
}

fn gemini_web_complete_blocking(app: AppHandle, prompt: &str, model: &str) -> Result<Value, String> {
    validate_gemini_prompt(prompt)?;
    if model.trim().is_empty() || model.len() > 120 || model.chars().any(|character| character.is_control()) {
        return Err("GEMINI_MODEL_INVALID".to_string());
    }
    let _request_guard = GEMINI_REQUEST_LOCK.lock().map_err(|_| "GEMINI_REQUEST_LOCK_FAILED".to_string())?;
    let window = ensure_gemini_webview(&app)?;
    let prompt_literal = serde_json::to_string(prompt).map_err(|_| "GEMINI_PROMPT_INVALID".to_string())?;
    let request_id = format!("gemini-web-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "GEMINI_REQUEST_ID_FAILED".to_string())?.as_nanos());
    let (sender, receiver) = mpsc::channel();
    {
        let mut active = GEMINI_RESULT_CHANNEL.lock().map_err(|_| "GEMINI_RESULT_CHANNEL_FAILED".to_string())?;
        if active.is_some() {
            return Err("GEMINI_REQUEST_BUSY".to_string());
        }
        *active = Some((request_id.clone(), sender));
    }
    let script = gemini_subscription_script(&prompt_literal, &request_id);
    if let Err(_) = window.eval(script) {
        let mut active = GEMINI_RESULT_CHANNEL.lock().map_err(|_| "GEMINI_RESULT_CHANNEL_FAILED".to_string())?;
        active.take();
        return Err("GEMINI_WEBVIEW_EVAL_FAILED".to_string());
    }
    let result = receiver.recv_timeout(Duration::from_secs(95)).map_err(|_| "GEMINI_WEB_RESPONSE_TIMEOUT".to_string())?;
    if let Ok(mut active) = GEMINI_RESULT_CHANNEL.lock() {
        if active.as_ref().map(|(active_id, _)| active_id == &request_id).unwrap_or(false) {
            active.take();
        }
    }
    match result {
        Ok(payload) => Ok(serde_json::json!({ "text": payload.get("text").and_then(Value::as_str).unwrap_or(""), "model": model })),
        Err(code) => Err(code),
    }
}

fn validate_meta_page_id(page_id: &str) -> Result<(), String> {
    if page_id.is_empty()
        || page_id.len() > 64
        || !page_id.chars().all(|character| character.is_ascii_digit())
    {
        return Err("META_PAGE_ID_INVALID".to_string());
    }
    Ok(())
}

fn validate_meta_app_id(app_id: &str) -> Result<(), String> {
    if app_id.is_empty() || app_id.len() > 64 || !app_id.chars().all(|character| character.is_ascii_digit()) {
        return Err("META_APP_ID_INVALID".to_string());
    }
    Ok(())
}

fn validate_meta_message(message: &str) -> Result<(), String> {
    if message.trim().is_empty()
        || message.len() > 63206
        || message.chars().any(|character| {
            character.is_control() && character != '\n' && character != '\r' && character != '\t'
        })
    {
        return Err("META_MESSAGE_INVALID".to_string());
    }
    Ok(())
}

fn validate_curl_config_value(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\r', "\\r")
        .replace('\n', "\\n")
}

fn meta_page_token(workspace_id: &str, page_id: &str) -> Result<String, String> {
    let page_account = format!("workspace:{workspace_id}:meta:page-access-token:{page_id}");
    read_meta_chunked_secret(&page_account)?.ok_or_else(|| {
        "META_PAGE_ACCESS_TOKEN_NOT_CONFIGURED: run account discovery first".to_string()
    })
}

fn meta_manual_access_token(workspace_id: &str) -> Result<String, String> {
    let account = format!("workspace:{workspace_id}:meta:manual-access-token");
    read_meta_chunked_secret(&account)?.ok_or_else(|| "META_ACCESS_TOKEN_NOT_CONFIGURED".to_string())
}

fn meta_store_access_token(workspace_id: &str, token: &str) -> Result<(), String> {
    if token.is_empty() || token.len() > 16 * 1024 || token.chars().any(|character| character.is_control()) {
        return Err("META_ACCESS_TOKEN_INVALID".to_string());
    }
    let base_account = format!("workspace:{workspace_id}:meta:manual-access-token");
    store_meta_chunked_secret(&base_account, token)
}

#[tauri::command]
fn meta_save_access_token(workspace_id: &str, access_token: String) -> Result<Value, String> {
    meta_store_access_token(workspace_id, &access_token)?;
    Ok(serde_json::json!({
        "provider": "meta",
        "status": "access_token_saved",
        "tokenBoundary": "env_file"
    }))
}

fn meta_long_lived_token_config(app_id: &str, app_secret: &str, short_token: &str) -> String {
    format!(
        "url = \"https://graph.facebook.com/v23.0/oauth/access_token\"\nrequest = \"GET\"\nget\ndata-urlencode = \"grant_type=fb_exchange_token\"\ndata-urlencode = \"client_id={}\"\ndata-urlencode = \"client_secret={}\"\ndata-urlencode = \"fb_exchange_token={}\"\n",
        validate_curl_config_value(app_id),
        validate_curl_config_value(app_secret),
        validate_curl_config_value(short_token)
    )
}

const META_ACCESS_TOKEN_CHUNK_BYTES: usize = 96;

fn split_meta_access_token(token: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut current_bytes = 0;
    for character in token.chars() {
        let character_bytes = character.len_utf8();
        if current_bytes + character_bytes > META_ACCESS_TOKEN_CHUNK_BYTES && !current.is_empty() {
            chunks.push(current);
            current = String::new();
            current_bytes = 0;
        }
        current.push(character);
        current_bytes += character_bytes;
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

fn meta_access_token_manifest(generation: &str, chunk_count: usize) -> String {
    format!("v1:{generation}:{chunk_count}")
}

fn parse_meta_access_token_manifest(value: &str) -> Option<(String, usize)> {
    let mut parts = value.split(':');
    if parts.next() != Some("v1") {
        return None;
    }
    let generation = parts.next()?.to_string();
    if generation.is_empty() || !generation.chars().all(|character| character.is_ascii_alphanumeric() || character == '-') {
        return None;
    }
    let count = parts.next()?.parse::<usize>().ok()?;
    if count == 0 || count > 1024 || parts.next().is_some() {
        return None;
    }
    Some((generation, count))
}

fn read_meta_chunked_secret(account: &str) -> Result<Option<String>, String> {
    let Some(stored) = secret_get(account)? else {
        return Ok(None);
    };
    let Some((generation, chunk_count)) = parse_meta_access_token_manifest(&stored) else {
        if stored.starts_with("v1:") {
            return Err("META_SECRET_MANIFEST_INVALID".to_string());
        }
        return Ok(Some(stored));
    };
    let mut value = String::new();
    for index in 0..chunk_count {
        let chunk_account = format!("{account}:chunk:{generation}:{index}");
        let chunk = secret_get(&chunk_account)?.ok_or_else(|| "META_SECRET_CHUNK_MISSING".to_string())?;
        value.push_str(&chunk);
    }
    Ok(Some(value))
}

fn store_meta_chunked_secret(account: &str, value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 16 * 1024 || value.chars().any(|character| character.is_control()) {
        return Err("META_SECRET_INVALID".to_string());
    }
    let generation = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "META_SECRET_GENERATION_FAILED".to_string())?
        .as_nanos()
        .to_string();
    let chunks = split_meta_access_token(value);
    for (index, chunk) in chunks.iter().enumerate() {
        let chunk_account = format!("{account}:chunk:{generation}:{index}");
        secret_set(&chunk_account, chunk)?;
    }
    secret_set(account, &meta_access_token_manifest(&generation, chunks.len()))
}
fn format_meta_api_error(error: &Value) -> String {
    let safe_error = serde_json::json!({
        "message": error.get("message"),
        "type": error.get("type"),
        "code": error.get("code"),
        "error_subcode": error.get("error_subcode"),
        "fbtrace_id": error.get("fbtrace_id")
    });
    let error_code_value = error.get("code").and_then(Value::as_i64);
    let error_subcode = error.get("error_subcode").and_then(Value::as_i64);
    let is_expired_token = error_code_value == Some(190) || matches!(error_subcode, Some(463 | 467));
    let is_permission_error = error
        .get("code")
        .and_then(Value::as_i64)
        .is_some_and(|code| (200..=299).contains(&code));
    let error_code = if is_expired_token {
        "META_ACCESS_TOKEN_EXPIRED"
    } else if is_permission_error {
        "META_PERMISSION_REQUIRED"
    } else {
        "META_GRAPH_API_REJECTED"
    };
    format!("{error_code}: {safe_error}")
}

fn validate_meta_media_url(media_url: &str) -> Result<(), String> {
    if media_url.is_empty()
        || media_url.len() > 4096
        || !media_url.starts_with("https://")
        || media_url.contains("localhost")
        || media_url.contains(".local")
        || media_url.chars().any(|character| character.is_control())
    {
        return Err("META_PUBLIC_MEDIA_URL_INVALID".to_string());
    }
    Ok(())
}

fn redact_meta_detail(mut detail: String, redactions: &[&str]) -> String {
    for secret in redactions {
        if !secret.is_empty() {
            detail = detail.replace(secret, "[redacted]");
        }
    }
    detail
}

fn meta_curl_request(curl_config: &str, access_token: &str) -> Result<Value, String> {
    meta_curl_request_with_redactions(curl_config, &[access_token])
}

fn meta_curl_request_with_redactions(curl_config: &str, redactions: &[&str]) -> Result<Value, String> {
    let mut child = Command::new("curl")
        .args(["--config", "-", "--silent", "--show-error", "--fail-with-body", "--max-time", "60"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| format!("META_GRAPH_CLIENT_UNAVAILABLE: {error}"))?;
    child
        .stdin
        .as_mut()
        .ok_or_else(|| "META_GRAPH_STDIN_UNAVAILABLE".to_string())?
        .write_all(curl_config.as_bytes())
        .map_err(|error| format!("META_GRAPH_REQUEST_FAILED: {error}"))?;
    let output = child
        .wait_with_output()
        .map_err(|error| format!("META_GRAPH_REQUEST_FAILED: {error}"))?;
    if !output.status.success() {
        if let Ok(payload) = serde_json::from_slice::<Value>(&output.stdout) {
            if let Some(error) = payload.get("error") {
                return Err(format_meta_api_error(error));
            }
        }
        let stdout_detail = redact_meta_detail(String::from_utf8_lossy(&output.stdout).trim().to_string(), redactions);
        let stderr_detail = redact_meta_detail(String::from_utf8_lossy(&output.stderr).trim().to_string(), redactions);
        let detail = match (stdout_detail.is_empty(), stderr_detail.is_empty()) {
            (false, false) => format!("{stdout_detail} | stderr: {stderr_detail}"),
            (false, true) => stdout_detail,
            (true, false) => stderr_detail,
            (true, true) => "curl returned no diagnostic output".to_string(),
        };
        return Err(format!("META_GRAPH_REQUEST_FAILED: {detail}"));
    }
    let payload: Value = serde_json::from_slice(&output.stdout).map_err(|_| "META_GRAPH_INVALID_RESPONSE".to_string())?;
    if let Some(error) = payload.get("error") {
        return Err(format_meta_api_error(error));
    }
    Ok(payload)
}

fn wait_for_instagram_container(container_id: &str, access_token: &str) -> Result<(), String> {
    validate_meta_page_id(container_id)?;
    for _ in 0..20 {
        let curl_config = format!(
            "url = \"https://graph.facebook.com/v23.0/{container_id}?fields=status_code\"\nheader = \"Authorization: Bearer {}\"\nheader = \"Accept: application/json\"\n",
            validate_curl_config_value(access_token)
        );
        let payload = meta_curl_request(&curl_config, access_token)?;
        match payload.get("status_code").and_then(Value::as_str) {
            Some("FINISHED") => return Ok(()),
            Some("ERROR") | Some("EXPIRED") => return Err("META_INSTAGRAM_CONTAINER_FAILED".to_string()),
            _ => std::thread::sleep(Duration::from_millis(1_500)),
        }
    }
    Err("META_INSTAGRAM_CONTAINER_TIMEOUT".to_string())
}

#[tauri::command]
fn meta_discover_accounts(workspace_id: &str) -> Result<Value, String> {
    let access_token = meta_manual_access_token(workspace_id)?;
    if access_token.len() > 4096 || access_token.chars().any(|character| character.is_control()) {
        return Err("META_ACCESS_TOKEN_INVALID".to_string());
    }
    let mut child = Command::new("curl")
        .args([
            "--config",
            "-",
            "--silent",
            "--show-error",
            "--fail-with-body",
            "--max-time",
            "20",
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| format!("META_GRAPH_CLIENT_UNAVAILABLE: {error}"))?;
    let curl_config = format!(
        "url = \"https://graph.facebook.com/v23.0/me/accounts?fields=id,name,tasks,access_token,instagram_business_account\"\nheader = \"Authorization: Bearer {}\"\nheader = \"Accept: application/json\"\n",
        validate_curl_config_value(&access_token)
    );
    child
        .stdin
        .as_mut()
        .ok_or_else(|| "META_GRAPH_STDIN_UNAVAILABLE".to_string())?
        .write_all(curl_config.as_bytes())
        .map_err(|error| format!("META_GRAPH_REQUEST_FAILED: {error}"))?;
    let output = child
        .wait_with_output()
        .map_err(|error| format!("META_GRAPH_REQUEST_FAILED: {error}"))?;
    if !output.status.success() {
        if let Ok(payload) = serde_json::from_slice::<Value>(&output.stdout) {
            if let Some(error) = payload.get("error") {
                return Err(format_meta_api_error(error));
            }
        }
        let stdout_detail = String::from_utf8_lossy(&output.stdout)
            .trim()
            .replace(&access_token, "[redacted]");
        let stderr_detail = String::from_utf8_lossy(&output.stderr)
            .trim()
            .replace(&access_token, "[redacted]");
        let detail = match (stdout_detail.is_empty(), stderr_detail.is_empty()) {
            (false, false) => format!("{stdout_detail} | stderr: {stderr_detail}"),
            (false, true) => stdout_detail,
            (true, false) => stderr_detail,
            (true, true) => "curl returned no diagnostic output".to_string(),
        };
        return Err(format!("META_GRAPH_REQUEST_FAILED: {detail}"));
    }
    let payload: Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| "META_GRAPH_INVALID_RESPONSE".to_string())?;
    if payload.get("error").is_some() {
        return Err("META_GRAPH_API_REJECTED".to_string());
    }
    let mut account_hints = Vec::new();
    if let Some(accounts) = payload.get("data").and_then(Value::as_array) {
        for page in accounts {
            let Some(page_id) = page.get("id").and_then(Value::as_str) else {
                continue;
            };
            if let Some(page_token) = page.get("access_token").and_then(Value::as_str) {
                let page_account =
                    format!("workspace:{workspace_id}:meta:page-access-token:{page_id}");
                store_meta_chunked_secret(&page_account, page_token)?;
            }
            account_hints.push(serde_json::json!({
                "id": page_id,
                "name": page.get("name"),
                "tasks": page.get("tasks"),
                "instagram_business_account": page.get("instagram_business_account"),
                "kind": "page"
            }));
        }
    }
    Ok(serde_json::json!({
        "provider": "meta",
        "status": "connected",
        "tokenBoundary": "env_file",
        "accountHints": account_hints
    }))
}

#[tauri::command]
fn meta_exchange_long_lived_token(workspace_id: &str, app_id: &str) -> Result<Value, String> {
    validate_meta_app_id(app_id)?;
    let current_token = meta_manual_access_token(workspace_id)?;
    if current_token.len() > 4096 || current_token.chars().any(|character| character.is_control()) {
        return Err("META_ACCESS_TOKEN_INVALID".to_string());
    }
    let secret_account = format!("workspace:{workspace_id}:meta:app-secret");
    let app_secret = secret_get(&secret_account)?.ok_or_else(|| "META_APP_SECRET_NOT_CONFIGURED".to_string())?;
    if app_secret.len() > 4096 || app_secret.chars().any(|character| character.is_control()) {
        return Err("META_APP_SECRET_INVALID".to_string());
    }
    let config = meta_long_lived_token_config(app_id, &app_secret, &current_token);
    let payload = meta_curl_request_with_redactions(&config, &[&app_secret, &current_token])?;
    let long_lived_token = payload
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|token| !token.is_empty())
        .ok_or_else(|| "META_LONG_LIVED_TOKEN_MISSING".to_string())?;
    meta_store_access_token(workspace_id, long_lived_token)?;
    let expires_in = payload.get("expires_in").and_then(Value::as_i64);
    let expires_at = expires_in.and_then(|seconds| std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok().map(|now| now.as_secs() as i64 + seconds));
    Ok(serde_json::json!({
        "provider": "meta",
        "status": "long_lived_token_saved",
        "expiresIn": expires_in,
        "expiresAt": expires_at,
        "tokenBoundary": "env_file"
    }))
}

#[tauri::command]
fn meta_publish_unpublished_page_post(
    workspace_id: &str,
    page_id: &str,
    message: &str,
) -> Result<Value, String> {
    validate_meta_page_id(page_id)?;
    validate_meta_message(message)?;
    let page_token = meta_page_token(workspace_id, page_id)?;
    if page_token.len() > 4096 || page_token.chars().any(|character| character.is_control()) {
        return Err("META_PAGE_ACCESS_TOKEN_INVALID".to_string());
    }
    let marker_account = format!("workspace:{workspace_id}:meta:unpublished-smoke:{page_id}");
    if let Some(existing_id) = secret_get(&marker_account)? {
        return Ok(serde_json::json!({
            "provider": "meta",
            "providerJobId": existing_id,
            "providerState": "accepted",
            "published": false,
            "idempotentReplay": true,
            "tokenBoundary": "env_file"
        }));
    }
    let mut child = Command::new("curl")
        .args([
            "--config",
            "-",
            "--silent",
            "--show-error",
            "--fail-with-body",
            "--max-time",
            "30",
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| format!("META_GRAPH_CLIENT_UNAVAILABLE: {error}"))?;
    let curl_config = format!(
        "url = \"https://graph.facebook.com/v23.0/{page_id}/feed\"\nrequest = \"POST\"\nheader = \"Authorization: Bearer {}\"\nheader = \"Accept: application/json\"\nheader = \"Content-Type: application/x-www-form-urlencoded\"\ndata-urlencode = \"message={}\"\ndata = \"published=false\"\n",
        validate_curl_config_value(&page_token),
        validate_curl_config_value(message)
    );
    child
        .stdin
        .as_mut()
        .ok_or_else(|| "META_GRAPH_STDIN_UNAVAILABLE".to_string())?
        .write_all(curl_config.as_bytes())
        .map_err(|error| format!("META_GRAPH_REQUEST_FAILED: {error}"))?;
    let output = child
        .wait_with_output()
        .map_err(|error| format!("META_GRAPH_REQUEST_FAILED: {error}"))?;
    if !output.status.success() {
        if let Ok(payload) = serde_json::from_slice::<Value>(&output.stdout) {
            if let Some(error) = payload.get("error") {
                return Err(format_meta_api_error(error));
            }
        }
        let stdout_detail = String::from_utf8_lossy(&output.stdout)
            .trim()
            .replace(&page_token, "[redacted]");
        let stderr_detail = String::from_utf8_lossy(&output.stderr)
            .trim()
            .replace(&page_token, "[redacted]");
        let detail = match (stdout_detail.is_empty(), stderr_detail.is_empty()) {
            (false, false) => format!("{stdout_detail} | stderr: {stderr_detail}"),
            (false, true) => stdout_detail,
            (true, false) => stderr_detail,
            (true, true) => "curl returned no diagnostic output".to_string(),
        };
        return Err(format!("META_GRAPH_REQUEST_FAILED: {detail}"));
    }
    let payload: Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| "META_GRAPH_INVALID_RESPONSE".to_string())?;
    if let Some(error) = payload.get("error") {
        return Err(format_meta_api_error(error));
    }
    let provider_id = payload
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "META_GRAPH_MISSING_POST_ID".to_string())?;
    secret_set(&marker_account, provider_id)?;
    Ok(serde_json::json!({
        "provider": "meta",
        "providerJobId": provider_id,
        "providerState": "accepted",
        "published": false,
        "idempotentReplay": false,
        "tokenBoundary": "env_file"
    }))
}

#[tauri::command]
fn meta_publish_page_job(
    workspace_id: &str,
    page_id: &str,
    message: &str,
    idempotency_key: &str,
) -> Result<Value, String> {
    validate_meta_page_id(page_id)?;
    validate_meta_message(message)?;
    if idempotency_key.is_empty()
        || idempotency_key.len() > 512
        || idempotency_key.chars().any(|character| character.is_control())
    {
        return Err("META_IDEMPOTENCY_KEY_INVALID".to_string());
    }
    let page_token = meta_page_token(workspace_id, page_id)?;
    if page_token.len() > 4096 || page_token.chars().any(|character| character.is_control()) {
        return Err("META_PAGE_ACCESS_TOKEN_INVALID".to_string());
    }
    let marker_account = format!("workspace:{workspace_id}:meta:queue:{idempotency_key}");
    if let Some(existing_id) = secret_get(&marker_account)? {
        return Ok(serde_json::json!({
            "provider": "meta",
            "providerJobId": existing_id,
            "providerState": "published",
            "published": true,
            "idempotentReplay": true,
            "tokenBoundary": "env_file"
        }));
    }
    let mut child = Command::new("curl")
        .args(["--config", "-", "--silent", "--show-error", "--fail-with-body", "--max-time", "30"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| format!("META_GRAPH_CLIENT_UNAVAILABLE: {error}"))?;
    let curl_config = format!(
        "url = \"https://graph.facebook.com/v23.0/{page_id}/feed\"\nrequest = \"POST\"\nheader = \"Authorization: Bearer {}\"\nheader = \"Accept: application/json\"\nheader = \"Content-Type: application/x-www-form-urlencoded\"\ndata-urlencode = \"message={}\"\ndata = \"published=true\"\n",
        validate_curl_config_value(&page_token),
        validate_curl_config_value(message)
    );
    child.stdin.as_mut().ok_or_else(|| "META_GRAPH_STDIN_UNAVAILABLE".to_string())?
        .write_all(curl_config.as_bytes())
        .map_err(|error| format!("META_GRAPH_REQUEST_FAILED: {error}"))?;
    let output = child.wait_with_output().map_err(|error| format!("META_GRAPH_REQUEST_FAILED: {error}"))?;
    if !output.status.success() {
        if let Ok(payload) = serde_json::from_slice::<Value>(&output.stdout) {
            if let Some(error) = payload.get("error") { return Err(format_meta_api_error(error)); }
        }
        let stdout_detail = String::from_utf8_lossy(&output.stdout).trim().replace(&page_token, "[redacted]");
        let stderr_detail = String::from_utf8_lossy(&output.stderr).trim().replace(&page_token, "[redacted]");
        let detail = match (stdout_detail.is_empty(), stderr_detail.is_empty()) {
            (false, false) => format!("{stdout_detail} | stderr: {stderr_detail}"),
            (false, true) => stdout_detail,
            (true, false) => stderr_detail,
            (true, true) => "curl returned no diagnostic output".to_string(),
        };
        return Err(format!("META_GRAPH_REQUEST_FAILED: {detail}"));
    }
    let payload: Value = serde_json::from_slice(&output.stdout).map_err(|_| "META_GRAPH_INVALID_RESPONSE".to_string())?;
    if let Some(error) = payload.get("error") { return Err(format_meta_api_error(error)); }
    let provider_id = payload.get("id").and_then(Value::as_str).ok_or_else(|| "META_GRAPH_MISSING_POST_ID".to_string())?;
    secret_set(&marker_account, provider_id)?;
    Ok(serde_json::json!({
        "provider": "meta",
        "providerJobId": provider_id,
        "providerState": "published",
        "published": true,
        "idempotentReplay": false,
        "tokenBoundary": "env_file"
    }))
}

#[tauri::command]
fn meta_publish_page_photo_job(
    workspace_id: &str,
    page_id: &str,
    caption: &str,
    media_url: &str,
    idempotency_key: &str,
) -> Result<Value, String> {
    validate_meta_page_id(page_id)?;
    validate_meta_message(caption)?;
    if media_url.len() > 4096 || media_url.chars().any(|character| character.is_control()) || !media_url.starts_with("https://") {
        return Err("META_MEDIA_URL_INVALID".to_string());
    }
    if idempotency_key.is_empty()
        || idempotency_key.len() > 512
        || idempotency_key.chars().any(|character| character.is_control())
    {
        return Err("META_IDEMPOTENCY_KEY_INVALID".to_string());
    }
    let page_token = meta_page_token(workspace_id, page_id)?;
    if page_token.len() > 4096 || page_token.chars().any(|character| character.is_control()) {
        return Err("META_PAGE_ACCESS_TOKEN_INVALID".to_string());
    }
    let marker_account = format!("workspace:{workspace_id}:meta:queue:photo:{idempotency_key}");
    if let Some(existing_id) = secret_get(&marker_account)? {
        return Ok(serde_json::json!({
            "provider": "meta",
            "providerJobId": existing_id,
            "providerState": "published",
            "published": true,
            "idempotentReplay": true,
            "tokenBoundary": "env_file"
        }));
    }
    let mut child = Command::new("curl")
        .args(["--config", "-", "--silent", "--show-error", "--fail-with-body", "--max-time", "60"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| format!("META_GRAPH_CLIENT_UNAVAILABLE: {error}"))?;
    let curl_config = format!(
        "url = \"https://graph.facebook.com/v23.0/{page_id}/photos\"\nrequest = \"POST\"\nheader = \"Authorization: Bearer {}\"\nheader = \"Accept: application/json\"\nheader = \"Content-Type: application/x-www-form-urlencoded\"\ndata-urlencode = \"url={}\"\ndata-urlencode = \"caption={}\"\ndata = \"published=true\"\n",
        validate_curl_config_value(&page_token),
        validate_curl_config_value(media_url),
        validate_curl_config_value(caption)
    );
    child.stdin.as_mut().ok_or_else(|| "META_GRAPH_STDIN_UNAVAILABLE".to_string())?
        .write_all(curl_config.as_bytes())
        .map_err(|error| format!("META_GRAPH_REQUEST_FAILED: {error}"))?;
    let output = child.wait_with_output().map_err(|error| format!("META_GRAPH_REQUEST_FAILED: {error}"))?;
    if !output.status.success() {
        if let Ok(payload) = serde_json::from_slice::<Value>(&output.stdout) {
            if let Some(error) = payload.get("error") { return Err(format_meta_api_error(error)); }
        }
        let stdout_detail = String::from_utf8_lossy(&output.stdout).trim().replace(&page_token, "[redacted]");
        let stderr_detail = String::from_utf8_lossy(&output.stderr).trim().replace(&page_token, "[redacted]");
        let detail = match (stdout_detail.is_empty(), stderr_detail.is_empty()) {
            (false, false) => format!("{stdout_detail} | stderr: {stderr_detail}"),
            (false, true) => stdout_detail,
            (true, false) => stderr_detail,
            (true, true) => "curl returned no diagnostic output".to_string(),
        };
        return Err(format!("META_GRAPH_REQUEST_FAILED: {detail}"));
    }
    let payload: Value = serde_json::from_slice(&output.stdout).map_err(|_| "META_GRAPH_INVALID_RESPONSE".to_string())?;
    if let Some(error) = payload.get("error") { return Err(format_meta_api_error(error)); }
    let provider_id = payload.get("post_id").or_else(|| payload.get("id")).and_then(Value::as_str).ok_or_else(|| "META_GRAPH_MISSING_POST_ID".to_string())?;
    secret_set(&marker_account, provider_id)?;
    Ok(serde_json::json!({
        "provider": "meta",
        "providerJobId": provider_id,
        "providerState": "published",
        "published": true,
        "idempotentReplay": false,
        "tokenBoundary": "env_file"
    }))
}

#[tauri::command]
fn meta_publish_instagram_job(
    workspace_id: &str,
    page_id: &str,
    instagram_user_id: &str,
    caption: &str,
    media_url: &str,
    media_kind: &str,
    idempotency_key: &str,
) -> Result<Value, String> {
    validate_meta_page_id(page_id)?;
    validate_meta_page_id(instagram_user_id)?;
    if !caption.trim().is_empty() {
        validate_meta_message(caption)?;
    }
    validate_meta_media_url(media_url)?;
    if media_kind != "image" && media_kind != "video" {
        return Err("META_INSTAGRAM_MEDIA_KIND_INVALID".to_string());
    }
    if idempotency_key.is_empty()
        || idempotency_key.len() > 512
        || idempotency_key.chars().any(|character| character.is_control())
    {
        return Err("META_IDEMPOTENCY_KEY_INVALID".to_string());
    }
    let access_token = meta_page_token(workspace_id, page_id)?;
    if access_token.len() > 4096 || access_token.chars().any(|character| character.is_control()) {
        return Err("META_PAGE_ACCESS_TOKEN_INVALID".to_string());
    }
    let marker_account = format!("workspace:{workspace_id}:meta:instagram:{idempotency_key}");
    if let Some(existing_id) = secret_get(&marker_account)? {
        return Ok(serde_json::json!({
            "provider": "meta",
            "providerJobId": existing_id,
            "providerState": "published",
            "published": true,
            "idempotentReplay": true,
            "tokenBoundary": "env_file"
        }));
    }

    let media_config = if media_kind == "image" {
        format!(
            "url = \"https://graph.facebook.com/v23.0/{instagram_user_id}/media\"\nrequest = \"POST\"\nheader = \"Authorization: Bearer {}\"\nheader = \"Accept: application/json\"\nheader = \"Content-Type: application/x-www-form-urlencoded\"\ndata-urlencode = \"image_url={}\"\ndata-urlencode = \"caption={}\"\n",
            validate_curl_config_value(&access_token),
            validate_curl_config_value(media_url),
            validate_curl_config_value(caption)
        )
    } else {
        format!(
            "url = \"https://graph.facebook.com/v23.0/{instagram_user_id}/media\"\nrequest = \"POST\"\nheader = \"Authorization: Bearer {}\"\nheader = \"Accept: application/json\"\nheader = \"Content-Type: application/x-www-form-urlencoded\"\ndata-urlencode = \"media_type=REELS\"\ndata-urlencode = \"video_url={}\"\ndata-urlencode = \"caption={}\"\n",
            validate_curl_config_value(&access_token),
            validate_curl_config_value(media_url),
            validate_curl_config_value(caption)
        )
    };
    let container = meta_curl_request(&media_config, &access_token)?;
    let creation_id = container
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "META_INSTAGRAM_MISSING_CONTAINER_ID".to_string())?;
    if media_kind == "video" {
        wait_for_instagram_container(creation_id, &access_token)?;
    }
    let publish_config = format!(
        "url = \"https://graph.facebook.com/v23.0/{instagram_user_id}/media_publish\"\nrequest = \"POST\"\nheader = \"Authorization: Bearer {}\"\nheader = \"Accept: application/json\"\nheader = \"Content-Type: application/x-www-form-urlencoded\"\ndata-urlencode = \"creation_id={}\"\n",
        validate_curl_config_value(&access_token),
        validate_curl_config_value(creation_id)
    );
    let published = meta_curl_request(&publish_config, &access_token)?;
    let provider_id = published
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or(creation_id);
    secret_set(&marker_account, provider_id)?;
    Ok(serde_json::json!({
        "provider": "meta",
        "providerJobId": provider_id,
        "providerState": "published",
        "published": true,
        "idempotentReplay": false,
        "tokenBoundary": "env_file"
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(subscription_commands!(generate_registered_handler))
        .run(tauri::generate_context!())
        .expect("error while running SignalFlow desktop application");
}
