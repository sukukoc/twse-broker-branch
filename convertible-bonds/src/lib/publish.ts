import fs from "node:fs";
import path from "node:path";

export function atomicWrite(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

export function backupFile(file: string, backupDir: string, keep = 14): void {
  if (!fs.existsSync(file)) return;
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(backupDir, `${path.basename(file)}.${stamp}`);
  fs.copyFileSync(file, target);
  const old = fs
    .readdirSync(backupDir)
    .filter((name) => name.startsWith(path.basename(file)))
    .sort();
  for (const name of old.slice(0, Math.max(0, old.length - keep))) {
    fs.rmSync(path.join(backupDir, name), { force: true });
  }
}

export function copyFiles(fromDir: string, toDir: string, names: string[]): void {
  fs.mkdirSync(toDir, { recursive: true });
  for (const name of names) {
    fs.copyFileSync(path.join(fromDir, name), path.join(toDir, name));
  }
}
