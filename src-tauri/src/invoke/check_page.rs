use crate::core::store::AppState;
use serde::Serialize;
use std::time::Duration;

#[derive(Serialize)]
pub struct PageStatus {
    pub port: u16,
    pub generation: u64,
    pub ready: bool,
}

#[tauri::command]
pub async fn check_page(state: tauri::State<'_, AppState>) -> Result<PageStatus, String> {
    let port = state.current_port();
    let url = format!("http://127.0.0.1:{}", port);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(800))
        .build()
        .map_err(|e| e.to_string())?;

    let ready = match client.get(&url).send().await {
        Ok(response) => response.status().is_success(),
        Err(_) => false,
    };

    Ok(PageStatus {
        port,
        generation: state.current_generation(),
        ready,
    })
}