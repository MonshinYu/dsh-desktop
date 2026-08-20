/**
 * 同步更新各处的版本号（供 CI 发布流程使用）。
 *
 * 用法：
 *   bun scripts/bump_version.mjs <新版本号>   # 指定版本，如 0.1.5
 *   bun scripts/bump_version.mjs patch        # 或递增类型 patch / minor / major
 *
 * 会更新：package.json / src-tauri/tauri.conf.json / src-tauri/Cargo.toml / src-tauri/Cargo.lock
 * 最后一行输出新版本号（CI 用 stdout 捕获）。
 */
import {readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";

const rootPath = resolve(import.meta.dirname, "..");

const arg = process.argv[2];
let newVersion;
if (/^\d+\.\d+\.\d+$/.test(arg)) {
    newVersion = arg;
} else if (["patch", "minor", "major"].includes(arg)) {
    const current = JSON.parse(readFileSync(resolve(rootPath, "package.json"), "utf8")).version;
    const [a, b, c] = current.split(".").map(Number);
    newVersion =
        arg === "patch" ? `${a}.${b}.${c + 1}` :
        arg === "minor" ? `${a}.${b + 1}.0` :
        `${a + 1}.0.0`;
} else {
    console.error(`[bump_version] 非法参数: ${arg}`);
    console.error(`[bump_version] 用法: bump_version.mjs <版本号> | patch | minor | major`);
    process.exit(1);
}

const files = [];

// package.json
const pkgPath = resolve(rootPath, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
files.push(pkgPath);

// src-tauri/tauri.conf.json
const confPath = resolve(rootPath, "src-tauri", "tauri.conf.json");
const conf = JSON.parse(readFileSync(confPath, "utf8"));
conf.version = newVersion;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");
files.push(confPath);

// src-tauri/Cargo.toml（仅 [package] 段的 version）
const cargoPath = resolve(rootPath, "src-tauri", "Cargo.toml");
const cargo = readFileSync(cargoPath, "utf8").replace(/^version = "[\d.]+"$/m, `version = "${newVersion}"`);
writeFileSync(cargoPath, cargo);
files.push(cargoPath);

// src-tauri/Cargo.lock（dsh-desktop 条目）
const lockPath = resolve(rootPath, "src-tauri", "Cargo.lock");
const lock = readFileSync(lockPath, "utf8").replace(
    /^(name = "dsh-desktop"\nversion = ")[\d.]+(")$/m,
    `$1${newVersion}$2`,
);
if (!lock.includes(`name = "dsh-desktop"\nversion = "${newVersion}"`)) {
    console.error("[bump_version] Cargo.lock 中未找到 dsh-desktop 条目，请检查");
    process.exit(1);
}
writeFileSync(lockPath, lock);
files.push(lockPath);

console.log(`[bump_version] 版本号已更新为 ${newVersion}:`);
for (const f of files) console.log(`  - ${f}`);
console.log(newVersion);
