import {join, resolve} from "node:path";
import {rm, mkdir, chmod, stat} from "node:fs/promises";

const REPO = "MonshinYu/dsh-bun-pkg";

const RUST_TO_ASSET = {
    "x86_64-unknown-linux-gnu": "dsh-linux-x64",
    "aarch64-unknown-linux-gnu": "dsh-linux-arm64",
    "x86_64-apple-darwin": "dsh-macos-x64",
    "aarch64-apple-darwin": "dsh-macos-arm64",
    "x86_64-pc-windows-msvc": "dsh-windows-x64.exe",
    "aarch64-pc-windows-msvc": "dsh-windows-arm64.exe",
} as const satisfies Record<string, string>;

type RustTarget = keyof typeof RUST_TO_ASSET;

const rustTarget = process.argv[2] as RustTarget | undefined;
let assetName: string | undefined = rustTarget
    ? RUST_TO_ASSET[rustTarget]
    : undefined;

if (rustTarget && !assetName) {
    console.error(`[download_runtime] 不支持的 rust target: ${rustTarget}`);
    process.exit(1);
}

if (!assetName) {
    const os = process.platform;
    const arch = process.arch;
    if (os === "darwin") {
        const bunArch = arch === "arm64" ? "arm64" : "x64";
        assetName = `dsh-macos-${bunArch}`;
    } else if (os === "linux") {
        const bunArch = arch === "arm64" ? "arm64" : "x64";
        assetName = `dsh-linux-${bunArch}`;
    } else if (os === "win32") {
        assetName = "dsh-windows-x64.exe";
    }
}

if (!assetName) {
    console.error("[download_runtime] 无法推断当前平台，请指定 -- <rust-triple>");
    process.exit(1);
}

console.log(`[download_runtime] 目标平台: ${assetName}`);

const rootPath = resolve(import.meta.dirname, "..");
const runtimePath = join(rootPath, "runtime");

await rm(runtimePath, {recursive: true, force: true});
await mkdir(runtimePath, {recursive: true});

async function spawnCurl(args: string[]): Promise<{stdout: string; stderr: string; code: number}> {
    const proc = Bun.spawn(args, {
        stdout: "pipe",
        stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    return {stdout, stderr, code: code as number};
}

const effectiveUrl = (
    await spawnCurl([
        "curl",
        "-fsSL",
        "-o",
        "/dev/null",
        "-w",
        "%{url_effective}",
        `https://github.com/${REPO}/releases/latest`,
    ])
).stdout.trim();

const tagMatch = effectiveUrl.match(/\/releases\/tag\/(.+?)\s*$/);
if (!tagMatch) {
    throw new Error(`无法解析最新版本: ${effectiveUrl}`);
}
const tag = tagMatch[1];
console.log(`[download_runtime] 最新版本: ${tag}`);

const isWindows = assetName.endsWith(".exe");
const outputName = isWindows ? "dsh.exe" : "dsh";
const outputPath = join(runtimePath, outputName);

const downloadUrl = `https://github.com/${REPO}/releases/download/${tag}/${assetName}`;

// 获取文件大小（通过 GitHub API 获取，避免 CDN 重定向丢失 content-length）
let contentLength = 0;
try {
    const apiUrl = `https://api.github.com/repos/${REPO}/releases/tags/${tag}`;
    const {stdout, code} = await spawnCurl([
        "curl",
        "-fsSL",
        "-H",
        "Accept: application/vnd.github+json",
        "-o",
        "/dev/null",
        "-w",
        "%{http_code}:%{size_download}",
        apiUrl,
    ]);
    const [statusCode, sizeStr] = stdout.trim().split(":");
    if (statusCode === "200" && sizeStr) {
        // 下载的是 JSON 元数据，大小很小，直接用它作为 total size
        // 我们需要从 release assets 中找到对应的 asset 大小
    }
} catch {
    // 忽略
}

// 使用 GitHub API 获取 assets 元数据来获取文件大小
try {
    const apiUrl = `https://api.github.com/repos/${REPO}/releases/tags/${tag}`;
    const {stdout: jsonStr, code} = await spawnCurl([
        "curl",
        "-fsSL",
        "-H",
        "Accept: application/vnd.github+json",
        apiUrl,
    ]);
    if (code === 0) {
        const release = JSON.parse(jsonStr);
        const asset = release.assets?.find((a: {name: string}) => a.name === assetName);
        if (asset?.size) {
            contentLength = asset.size;
        }
    }
} catch {
    // 忽略
}

const totalMB = contentLength > 0 ? ` / ${(contentLength / 1024 / 1024).toFixed(1)} MB` : "";
console.log(`[download_runtime] 下载中: ${downloadUrl}`);

// 带进度条的下载
function renderProgress(downloaded: number): void {
    const downloadedMB = (downloaded / 1024 / 1024).toFixed(1);
    if (contentLength > 0) {
        const barWidth = 24;
        const percent = Math.min(downloaded / contentLength, 1);
        const filled = Math.round(percent * barWidth);
        const empty = barWidth - filled;
        const bar = "█".repeat(filled) + "░".repeat(empty);
        const totalMB = (contentLength / 1024 / 1024).toFixed(1);
        process.stdout.write(`\r[download_runtime] [${bar}] ${(percent * 100).toFixed(1)}% (${downloadedMB} / ${totalMB} MB)`);
    } else {
        process.stdout.write(`\r[download_runtime] 已下载 ${downloadedMB} MB...`);
    }
}

let downloadedBytes = 0;
let lastProgressUpdate = 0;

const downloadProc = Bun.spawn(["curl", "-fL", "-o", "-", downloadUrl], {
    stdout: "pipe",
    stderr: "pipe",
});

// 实时读取下载流并写入文件
const fileHandle = await Bun.file(outputPath).writer();
const reader = (downloadProc.stdout as ReadableStream<Uint8Array>).getReader();

while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    downloadedBytes += value.length;
    await fileHandle.write(value);
    const now = Date.now();
    if (now - lastProgressUpdate > 300) {
        lastProgressUpdate = now;
        renderProgress(downloadedBytes);
    }
}

reader.releaseLock();
await fileHandle.end();

const exitCode = await downloadProc.exited;
if (exitCode !== 0) {
    const {stderr} = await spawnCurl(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", downloadUrl]);
    throw new Error(`curl 退出码 ${exitCode}\n${stderr}`);
}

renderProgress(downloadedBytes);
process.stdout.write("\n");
console.log(`[download_runtime] 已保存: ${outputPath}`);

if (process.platform !== "win32") {
    await chmod(outputPath, 0o755);
    console.log(`[download_runtime] 已设置执行权限`);
}

const {size} = await stat(outputPath);
console.log(`[download_runtime] 下载完成: ${(size / 1024 / 1024).toFixed(1)} MB`);
