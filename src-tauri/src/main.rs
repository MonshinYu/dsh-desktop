#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod invoke;
mod core;

use crate::invoke::{check_page::check_page, get_port::get_port};
use crate::core::get_available_port::get_available_port;
use crate::core::store::AppState;
use crate::core::tray::{build_tray, handle_window_event};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Manager;

pub struct RuntimeHandle(pub Arc<Mutex<Option<Child>>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
fn main() {
    std::panic::set_hook(Box::new(|info| {
        eprintln!("{info}");
    }));

    let initial_port = get_available_port(None);
    let state = AppState::new(initial_port);

    let app = tauri::Builder::default()
        .manage(state)
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_port, check_page])
        .setup(move |app| {
            println!(
                "[Rust Setup] DeepSeek Harness Bun Runtime, initial port = {}",
                initial_port
            );

            let child = spawn_dsh(app.handle(), initial_port)?;
            let handle = Arc::new(Mutex::new(Some(child)));
            watch_dsh(Arc::clone(&handle));
            app.manage(RuntimeHandle(handle));

            if let Err(err) = build_tray(app.handle()) {
                eprintln!("[Rust Setup] 创建托盘失败: {err}");
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            handle_window_event(window.app_handle(), event);
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<RuntimeHandle>() {
                if let Ok(mut guard) = state.0.lock() {
                    if let Some(mut child) = guard.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        }
    });
}

fn spawn_dsh<R: tauri::Runtime>(app: &tauri::AppHandle<R>, port: u16) -> tauri::Result<Child> {
    let runtime_path = {
        #[cfg(target_os = "macos")]
        {
            "../runtime/dsh"
        }
        #[cfg(target_os = "linux")]
        {
            "../runtime/dsh"
        }
        #[cfg(target_os = "windows")]
        {
            "../runtime/dsh.exe"
        }
    };
    let dsh = app
        .path()
        .resolve(runtime_path, tauri::path::BaseDirectory::Resource)
        .map_err(|e| tauri::Error::AssetNotFound(e.to_string()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = std::fs::metadata(&dsh) {
            let mut permissions = metadata.permissions();
            if permissions.mode() & 0o111 == 0 {
                permissions.set_mode(permissions.mode() | 0o755);
                let _ = std::fs::set_permissions(&dsh, permissions);
            }
        }
    }

    let (dsh_stdout, dsh_stderr) = dsh_stdio();
    let mut command = Command::new(dsh);
    command
        .args(["web", "--port", &port.to_string()])
        .stdout(dsh_stdout)
        .stderr(dsh_stderr);

    if let Some(bun_dir) = find_bun_dir() {
        let separator = if cfg!(windows) { ";" } else { ":" };
        let existing = std::env::var("PATH").unwrap_or_default();
        command.env(
            "PATH",
            format!("{}{}{}", bun_dir.display(), separator, existing),
        );
    }

    command.spawn().map_err(Into::into)
}

fn find_bun_dir() -> Option<PathBuf> {
    let bun_name = if cfg!(windows) { "bun.exe" } else { "bun" };

    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(path) = std::env::var("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    if let Ok(home) = std::env::var("HOME") {
        dirs.push(PathBuf::from(home).join(".bun").join("bin"));
    }
    dirs.push(PathBuf::from("/usr/local/bin"));
    dirs.push(PathBuf::from("/opt/homebrew/bin"));

    dirs.iter()
        .find(|dir| dir.join(bun_name).is_file())
        .cloned()
}

fn watch_dsh(handle: Arc<Mutex<Option<Child>>>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(2));

        let Ok(mut guard) = handle.lock() else { break };
        let Some(child) = guard.as_mut() else { break };

        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    eprintln!("[dsh] 运行时异常退出: {status}");
                }
                *guard = None;
                break;
            }
            Ok(None) => continue,
            Err(err) => {
                eprintln!("[dsh] 监控子进程失败: {err}");
                break;
            }
        }
    });
}

fn dsh_stdio() -> (Stdio, Stdio) {
    #[cfg(debug_assertions)]
    {
        (Stdio::inherit(), Stdio::inherit())
    }
    #[cfg(not(debug_assertions))]
    {
        (Stdio::null(), Stdio::null())
    }
}
