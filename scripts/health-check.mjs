import path from "node:path";
import { pathToFileURL } from "node:url";

export async function checkHealth({
  baseUrl = process.env.WORKBENCH_URL || "http://127.0.0.1:5173"
} = {}) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/health`);
  const body = await response.json();
  if (!response.ok || body?.data?.status !== "ok" || body?.data?.database !== "ok") {
    throw new Error(`HEALTH_CHECK_FAILED: HTTP ${response.status}`);
  }
  return body.data;
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  checkHealth()
    .then((data) => console.log(JSON.stringify(data)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
