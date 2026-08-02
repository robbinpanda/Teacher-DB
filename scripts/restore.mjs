import { cp, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { appDataDirectory, verifyBackup } from "./backup-utils.mjs";

const backupArgument = process.argv[2];
if (!backupArgument || !process.argv.includes("--confirm")) {
  throw new Error("恢复会替换当前数据。用法: npm run restore -- <备份目录> --confirm（执行前先停止应用）");
}
const backupRoot = path.resolve(backupArgument);
await verifyBackup(backupRoot);
const source = path.join(backupRoot, "data");
const target = appDataDirectory();
if (source === target || source.startsWith(target + path.sep)) throw new Error("不能从当前数据目录内部恢复");
const safetyCopy = `${target}.pre-restore-${new Date().toISOString().replace(/[:.]/g, "-")}`;
let hadTarget = false;
try {
  await stat(target);
  hadTarget = true;
  await rename(target, safetyCopy);
} catch (error) {
  if (error.code !== "ENOENT") throw new Error(`无法移动当前数据目录；请确认应用已停止。${error.message}`);
}
try {
  await cp(source, target, { recursive: true, errorOnExist: true });
  console.log(`restore complete: ${target}`);
  console.log(`previous data retained at: ${safetyCopy}`);
} catch (error) {
  await rm(target, { recursive: true, force: true });
  if (hadTarget) {
    try { await rename(safetyCopy, target); } catch {}
  }
  throw error;
}
