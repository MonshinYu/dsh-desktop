import { BrowserWindow, ipcMain, type BrowserWindowConstructorOptions } from 'electron'
import { resolveSplashTokens } from './splash-theme'

/**
 * Platform-specific window chrome for the desktop shell.
 *
 *   macOS   - titleBarStyle: 'hiddenInset': hide the title bar but keep the
 *             traffic lights inset into the content's top-left corner.
 *   Windows - titleBarStyle: 'hidden' + titleBarOverlay: hide the title bar
 *             and let Chromium draw the window controls (min/max/close) over
 *             the content's top-right corner (Window Controls Overlay).
 *             color starts as the splash's background; once the dsh web UI
 *             loads it reports its own theme and the overlay is re-colored
 *             through dsh:titlebar-overlay (see installTitlebarInjection).
 *   Linux   - keep the default native frame; nothing to do.
 */
export function windowChromeOptions(
  options: BrowserWindowConstructorOptions,
): BrowserWindowConstructorOptions {
  // Window control overlay color must match the splash background — otherwise
  // the title bar strip would visibly flash a different color on Windows.
  const tokens = resolveSplashTokens()
  if (process.platform === 'darwin') {
    options.titleBarStyle = 'hiddenInset'
  } else if (process.platform === 'win32') {
    options.titleBarStyle = 'hidden'
    options.titleBarOverlay = {
      height: TITLEBAR_HEIGHT,
      color: tokens.bg,
      symbolColor: tokens.theme === 'dark'
        ? 'rgba(255, 255, 255, 0.87)'
        : 'rgba(0, 0, 0, 0.75)',
    }
  }
  // linux: keep the default frame.
  return options
}

/** Overlay strip height; keep in sync with #titlebar in src/style.css. */
export const TITLEBAR_HEIGHT = 35

/**
 * The dsh web UI is a third-party React bundle with build-hashed class names,
 * so the shell injects the drag regions and window-control insets instead of
 * the UI knowing about the desktop chrome.
 *
 * Drag regions use suffix selectors ([class$="_header"] etc.): the dsh
 * frontend's CSS-module build preserves the local names with a hashed prefix
 * (e.g. wSkVaW_header, hHd-Xa_root). Interactivity is preserved because every
 * descendant is explicitly no-drag; only the strips' own empty/padding areas
 * drag the window.
 *
 * The two inset rules below target the exact classes shipped by the installed
 * dsh version; re-verify them when @deepseek-ai/dsh is upgraded (a hash change
 * degrades gracefully - insets stop applying but the app keeps working).
 */

/** Make header strips, column-root padding areas, and tab rows window drag handles. */
const DRAG_REGION_CSS = `
  /* Descendants stay interactive; the no-drag block must precede the drag block
     so the strip elements themselves win at equal specificity. */
  [class$="_header"] *,
  [class$="_root"] *,
  [class$="_logoRow"] *,
  [class$="_titleCluster"] *,
  [class$="_tabs"] * {
    -webkit-app-region: no-drag;
  }
  [class$="_header"],
  [class$="_root"],
  [class$="_logoRow"],
  [class$="_titleCluster"],
  [class$="_tabs"] {
    -webkit-app-region: drag;
  }
`

const MAC_CSS = DRAG_REGION_CSS + `
  /* Clear the traffic lights (x 12..78, y 12..26): push the sidebar content
     below them; the emptied strip stays draggable via the root's padding. */
  .hHd-Xa_root {
    padding-top: 38px !important;
  }
  .hHd-Xa_root.hHd-Xa_collapsed {
    padding-top: 38px !important;
  }
`

const WIN_CSS = DRAG_REGION_CSS + `
  /* Keep the conversation header actions clear of the window controls overlay
     at the top-right corner (3 caption buttons ~46px each + breathing room). */
  .wSkVaW_header {
    padding-right: calc(env(titlebar-area-width, 138px) + 8px) !important;
  }
`

/**
 * Re-color the Windows overlay to match the web UI's theme. Runs in the page
 * context: the theme plugin sets data-ds-dark-theme on <body> and the
 * --dsw-alias-bg-base variable after boot, so re-apply on a timer and on
 * attribute changes. Skipped on the splash page (it has its own background).
 */
const WEBUI_THEME_SYNC_JS = `
  (() => {
    if (document.getElementById('splash')) return
    if (!window.api || typeof window.api.setTitleBarOverlay !== 'function') return
    if (window.__dshDesktopTitlebarSync) return
    window.__dshDesktopTitlebarSync = true

    const apply = () => {
      const dark = document.body.hasAttribute('data-ds-dark-theme')
      const bg = getComputedStyle(document.documentElement)
        .getPropertyValue('--dsw-alias-bg-base')
        .trim()
      window.api.setTitleBarOverlay({
        color: bg || (dark === false ? '#ffffff' : '#16181d'),
        symbolColor: dark === false ? 'rgba(0, 0, 0, 0.75)' : 'rgba(255, 255, 255, 0.87)',
      })
    }

    window.addEventListener('load', apply)
    // The theme plugin applies its attributes/variables asynchronously.
    for (const delay of [500, 1500, 3000]) setTimeout(apply, delay)
    new MutationObserver(apply).observe(document.body, {
      attributes: true,
      attributeFilter: ['data-ds-dark-theme'],
    })
  })()
`

let currentWin: BrowserWindow | null = null
let ipcInstalled = false

/**
 * Wire the per-page chrome injection and the Windows overlay theme sync IPC.
 * Safe to call once per created window (the IPC handler follows the window).
 */
export function installTitlebarInjection(win: BrowserWindow): void {
  currentWin = win

  if (!ipcInstalled) {
    ipcInstalled = true
    ipcMain.on(
      'dsh:titlebar-overlay',
      (_event, opts: { color: string; symbolColor: string }) => {
        if (process.platform !== 'win32') return
        if (!currentWin || currentWin.isDestroyed()) return
        try {
          currentWin.setTitleBarOverlay({
            height: TITLEBAR_HEIGHT,
            color: opts.color,
            symbolColor: opts.symbolColor,
          })
        } catch {
          /* window may be mid-teardown */
        }
      },
    )
  }

  // Runs for every document load in this window: the splash and the dsh web UI.
  win.webContents.on('dom-ready', () => {
    void injectWebUiChrome(win)
  })
}

async function injectWebUiChrome(win: BrowserWindow): Promise<void> {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return
  const css = process.platform === 'darwin' ? MAC_CSS : WIN_CSS
  try {
    await win.webContents.insertCSS(css)
    if (process.platform === 'win32') {
      await win.webContents.executeJavaScript(WEBUI_THEME_SYNC_JS)
    }
  } catch {
    // Not a real page yet (e.g. about:blank); the next load retries.
  }
}
