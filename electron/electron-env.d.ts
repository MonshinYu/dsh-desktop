/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    APP_ROOT: string
    VITE_PUBLIC: string
  }
}

interface DshStatusShape {
  state: 'starting' | 'ready' | 'error'
  url?: string
  message?: string
  detail?: string
}

interface Window {
  ipcRenderer: import('electron').IpcRenderer
  api: {
    platform: NodeJS.Platform
    getServerStatus(): Promise<DshStatusShape>
    retry(): Promise<void>
    onStatus(cb: (s: DshStatusShape) => void): () => void
    setTitleBarOverlay(opts: { color: string; symbolColor: string }): void
  }
}
