import path from "node:path";
import { verifyBackup } from "./backup-utils.mjs";

const backupRoot = process.argv[2];
if (!backupRoot) throw new Error("用法: npm run backup:verify -- <备份目录>");
const manifest = await verifyBackup(path.resolve(backupRoot));
console.log(`backup verified: ${manifest.files.length} files, created ${manifest.createdAt}`);
