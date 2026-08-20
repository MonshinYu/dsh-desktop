/**
 * 构建 dsh runtime 可执行文件（bun --compile 产物），输出到 runtime/ 目录。
 *
 * 用法：
 *   bun run build:runtime                  # 本机架构（本地开发默认）
 *   bun run build:runtime -- <rust-triple> # 指定目标架构（CI 交叉编译用）
 *
 * 可选参数为 rust 目标三元组，例如 x86_64-apple-darwin / aarch64-pc-windows-msvc，
 * 会映射为 bun --compile 的 --target（bun-linux-x64 等）以支持交叉编译。
 * 不传参时与上游 dsh-bun-pkg 的 `bun run build` 行为完全一致（宿主架构）。
 */
import {join, resolve} from "node:path";
import {rm, rename, stat} from "node:fs/promises";
import {$} from "bun";

const RUST_TO_BUN_TARGET = {
    "x86_64-unknown-linux-gnu": "bun-linux-x64",
    "aarch64-unknown-linux-gnu": "bun-linux-arm64",
    "x86_64-apple-darwin": "bun-darwin-x64",
    "aarch64-apple-darwin": "bun-darwin-arm64",
    "x86_64-pc-windows-msvc": "bun-windows-x64",
    "aarch64-pc-windows-msvc": "bun-windows-arm64",
};

const rustTarget = process.argv[2];
const bunTarget = rustTarget ? RUST_TO_BUN_TARGET[rustTarget] : undefined;
if (rustTarget && !bunTarget) {
    console.error(`[build_runtime] 不支持的 rust target: ${rustTarget}`);
    console.error(`[build_runtime] 支持: ${Object.keys(RUST_TO_BUN_TARGET).join(" / ")}`);
    process.exit(1);
}

const rootPath = resolve(__dirname, '..');
const dshBunPkgPath = resolve(rootPath, 'plugins', 'dsh-bun-pkg');
const targetPath = join(dshBunPkgPath, 'target');
const runtimePath = join(rootPath, 'runtime');

await rm(join(dshBunPkgPath, 'node_modules'), {recursive: true, force: true});
await rm(join(dshBunPkgPath, 'bun.lock'), {force: true});
await rm(targetPath, {recursive: true, force: true});

await $`bun install`.cwd(dshBunPkgPath);
await $`bun run prepare-runtime`.cwd(dshBunPkgPath);

// 与 dsh-bun-pkg 的 build 脚本保持一致（prepare-runtime → compile → 清理中间产物），
// 仅在 CI 指定目标架构时附加 --target 做交叉编译。
const compileArgs = ["build", "main.ts", "--compile"];
if (bunTarget) {
    compileArgs.push(`--target=${bunTarget}`);
    console.log(`[build_runtime] 交叉编译目标: ${rustTarget} -> ${bunTarget}`);
}
compileArgs.push("--outfile", "target/dsh");
await $`bun ${compileArgs}`.cwd(dshBunPkgPath);
await rm(join(dshBunPkgPath, '.dsh-archive.bin'), {force: true});
await rm(join(dshBunPkgPath, 'lib', '.dsh-preload.js'), {force: true});

await rm(runtimePath, {recursive: true, force: true});
await rename(targetPath, runtimePath);

await rm(join(dshBunPkgPath, 'node_modules'), {recursive: true, force: true});
await rm(join(dshBunPkgPath, 'bun.lock'), {force: true});

// Windows 上 bun 会输出 dsh.exe，兼容两种文件名
let binPath = join(runtimePath, 'dsh');
try {
    await stat(binPath);
} catch {
    binPath = join(runtimePath, 'dsh.exe');
}
const {size} = await stat(binPath);
console.log(`built runtime: ${(size / 1024 / 1024).toFixed(1)} MB (${binPath})`);
