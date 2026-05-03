import { parentPort } from "node:worker_threads";
import { refreshGuide, setRefreshProgressReporter } from "./refresh.js";

if (!parentPort) {
  throw new Error("Refresh worker must run inside a worker thread.");
}

setRefreshProgressReporter((progress) => {
  parentPort?.postMessage({ type: "progress", progress });
});

try {
  const result = await refreshGuide();
  parentPort.postMessage({ type: "done", result });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  parentPort.postMessage({ type: "error", error: message });
}
