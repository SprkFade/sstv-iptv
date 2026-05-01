import cron from "node-cron";
import { setting } from "../db/database.js";
import { refreshGuide } from "../ingest/refresh.js";

let running = false;

export function startRefreshScheduler() {
  cron.schedule("0 * * * *", async () => {
    if (running) return;
    const interval = Math.max(1, Number(setting("refresh_interval_hours", "12")));
    const last = setting("last_scheduled_refresh_at", "");
    const lastTime = last ? new Date(last).getTime() : 0;
    const due = !last || Date.now() - lastTime >= interval * 60 * 60 * 1000;
    if (!due) return;

    running = true;
    try {
      await refreshGuide();
    } catch (error) {
      console.error("Scheduled refresh failed:", error);
    } finally {
      const { setSetting } = await import("../db/database.js");
      setSetting("last_scheduled_refresh_at", new Date().toISOString());
      running = false;
    }
  });
}
