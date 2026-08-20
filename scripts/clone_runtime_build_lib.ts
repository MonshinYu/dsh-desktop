import {resolve, join} from "node:path";
import {rm, mkdir, readFile, writeFile} from "node:fs/promises";

const REPO_URL = "https://github.com/MonshinYu/dsh-bun-pkg";

const rootPath = resolve(__dirname, "..");
const pluginsPath = resolve(rootPath, "plugins");
const dshBunPkgPath = join(pluginsPath, "dsh-bun-pkg");

await mkdir(pluginsPath, {recursive: true});

await rm(dshBunPkgPath, {recursive: true, force: true});

const exitCode = await Bun.spawn(["git", "clone", REPO_URL, dshBunPkgPath], {
    cwd: pluginsPath,
    stdout: "inherit",
    stderr: "inherit",
}).exited;

if (exitCode !== 0) {
    throw new Error(`git clone ${REPO_URL} failed with exit code ${exitCode}`);
}

// 上游 embed.ts 在 Windows 上会因 new URL(import.meta.url).pathname 得到 \D:\... 非法路径。
// 此处做幂等修补（上游已修复时为 no-op）。上游修复后可删除本段。
const BROKEN_LINE = 'const projectRoot = path.dirname(path.dirname(new URL(import.meta.url).pathname));';
const FIXED_LINE = 'const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));';
const IMPORT_LINE = 'import {fileURLToPath} from "node:url";';
for (const relative of ["scripts/embed.ts", "build/embed.ts"]) {
    const file = join(dshBunPkgPath, relative);
    const source = await readFile(file, "utf8");
    if (!source.includes(BROKEN_LINE)) continue; // 已修复，跳过
    const patched = source.replace(BROKEN_LINE, FIXED_LINE).replace(
        'import path from "node:path";',
        `import path from "node:path";\n${IMPORT_LINE}`,
    );
    await writeFile(file, patched);
    console.log(`[clone_runtime_build_lib] patched ${relative}: URL.pathname -> fileURLToPath (Windows 兼容)`);
}

console.log(`dsh-bun-pkg cloned to ${dshBunPkgPath}`);
