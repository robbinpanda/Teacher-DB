import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

async function run(command, args, root) {
  const child = spawn(command, args, { cwd: root, stdio: "inherit", windowsHide: true });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`Python 环境准备失败（${code}），请检查 Python 3.11+ 和网络`);
}
export async function preparePython(root) {
  const directory = path.join(root, ".runtime", "python");
  const executable = process.env.JIANTI_PYTHON_EXECUTABLE ?? path.join(directory, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  if (!existsSync(executable)) await run(process.env.JIANTI_PYTHON_BOOTSTRAP ?? (process.platform === "win32" ? "python" : "python3"), ["-m", "venv", directory], root);
  const requirements = await readFile(path.join(root, "processor", "requirements.txt"));
  const fingerprint = createHash("sha256").update(requirements).digest("hex");
  const stamp = path.join(directory, "requirements.sha256");
  if (await readFile(stamp, "utf8").catch(() => "") !== fingerprint) {
    await run(executable, ["-m", "pip", "install", "-r", "processor/requirements.txt"], root);
    await writeFile(stamp, fingerprint);
  }
  return executable;
}
