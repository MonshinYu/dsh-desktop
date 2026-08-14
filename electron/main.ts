import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { dshServer } from './dsh-server'
import { installTitlebarInjection, windowChromeOptions } from './titlebar'
import { resolveSplashTokens } from './splash-theme'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    } else {
      createWindow()
    }
  })

  app.on('before-quit', () => {
    void dshServer.stop()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
      win = null
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  app.whenReady().then(() => {
    ipcMain.handle('dsh:get-status', () => dshServer.getStatus())
    ipcMain.handle('dsh:retry', () => {
      dshServer.start()
    })
    const pushTokens = () => {
      win?.webContents.send('dsh:splash-tokens', resolveSplashTokens())
    }
    pushTokens()
    nativeTheme.on('updated', pushTokens)

    createWindow()
    dshServer.start()
  })
}

function createWindow() {
  const splashTokens = resolveSplashTokens()

  win = new BrowserWindow(
    windowChromeOptions({
      show: false,
      width: 1280,
      height: 840,
      backgroundColor: splashTokens.bg,
      icon: path.join(process.env.VITE_PUBLIC, 'favicon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.mjs'),
        backgroundThrottling: false,
      },
    }),
  )

  installTitlebarInjection(win)

  win.webContents.on('did-start-loading', () => {
    win?.webContents.send('dsh:splash-tokens', resolveSplashTokens())
  })

  win.on('ready-to-show', () => {
    win?.show()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('dsh:status', dshServer.getStatus())
  })
  dshServer.onStatus((s) => {
    win?.webContents.send('dsh:status', s)
    if (s.state === 'ready' && VITE_DEV_SERVER_URL && win && !win.webContents.isDevToolsOpened()) {
      win.webContents.openDevTools({ mode: 'detach' })
    }
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}
