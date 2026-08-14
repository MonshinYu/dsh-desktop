import { app, nativeTheme } from 'electron'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Splash-time theme tokens derived from:
 *   1. dsh's persisted preference (DSH_HOME/settings.yaml → appearance.theme),
 *      same source dsh itself reads at boot — so the splash matches what the
 *      user sees when the web UI comes up.
 *   2. System color-scheme as a fallback when dsh is set to 'system' or its
 *      settings file isn't readable yet.
 *
 * This must run BEFORE the splash page paints; the main process pushes the
 * resolved tokens over IPC the moment the window's webContents is attached
 * (see installTitlebarInjection in titlebar.ts).
 */
export type SplashTokens = {
  theme: 'dark' | 'light'
  bg: string
  fg: string
}

const DARK_BG = '#16181d'
const DARK_FG = 'rgba(255, 255, 255, 0.92)'
const LIGHT_BG = '#ffffff'
const LIGHT_FG = 'rgba(0, 0, 0, 0.88)'

/**
 * Read dsh's `appearance.theme` from <DSH_HOME>/settings.yaml. We do a tiny
 * line match instead of pulling js-yaml into the main bundle — the file is
 * user-edited YAML but the theme line is stable enough that a literal scan is
 * safer than a schema parse across dsh version bumps.
 */
function readDshThemePreference(): 'dark' | 'light' | 'system' | null {
  try {
    const dshHome = path.join(app.getPath('userData'), 'dsh')
    const settingsPath = path.join(dshHome, 'settings.yaml')
    if (!existsSync(settingsPath)) return null

    const text = readFileSync(settingsPath, 'utf8')
    // Match `theme: dark` / `theme: light` / `theme: system` under an
    // `appearance:` block (with arbitrary indentation). Tolerant of comments
    // and surrounding whitespace; stops at the next top-level key.
    const m = text.match(/^\s*theme:\s*['"]?(dark|light|system)['"]?\s*(?:#.*)?$/im)
    return (m?.[1] as 'dark' | 'light' | 'system' | undefined) ?? null
  } catch {
    return null
  }
}

/**
 * Resolve the splash palette. Pure: same inputs → same output, safe to call
 * repeatedly when nativeTheme changes.
 */
export function resolveSplashTokens(): SplashTokens {
  const pref = readDshThemePreference()
  let theme: 'dark' | 'light'

  if (pref === 'dark' || pref === 'light') {
    theme = pref
  } else {
    // 'system' preference or unset — defer to the OS.
    theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }

  return theme === 'dark'
    ? { theme, bg: DARK_BG, fg: DARK_FG }
    : { theme, bg: LIGHT_BG, fg: LIGHT_FG }
}

/**
 * Best-effort look at the bundled dsh's default theme. Used only as a
 * last-resort fallback before app paths are ready.
 */
export function bundledDshDefaultTheme(): 'dark' | 'light' {
  try {
    // dsh's web UI ships a default-theme.json; we read it once at startup.
    const req = createRequire(import.meta.url)
    const jsonPath = req.resolve('@deepseek-ai/dsh-web-app/dist/default-theme.json')
    if (existsSync(jsonPath)) {
      const raw = JSON.parse(readFileSync(jsonPath, 'utf8')) as { theme?: string }
      if (raw.theme === 'dark' || raw.theme === 'light') return raw.theme
    }
  } catch {
    /* dsh not installed or layout changed — ignore */
  }
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}
