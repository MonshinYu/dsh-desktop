import './style.css'

document.documentElement.classList.add(`platform-${window.api.platform}`)

// ---------------------------------------------------------------------------
// Theme sync. The bootstrap script in index.html already set data-theme
// before paint, but it had to guess from prefers-color-scheme. The main
// process pushes dsh's persisted preference here; when that lands we upgrade
// data-theme (and the splash CSS variables) without re-triggering paint.
// ---------------------------------------------------------------------------
function applyTokens(tokens: { theme: 'dark' | 'light' }) {
    document.documentElement.dataset.theme = tokens.theme
}

const initial = window.api.splashTokens?.()
if (initial) applyTokens(initial)

// Subscribe to future updates (system theme change, etc.).
// The main process caches the latest value into splashTokens() each time
// it pushes, so we poll-and-diff rather than registering a dedicated IPC
// (avoids widening the preload surface).
let lastTheme = initial?.theme
setInterval(() => {
    const t = window.api.splashTokens?.()
    if (t && t.theme !== lastTheme) {
        lastTheme = t.theme
        applyTokens(t)
    }
}, 1000)

// ---------------------------------------------------------------------------
// Splash dismissal. We dismiss only after both:
//   (a) the dsh server reports `ready` (HTTP port bound), AND
//   (b) the iframe finishes loading its initial document AND fires `load`,
//       so the user sees the splash disappear exactly as the dsh UI appears.
// The splash also has a hard ceiling to avoid stalling the app forever
// (e.g. if the user closed the iframe or dsh never started).
// ---------------------------------------------------------------------------
const SPLASH_FALLBACK_MS = 30_000 // dsh-server's START_TIMEOUT_MS
const SPLASH_MIN_MS = 800          // never flash past the opening beat

const splash = document.getElementById('splash') as HTMLDivElement | null
const frame = document.getElementById('dsh-frame') as HTMLIFrameElement | null
const tStart = performance.now()
let dismissed = false

function dismissSplash() {
    if (dismissed || !splash) return
    dismissed = true

    // Honor the splash's own pace: never end before its minimum beat.
    const elapsed = performance.now() - tStart
    const wait = Math.max(0, SPLASH_MIN_MS - elapsed)

    setTimeout(() => {
        if (frame) frame.classList.remove('is-loading')

        // Brief beat so the iframe has time to commit its first paint
        // before we cross-fade the splash out. Then drop the splash.
        requestAnimationFrame(() => {
            splash.classList.add('is-done')
            splash.addEventListener(
                'transitionend',
                () => splash.remove(),
                { once: true },
            )
            // Safety: if the transitionend never fires (reduced motion etc.)
            setTimeout(() => splash.remove(), 800)
        })
    }, wait)
}

// Start the dsh iframe as soon as the URL is known. We kick the request
// immediately on `ready` and dismiss the splash after the iframe's load
// event, so the transition lines up with dsh's first paint.
window.api.onStatus((s: any) => {
    if (s.state === 'ready' && s.url && frame && !frame.src) {
        frame.src = s.url
        frame.addEventListener(
            'load',
            () => dismissSplash(),
            { once: true },
        )
        // If the iframe load never fires (very rare — e.g. the URL fails
        // entirely) the fallback timer below will still dismiss it.
    } else if (s.state === 'error') {
        // Keep the splash visible; the dsh web UI itself will surface the
        // error state if/when the iframe ever loads. We still drop the
        // splash at the fallback ceiling so the user isn't stuck.
    }
})

// Hard ceiling — also covers the case where the user never gets a `ready`
// status (e.g. dsh crashed before binding).
setTimeout(() => dismissSplash(), SPLASH_FALLBACK_MS)
