import cron from "node-cron";
import { isSetupComplete, setting, setSetting } from "../db/database.js";
import { isRefreshRunning, startRefreshGuide } from "../ingest/refresh.js";

let running = false;

export function startRefreshScheduler() {
  cron.schedule("0 * * * *", async () => {
    if (!isSetupComplete()) return;
    if (running || isRefreshRunning()) return;
    const interval = Math.max(1, Number(setting("refresh_interval_hours", "12")));
    const last = setting("last_scheduled_refresh_at", "");
    const lastTime = last ? new Date(last).getTime() : 0;
    const due = !last || Date.now() - lastTime >= interval * 60 * 60 * 1000;
    if (!due) return;

    running = true;
    try {
      const result = startRefreshGuide();
      if (result.started) setSetting("last_scheduled_refresh_at", new Date().toISOString());
    } catch (error) {
      console.error("Scheduled refresh failed:", error);
    } finally {
      running = false;
    }
  });
}
