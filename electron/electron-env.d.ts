/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, expose in `preload.ts`
interface DshStatusShape {
  state: 'starting' | 'ready' | 'error'
  url?: string
  message?: string
  detail?: string
}

interface Window {
  ipcRenderer: import('electron').IpcRenderer
  api: {
    /** 'darwin' | 'win32' | 'linux' | ... — the OS the shell is running on. */
    platform: NodeJS.Platform
    getServerStatus(): Promise<DshStatusShape>
    retry(): Promise<void>
    onStatus(cb: (s: DshStatusShape) => void): () => void
    /** Windows only: recolor the window controls overlay to match the web UI theme. */
    setTitleBarOverlay(opts: { color: string; symbolColor: string }): void
  }
}
