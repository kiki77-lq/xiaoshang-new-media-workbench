import { execFileSync } from "node:child_process";

const PROTECTED_PATHS = [
  "data/workbench.sqlite",
  "data/workbench.sqlite-wal",
  "data/workbench.sqlite-shm",
  "data/secrets.json",
  "data/backups/example.sqlite",
  "data/imports/example.csv",
  "data/logs/server.log",
  "app/data/workbench.sqlite"
];

function git(projectRoot, args) {
  return execFileSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

export function assertDataIsolation({ projectRoot }) {
  const ignored = [];
  for (const protectedPath of PROTECTED_PATHS) {
    try {
      git(projectRoot, ["check-ignore", "--no-index", "--", protectedPath]);
      ignored.push(protectedPath);
    } catch {
      throw new Error(`DATA_PATH_NOT_IGNORED: ${protectedPath}`);
    }
  }

  const trackedOutput = git(projectRoot, ["ls-files", "--", "data", "app/data"]);
  const tracked = trackedOutput ? trackedOutput.split("\n") : [];
  if (tracked.length > 0) {
    throw new Error(`DATA_PATH_TRACKED: ${tracked.join(", ")}`);
  }
  return { ignored, tracked };
}
