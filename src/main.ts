import './style.css'

document.documentElement.classList.add(`platform-${window.api.platform}`)

function applyTokens(tokens: { theme: 'dark' | 'light' }) {
    document.documentElement.dataset.theme = tokens.theme
}

const initial = window.api.splashTokens?.()
if (initial) applyTokens(initial)

let lastTheme = initial?.theme
setInterval(() => {
    const t = window.api.splashTokens?.()
    if (t && t.theme !== lastTheme) {
        lastTheme = t.theme
        applyTokens(t)
    }
}, 1000)

const SPLASH_FALLBACK_MS = 30_000
const SPLASH_MIN_MS = 800

const splash = document.getElementById('splash') as HTMLDivElement | null
const frame = document.getElementById('dsh-frame') as HTMLIFrameElement | null
const tStart = performance.now()
let dismissed = false

function dismissSplash() {
    if (dismissed || !splash) return
    dismissed = true

    const elapsed = performance.now() - tStart
    const wait = Math.max(0, SPLASH_MIN_MS - elapsed)

    setTimeout(() => {
        if (frame) frame.classList.remove('is-loading')

        requestAnimationFrame(() => {
            splash.classList.add('is-done')
            splash.addEventListener(
                'transitionend',
                () => splash.remove(),
                { once: true },
            )
            setTimeout(() => splash.remove(), 800)
        })
    }, wait)
}

window.api.onStatus((s: any) => {
    if (s.state === 'ready' && s.url && frame && !frame.src) {
        frame.src = s.url
        frame.addEventListener(
            'load',
            () => dismissSplash(),
            { once: true },
        )
    } else if (s.state === 'error') {
    }
})

setTimeout(() => dismissSplash(), SPLASH_FALLBACK_MS)
