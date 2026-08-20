use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime, WindowEvent};

fn tray_icon_px() -> u32 {
    if cfg!(target_os = "macos") {
        18
    } else {
        32
    }
}

pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let toggle = MenuItem::with_id(app, "tray_toggle", "显示/隐藏", true, None::<&str>)?;
    let open_browser =
        MenuItem::with_id(app, "tray_open_browser", "使用默认浏览器打开", true, None::<&str>)?;
    let devtools = MenuItem::with_id(
        app,
        "tray_devtools",
        "打开开发者控制台",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray_quit", "退出", true, None::<&str>)?;

    let links_submenu =
        Submenu::with_items(app, "链接", true, &[&open_browser, &devtools])?;

    Menu::with_items(app, &[&toggle, &links_submenu, &separator, &quit])
}

pub fn handle_window_event<R: Runtime>(app: &AppHandle<R>, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
    }
}

fn toggle_window_visibility<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);
        if visible {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
}

pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    match event.id().as_ref() {
        "tray_toggle" => toggle_window_visibility(app),
        "tray_open_browser" => {
            if let Some(state) = app.try_state::<crate::core::store::AppState>() {
                let port = state.current_port();
                let url = format!("http://127.0.0.1:{}", port);
                let _ = tauri_plugin_opener::OpenerExt::opener(app).open_url(url, None::<&str>);
            }
        }
        "tray_devtools" => {
            if let Some(window) = app.get_webview_window("main") {
                if window.is_visible().unwrap_or(false) {
                    if !window.is_focused().unwrap_or(false) {
                        let _ = window.set_focus();
                    }
                    #[cfg(debug_assertions)]
                    if window.is_devtools_open() {
                        window.close_devtools();
                    } else {
                        window.open_devtools();
                    }
                } else {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        }
        "tray_quit" => {
            app.exit(0);
        }
        _ => {}
    }
}

pub fn handle_tray_event<R: Runtime>(app: &AppHandle<R>, event: TrayIconEvent) {
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        toggle_window_visibility(app);
    }
}

fn on_tray_icon<R: Runtime>(
    tray: &tauri::tray::TrayIcon<R>,
    event: TrayIconEvent,
) {
    handle_tray_event(tray.app_handle(), event);
}

pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = build_menu(app)?;
    let icon = load_tray_icon(app).unwrap_or_else(|| {
        tauri::image::Image::new_owned(vec![0u8; 4], 1, 1)
    });

    TrayIconBuilder::with_id("dsh-tray")
        .tooltip("DeepSeek Harness Desktop")
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| handle_menu_event(app, event))
        .on_tray_icon_event(|tray, event| on_tray_icon(tray, event))
        .build(app)
        .map(|_| ())
}

fn load_tray_icon<R: Runtime>(app: &AppHandle<R>) -> Option<tauri::image::Image<'static>> {
    let svg_path = app
        .path()
        .resolve(
            "../src/assets/logo.svg",
            tauri::path::BaseDirectory::Resource,
        )
        .ok()?;

    let svg_bytes = std::fs::read(&svg_path).ok()?;

    let opt = usvg::Options::default();
    let tree = usvg::Tree::from_data(&svg_bytes, &opt).ok()?;

    let size = tree.size().to_int_size();
    let width = tray_icon_px();
    let scale = width as f32 / size.width() as f32;
    let height = (size.height() as f32 * scale).round() as u32;
    let height = height.max(1);

    let mut pixmap = tiny_skia::Pixmap::new(width, height)?;
    resvg::render(
        &tree,
        tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );

    Some(tauri::image::Image::new_owned(
        pixmap.take(),
        width,
        height,
    ))
}
