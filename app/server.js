import { startWorkbench } from "./server/index.js";

startWorkbench().catch((error) => {
  console.error(`Startup failed: ${error.message}`);
  process.exitCode = 1;
});
