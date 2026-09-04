import path from "node:path";

const SUPPORTED_NODE_MAJOR = 24;
const DEFAULT_BODY_LIMIT_BYTES = 2 * 1024 * 1024;
const UPSTREAM_SHA = "d8f8e5b2d10c193d0ea0bf3581e41cc34490e55b";

function parsePositiveInteger(value, fallback, code) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(code);
  return parsed;
}

export function loadConfig({
  projectRoot,
  env = process.env,
  nodeVersion = process.versions.node
}) {
  const nodeMajor = Number.parseInt(nodeVersion.split(".")[0], 10);
  if (nodeMajor !== SUPPORTED_NODE_MAJOR) {
    throw new Error(`UNSUPPORTED_NODE_VERSION: expected 24.x, received ${nodeVersion}`);
  }

  const normalizedProjectRoot = path.resolve(projectRoot);
  const appDir = path.join(normalizedProjectRoot, "app");
  const dataDir = path.resolve(
    env.WORKBENCH_DATA_DIR || path.join(normalizedProjectRoot, "data")
  );

  if (dataDir === appDir || dataDir.startsWith(`${appDir}${path.sep}`)) {
    throw new Error("DATA_DIR_INSIDE_APP");
  }

  const host = env.WORKBENCH_HOST || "127.0.0.1";
  const port = parsePositiveInteger(env.WORKBENCH_PORT, 5173, "INVALID_PORT");
  const bodyLimitBytes = parsePositiveInteger(
    env.WORKBENCH_BODY_LIMIT_BYTES,
    DEFAULT_BODY_LIMIT_BYTES,
    "INVALID_BODY_LIMIT"
  );

  return {
    projectRoot: normalizedProjectRoot,
    appDir,
    dataDir,
    dbPath: path.join(dataDir, "workbench.sqlite"),
    secretsPath: path.join(dataDir, "secrets.json"),
    backupsDir: path.join(dataDir, "backups"),
    importsDir: path.join(dataDir, "imports"),
    logsDir: path.join(dataDir, "logs"),
    host,
    port,
    bodyLimitBytes,
    allowedOrigins: new Set([
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`
    ]),
    appVersion: "0.1.0",
    upstreamSha: UPSTREAM_SHA,
    gitSha: env.WORKBENCH_GIT_SHA || null
  };
}
