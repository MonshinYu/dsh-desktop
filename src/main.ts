import {invoke} from '@tauri-apps/api/core';

interface PortInfo {
    port: number;
    generation: number;
}

interface PageStatus extends PortInfo {
    ready: boolean;
}

const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

const SPLASH_FADE_MS = 360;

export const onLoadedPage = async (interval = 1000, timeout = 120000): Promise<PortInfo> => {
    const start = Date.now();
    let lastGeneration = -1;

    while (timeout === 0 || Date.now() - start < timeout) {
        try {
            const status = await invoke<PageStatus>('check_page');

            if (status.generation !== lastGeneration) {
                lastGeneration = status.generation;
            }

            if (status.ready) {
                return {port: status.port, generation: status.generation};
            }
        } catch (e) {
            console.error('[onLoadedPage] check_page 失败', e);
        }
        await sleep(interval);
    }

    throw new Error(`页面加载超时（${timeout}ms）`);
};

const fadeOutAndRemove = (el: HTMLElement, durationMs: number) =>
    new Promise<void>((resolve) => {
        const reduceMotion =
            window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        const finish = () => {
            el.removeEventListener('transitionend', finish);
            el.remove();
            resolve();
        };

        el.style.opacity = '0';
        el.style.pointerEvents = 'none';

        if (reduceMotion || durationMs <= 0) {
            finish();
            return;
        }

        el.style.transition = `opacity ${durationMs}ms ease-out`;
        el.addEventListener('transitionend', finish, {once: true});

        setTimeout(finish, durationMs + 80);
    });

const waitForIframeLoad = (iframe: HTMLIFrameElement, timeoutMs = 15000): Promise<void> => new Promise((resolve) => {
    let settled = false;

    const done = () => {
        if (settled) return;
        settled = true;
        iframe.removeEventListener('load', done);
        iframe.removeEventListener('error', done);
        resolve();
    };

    iframe.addEventListener('load', done, {once: true});
    iframe.addEventListener('error', done, {once: true});

    setTimeout(done, timeoutMs);
});

window.addEventListener('load', async () => {
    const splash = document.querySelector<HTMLElement>('#splash');
    const iframe = document.querySelector<HTMLIFrameElement>('iframe');
    if (!iframe) return;

    try {
        const info = await onLoadedPage();
        iframe.src = `http://127.0.0.1:${info.port}`;
        await waitForIframeLoad(iframe);

        if (splash) {
            await fadeOutAndRemove(splash, SPLASH_FADE_MS);
        }

        await watchPortChanges(iframe, info.generation);
    } catch (err) {
        console.error('[boot] dsh 启动失败', err);
        if (splash) {
            splash.style.opacity = '1';
            const tagline = splash.querySelector<HTMLElement>('.splash-tagline');
            if (tagline) {
                tagline.textContent = '加载失败，请重试';
                tagline.style.color = 'var(--splash-accent)';
            }
        }
    }
});

const watchPortChanges = async (iframe: HTMLIFrameElement, initialGeneration: number) => {
    let lastGeneration = initialGeneration;

    while (true) {
        await sleep(3000);
        try {
            const status = await invoke<PageStatus>('check_page');
            if (status.generation !== lastGeneration) {
                lastGeneration = status.generation;
                iframe.src = `http://127.0.0.1:${status.port}`;
                await waitForIframeLoad(iframe);
            }
        } catch (e) {
            console.error('[watchPortChanges] check_page 失败', e);
        }
    }
};
