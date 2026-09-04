import { once } from "node:events";

import { loadConfig } from "../../server/config.js";
import { openDatabase } from "../../server/db/connection.js";
import { runMigrations } from "../../server/db/migrate.js";
import { loadOrCreateSecrets } from "../../server/security/secrets.js";
import { createWorkbenchServer } from "../../server/index.js";
import { createTempWorkbench } from "./temp-workbench.js";

export async function startTestServer(t, overrides = {}) {
  const paths = createTempWorkbench(t, "xiaoshang-http-test-");
  const config = {
    ...loadConfig({
      projectRoot: paths.projectRoot,
      env: {},
      nodeVersion: "24.13.0"
    }),
    gitSha: "a".repeat(40),
    port: 0,
    ...overrides
  };
  const secrets = loadOrCreateSecrets({ dataDir: config.dataDir });
  config.authToken = secrets.token;
  const db = openDatabase({ dbPath: config.dbPath });
  runMigrations(db);
  const server = createWorkbenchServer({ config, db });
  server.listen(0, config.host);
  await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://${config.host}:${address.port}`;
  config.allowedOrigins = new Set([baseUrl]);

  t.after(() => {
    server.close();
    db.close();
  });

  return { baseUrl, config, db, paths, server, token: secrets.token };
}
