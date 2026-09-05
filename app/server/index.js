import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadConfig } from "./config.js";
import { openDatabase } from "./db/connection.js";
import { getSchemaVersion, inspectMigrations, runMigrations } from "./db/migrate.js";
import { createBackup, verifyBackup } from './services/backup-service.js';
import { registerCalendarRoutes } from './routes/calendar-events.js';
import { appendAuditLog } from "./repositories/audit-repository.js";
import { loadOrCreateSecrets, rotateToken } from "./security/secrets.js";
import { authenticateRequest } from "./http/auth.js";
import { readJson } from "./http/body.js";
import { HttpError } from "./http/errors.js";
import { sendData, sendError } from "./http/response.js";
import { createRouter } from "./http/router.js";
import { registerContentRoutes } from "./routes/contents.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerInspirationRoutes } from "./routes/inspirations.js";
import { registerAnalyticsRoutes } from "./routes/analytics.js";
import { registerPhase6Routes } from './routes/phase6.js';
import { recordWorkbuddyRequest } from './services/settings-service.js';
import { registerBackupRoutes } from './routes/backups.js';
import { createOperationJournal } from './services/operation-journal.js';

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

function resolveGitSha(projectRoot) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    throw new Error("GIT_SHA_UNAVAILABLE");
  }
}

function checkDatabase(db) {
  return db.prepare("PRAGMA quick_check").get().quick_check === "ok" ? "ok" : "error";
}

function decodeRequestPath(req) {
  const rawPath = (req.url || "/").split("?")[0];
  try {
    return decodeURIComponent(rawPath);
  } catch {
    throw new HttpError(400, "INVALID_PATH", "Request path is not valid URL encoding.");
  }
}

function assertAllowedHost(req, config) {
  const host = String(req.headers.host || "").toLowerCase();
  const allowedHosts = new Set([...config.allowedOrigins].map((origin) => new URL(origin).host.toLowerCase()));
  if (!host || !allowedHosts.has(host)) {
    throw new HttpError(403, "HOST_FORBIDDEN", "Request Host is not allowed by the local service.");
  }
}

function serveStatic(req, res, config, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    throw new HttpError(405, "METHOD_NOT_ALLOWED", "Only GET and HEAD are allowed for static files.");
  }
  if (pathname.includes("\0")) {
    throw new HttpError(400, "INVALID_PATH", "Request path contains an invalid character.");
  }

  const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const requestedTarget = path.resolve(config.appDir, requestedPath);
  const appPrefix = `${path.resolve(config.appDir)}${path.sep}`;
  if (requestedTarget !== path.resolve(config.appDir) && !requestedTarget.startsWith(appPrefix)) {
    throw new HttpError(403, "PATH_FORBIDDEN", "Requested path is outside the application directory.");
  }
  const isNavigationRoute = !path.extname(requestedPath);
  const target = !fs.existsSync(requestedTarget) && isNavigationRoute
    ? path.resolve(config.appDir, "index.html")
    : requestedTarget;
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new HttpError(404, "NOT_FOUND", "File not found.");
  }

  const content = fs.readFileSync(target);
  res.writeHead(200, {
    "content-type": MIME_TYPES[path.extname(target)] || "application/octet-stream",
    "content-length": content.length
  });
  if (req.method === "HEAD") return res.end();
  res.end(content);
}

function buildRouter(config, db, lifecycle) {
  const router = createRouter();

  registerInspirationRoutes(router, { config, db });
  registerContentRoutes(router, { config, db });
  registerDashboardRoutes(router, { config, db });
  registerCalendarRoutes(router, { config, db });
  registerAnalyticsRoutes(router, { config, db });
  registerPhase6Routes(router, { config, db });
  registerBackupRoutes(router, { config, lifecycle });

  router.add("GET", "/api/v1/health", async (_req, res, context) => {
    sendData(res, 200, {
      status: "ok",
      database: checkDatabase(db),
      schemaVersion: getSchemaVersion(db),
      gitSha: config.gitSha
    }, { requestId: context.requestId });
  });

  router.add("GET", "/api/v1/meta", async (_req, res, context) => {
    sendData(res, 200, {
      appVersion: config.appVersion,
      schemaVersion: getSchemaVersion(db),
      gitSha: config.gitSha,
      upstreamSha: config.upstreamSha
    }, { requestId: context.requestId });
  });

  router.add("POST", "/api/v1/workbuddy/token/rotate", async (req, res, context) => {
    const principal = authenticateRequest(req, config);
    await readJson(req, config.bodyLimitBytes);
    const rotated = rotateToken({ dataDir: config.dataDir });
    config.authToken = rotated.token;
    db.exec("BEGIN IMMEDIATE");
    try {
      appendAuditLog({
        db,
        actor: principal.actor,
        action: "workbuddy.token.rotate",
        entityType: "system",
        entityId: null,
        requestId: context.requestId,
        after: { rotatedAt: rotated.rotatedAt }
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    sendData(res, 200, {
      rotated: true,
      rotatedAt: rotated.rotatedAt
    }, { requestId: context.requestId });
  });

  return router;
}

export function createWorkbenchServer({ config, db }) {
  let currentDb = db, router, maintaining = false, unavailable = false, drained;
  const active = new Set();
  const lifecycle = {
    get db() { return currentDb; },
    tickets: new Map(),
    operation: createOperationJournal(config.dataDir),
    releaseRequest(id) { active.delete(id); drained?.(); },
    failClosed() { unavailable=true; },
    rebind(next) { const nextRouter = buildRouter(config,next,lifecycle); currentDb=next; router=nextRouter; },
    async maintenance(requestId,execute) {
      if(maintaining||unavailable)throw new HttpError(503,'MAINTENANCE','数据库正在恢复或等待修复，请稍后重试。');
      maintaining=true;
      try {
        if([...active].some(id=>id!==requestId)) await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>{drained=null;reject(new HttpError(503,'REQUEST_DRAIN_TIMEOUT','在途请求尚未结束，恢复已取消，请重试。'));},30000);
          drained=()=>{if([...active].every(id=>id===requestId)){clearTimeout(timer);drained=null;resolve();}};
          drained();
        });
        return await execute();
      } finally { maintaining=false; }
    }
  };
  lifecycle.rebind(db);
  const server = http.createServer(async (req, res) => {
    const requestId = randomUUID();
    try {
      assertAllowedHost(req, config);
      const pathname = decodeRequestPath(req);
      if (pathname.startsWith("/api/v1")) {
        if(maintaining||unavailable)throw new HttpError(503,'MAINTENANCE','数据库正在恢复或等待修复，请稍后重试。');
        active.add(requestId);
        if (req.headers.authorization) {
          authenticateRequest({headers:{authorization:req.headers.authorization}},config);
          recordWorkbuddyRequest(currentDb);
        }
        const handled = await router.dispatch(req, res, { pathname, requestId });
        if (!handled) throw new HttpError(404, "NOT_FOUND", "API route not found.");
        return;
      }
      serveStatic(req, res, config, pathname);
    } catch (error) {
      if (!res.headersSent) sendError(res, error, requestId);
      else res.end();
    } finally {
      active.delete(requestId);
      drained?.();
    }
  });
  Object.defineProperty(server,'database',{get:()=>currentDb});
  server.on('close',()=>{if(currentDb.isOpen)currentDb.close();});
  return server;
}

export async function prepareWorkbench({
  projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  env = process.env,
  migrationDir
} = {}) {
  const config = loadConfig({ projectRoot, env });
  for (const directory of [config.dataDir, config.backupsDir, config.importsDir, config.logsDir]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  const secrets = loadOrCreateSecrets({ dataDir: config.dataDir });
  config.authToken = secrets.token;
  config.gitSha ||= resolveGitSha(config.projectRoot);
  const db = openDatabase({ dbPath: config.dbPath });
  try {
    const options = migrationDir ? { migrationDir } : undefined;
    if (inspectMigrations(db, options).pending.length) {
      const manifest = await createBackup({ db, dataDir: config.dataDir, reason: 'pre-migration', appVersion: config.appVersion });
      if (!(await verifyBackup(manifest)).ok) throw new Error('PRE_MIGRATION_BACKUP_VERIFICATION_FAILED');
    }
    runMigrations(db, options);
  } catch (error) {
    db.close();
    throw error;
  }
  return { config, db };
}

export async function startWorkbench(options = {}) {
  const { config, db } = await prepareWorkbench(options);
  const server = createWorkbenchServer({ config, db });
  server.listen(config.port, config.host, () => {
    console.log(`Xiaoshang workbench listening on http://${config.host}:${config.port}`);
    console.log(`Database: ${config.dbPath}`);
  });
  return { config, get db() { return server.database; }, server };
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  startWorkbench().catch((error) => {
    console.error(`Startup failed: ${error.message}`);
    process.exitCode = 1;
  });
}
