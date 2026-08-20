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
    process.exit(1);
}

const files = [];

const pkgPath = resolve(rootPath, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
files.push(pkgPath);

const confPath = resolve(rootPath, "src-tauri", "tauri.conf.json");
const conf = JSON.parse(readFileSync(confPath, "utf8"));
conf.version = newVersion;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");
files.push(confPath);

const cargoPath = resolve(rootPath, "src-tauri", "Cargo.toml");
const cargo = readFileSync(cargoPath, "utf8").replace(/^version = "[\d.]+"$/m, `version = "${newVersion}"`);
writeFileSync(cargoPath, cargo);
files.push(cargoPath);

const lockPath = resolve(rootPath, "src-tauri", "Cargo.lock");
const lock = readFileSync(lockPath, "utf8").replace(
    /^(name = "dsh-desktop"\nversion = ")[\d.]+(")$/m,
    `$1${newVersion}$2`,
);
if (!lock.includes(`name = "dsh-desktop"\nversion = "${newVersion}"`)) {
    console.error("[bump_version] Cargo.lock 中未找到 dsh-desktop 条目");
    process.exit(1);
}
writeFileSync(lockPath, lock);
files.push(lockPath);

console.log(`[bump_version] 版本号已更新为 ${newVersion}:`);
for (const f of files) console.log(`  - ${f}`);
console.log(newVersion);
