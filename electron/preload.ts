import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})

// --------- dsh server status API for the splash page ---------
contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  getServerStatus: () => ipcRenderer.invoke('dsh:get-status'),
  retry: () => ipcRenderer.invoke('dsh:retry'),
  onStatus: (cb: (s: unknown) => void) => {
    const listener = (_event: unknown, s: unknown) => cb(s)
    ipcRenderer.on('dsh:status', listener)
    return () => {
      ipcRenderer.off('dsh:status', listener)
    }
  },

  /**
   * Splash-time theme tokens resolved by the main process BEFORE the renderer
   * paints, so the splash picks colors without a flash:
   *   - theme: 'dark' | 'light' (dsh's persisted preference, falling back to
   *            nativeTheme.shouldUseDarkColors).
   *   - bg / fg: matching background and foreground colors the renderer can
   *            apply to <html style> on its very first frame — eliminating the
   *            white frame Chromium shows when backgroundColor isn't set on
   *            the BrowserWindow.
   * Cached because nativeTheme events arrive via the same channel.
   */
  splashTokens: (() => {
    let cached: { theme: 'dark' | 'light'; bg: string; fg: string } | null = null
    ipcRenderer.on('dsh:splash-tokens', (_e, t) => {
      cached = t
    })
    return () => cached
  })(),

  // Windows only: recolor the Window Controls Overlay to match the web UI theme.
  setTitleBarOverlay: (opts: { color: string; symbolColor: string }) => {
    ipcRenderer.send('dsh:titlebar-overlay', opts)
  },
})
