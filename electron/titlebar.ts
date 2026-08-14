import { BrowserWindow, ipcMain, type BrowserWindowConstructorOptions } from 'electron'
import { resolveSplashTokens } from './splash-theme'

export function windowChromeOptions(
  options: BrowserWindowConstructorOptions,
): BrowserWindowConstructorOptions {
  const tokens = resolveSplashTokens()
  if (process.platform === 'darwin') {
    options.titleBarStyle = 'hiddenInset'
  } else if (process.platform === 'win32') {
    options.titleBarStyle = 'hidden'
    options.titleBarOverlay = {
      height: TITLEBAR_HEIGHT,
      color: '#00000000',
      symbolColor: tokens.theme === 'dark'
        ? 'rgba(255, 255, 255, 0.87)'
        : 'rgba(0, 0, 0, 0.75)',
    }
  }
  return options
}

export const TITLEBAR_HEIGHT = 35

const DRAG_REGION_CSS = `
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
  .hHd-Xa_root {
    padding-top: 38px !important;
  }
  .hHd-Xa_root.hHd-Xa_collapsed {
    padding-top: 38px !important;
  }
`

const WIN_CSS = DRAG_REGION_CSS + `
  .wSkVaW_header {
    padding-right: calc(env(titlebar-area-width, 138px) + 8px) !important;
  }
`

const WEBUI_THEME_SYNC_JS = `
  (() => {
    if (document.getElementById('splash')) return
    if (!window.api || typeof window.api.setTitleBarOverlay !== 'function') return
    if (window.__dshDesktopTitlebarSync) return
    window.__dshDesktopTitlebarSync = true

    const apply = () => {
      const dark = document.body.hasAttribute('data-ds-dark-theme')
      window.api.setTitleBarOverlay({
        color: '#00000000',
        symbolColor: dark === false ? 'rgba(0, 0, 0, 0.75)' : 'rgba(255, 255, 255, 0.87)',
      })
    }

    window.addEventListener('load', apply)
    for (const delay of [500, 1500, 3000]) setTimeout(apply, delay)
    new MutationObserver(apply).observe(document.body, {
      attributes: true,
      attributeFilter: ['data-ds-dark-theme'],
    })
  })()
`

let currentWin: BrowserWindow | null = null
let ipcInstalled = false

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
        }
      },
    )
  }

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
  }
}
