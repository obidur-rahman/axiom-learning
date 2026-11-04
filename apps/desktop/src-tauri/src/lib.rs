use keyring::Entry;

/// Service name used for every keyring entry.
const SERVICE: &str = "axiom-learning";

/// Store a secret (e.g. an API key) in the OS secure store.
#[tauri::command]
fn set_secret(key: String, value: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

/// Read a secret. A missing secret returns None (not an error).
#[tauri::command]
fn get_secret(key: String) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Delete a secret.
#[tauri::command]
fn delete_secret(key: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Local SQLite. Connection strings and migrations are handled in
        // TypeScript (packages/data keeps all logic, per the pivot plan).
        .plugin(tauri_plugin_sql::Builder::new().build())
        .invoke_handler(tauri::generate_handler![get_secret, set_secret, delete_secret])
        .run(tauri::generate_context!())
        .expect("error while running the Axiom Learning desktop app");
}
