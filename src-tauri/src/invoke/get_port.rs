use crate::core::store::AppState;

#[derive(serde::Serialize)]
pub struct PortInfo {
    pub port: u16,
    pub generation: u64,
}

#[tauri::command]
pub fn get_port(state: tauri::State<'_, AppState>) -> PortInfo {
    PortInfo {
        port: state.current_port(),
        generation: state.current_generation(),
    }
}