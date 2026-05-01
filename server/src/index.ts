import { config, ensureRuntimeDirs } from "./config.js";
import { migrate } from "./db/database.js";
import { createApp } from "./app.js";
import { startRefreshScheduler } from "./scheduler/refreshScheduler.js";

ensureRuntimeDirs();
migrate();
startRefreshScheduler();

const app = createApp();
app.listen(config.port, () => {
  console.log(`TV Guide PWA listening on http://0.0.0.0:${config.port}`);
});
