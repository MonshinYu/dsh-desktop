import { ipcRenderer, contextBridge } from 'electron'

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
})

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

  splashTokens: (() => {
    let cached: { theme: 'dark' | 'light'; bg: string; fg: string } | null = null
    ipcRenderer.on('dsh:splash-tokens', (_e, t) => {
      cached = t
    })
    return () => cached
  })(),

  setTitleBarOverlay: (opts: { color: string; symbolColor: string }) => {
    ipcRenderer.send('dsh:titlebar-overlay', opts)
  },
})
