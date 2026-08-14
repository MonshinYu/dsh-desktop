import { app, nativeTheme } from 'electron'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export type SplashTokens = {
  theme: 'dark' | 'light'
  bg: string
  fg: string
}

const DARK_BG = '#16181d'
const DARK_FG = 'rgba(255, 255, 255, 0.92)'
const LIGHT_BG = '#ffffff'
const LIGHT_FG = 'rgba(0, 0, 0, 0.88)'

function readDshThemePreference(): 'dark' | 'light' | 'system' | null {
  try {
    const dshHome = path.join(app.getPath('userData'), 'dsh')
    const settingsPath = path.join(dshHome, 'settings.yaml')
    if (!existsSync(settingsPath)) return null

    const text = readFileSync(settingsPath, 'utf8')
    const m = text.match(/^\s*theme:\s*['"]?(dark|light|system)['"]?\s*(?:#.*)?$/im)
    return (m?.[1] as 'dark' | 'light' | 'system' | undefined) ?? null
  } catch {
    return null
  }
}

export function resolveSplashTokens(): SplashTokens {
  const pref = readDshThemePreference()
  let theme: 'dark' | 'light'

  if (pref === 'dark' || pref === 'light') {
    theme = pref
  } else {
    theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }

  return theme === 'dark'
    ? { theme, bg: DARK_BG, fg: DARK_FG }
    : { theme, bg: LIGHT_BG, fg: LIGHT_FG }
}

export function bundledDshDefaultTheme(): 'dark' | 'light' {
  try {
    const req = createRequire(import.meta.url)
    const jsonPath = req.resolve('@deepseek-ai/dsh-web-app/dist/default-theme.json')
    if (existsSync(jsonPath)) {
      const raw = JSON.parse(readFileSync(jsonPath, 'utf8')) as { theme?: string }
      if (raw.theme === 'dark' || raw.theme === 'light') return raw.theme
    }
  } catch {
  }
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}
