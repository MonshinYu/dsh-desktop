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

async function curl(args: string[], inheritStdout = false): Promise<string> {
    const proc = Bun.spawn(args, {
        stdout: inheritStdout ? "inherit" : "pipe",
        stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
        inheritStdout ? Promise.resolve("") : new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    if (code !== 0) {
        throw new Error(`curl 退出码 ${code}\n${stderr.trim()}`);
    }
    return stdout;
}

const effectiveUrl = (
    await curl([
        "curl",
        "-fsSL",
        "-o",
        "/dev/null",
        "-w",
        "%{url_effective}",
        `https://github.com/${REPO}/releases/latest`,
    ])
).trim();

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

const headOutput = await curl([
    "curl",
    "-fsSL",
    "-I",
    "-X",
    "HEAD",
    downloadUrl,
]);

let contentLength = 0;
for (const line of headOutput.split("\n")) {
    const m = line.match(/^content-length:\s*(\d+)/i);
    if (m) contentLength = Number(m[1]);
}

if (contentLength > 0) {
    console.log(`[download_runtime] 文件大小: ${(contentLength / 1024 / 1024).toFixed(1)} MB`);
}
console.log(`[download_runtime] 下载中: ${downloadUrl}`);

await curl(
    [
        "curl",
        "-fL",
        "--progress-bar",
        "-o",
        outputPath,
        downloadUrl,
    ],
    true,
);

console.log(`[download_runtime] 已保存: ${outputPath}`);

if (process.platform !== "win32") {
    await chmod(outputPath, 0o755);
    console.log(`[download_runtime] 已设置执行权限`);
}

const {size} = await stat(outputPath);

if (contentLength > 0 && size !== contentLength) {
    throw new Error(
        `下载不完整: 期望 ${contentLength} bytes, 实际 ${size} bytes`,
    );
}
console.log(`[download_runtime] 下载完成: ${(size / 1024 / 1024).toFixed(1)} MB`);
