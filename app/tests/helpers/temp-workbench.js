import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function createTempWorkbench(t, prefix = "xiaoshang-workbench-test-") {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(projectRoot, "app"), { recursive: true });
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  return {
    projectRoot,
    dataDir: path.join(projectRoot, "data"),
    dbPath: path.join(projectRoot, "data", "workbench.sqlite")
  };
}
