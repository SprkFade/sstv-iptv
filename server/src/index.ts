import { config, ensureRuntimeDirs } from "./config.js";
import { migrate } from "./db/database.js";
import { createApp } from "./app.js";
import { startRefreshScheduler } from "./scheduler/refreshScheduler.js";
import { stopAllHlsSessions } from "./routes/stream.js";

ensureRuntimeDirs();
migrate();
startRefreshScheduler();

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`SSTV IPTV listening on http://0.0.0.0:${config.port}`);
});

let shuttingDown = false;

function shutdown(reason: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`SSTV IPTV shutting down: ${reason}`);
  const stoppedStreams = stopAllHlsSessions(reason);
  if (stoppedStreams > 0) {
    console.log(`Stopped ${stoppedStreams} active FFmpeg HLS session${stoppedStreams === 1 ? "" : "s"}.`);
  }

  const forceExit = setTimeout(() => {
    console.error(`Forced shutdown after timeout: ${reason}`);
    process.exit(exitCode);
  }, 10_000);
  forceExit.unref();

  server.close((error) => {
    if (error) {
      if ((error as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING") {
        process.exit(exitCode);
      }
      console.error("HTTP server close failed during shutdown", error);
      process.exit(1);
    }
    process.exit(exitCode);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception", error);
  shutdown("uncaughtException", 1);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection", reason);
});
process.on("exit", (code) => {
  console.log(`SSTV IPTV process exiting with code ${code}`);
});
