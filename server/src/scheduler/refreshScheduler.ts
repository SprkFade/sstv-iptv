import cron from "node-cron";
import { isSetupComplete, setting, setSetting } from "../db/database.js";
import { isRefreshRunning, startRefreshGuide } from "../ingest/refresh.js";

let running = false;

function parseScheduleTimes(value: string) {
  return Array.from(new Set(
    value
      .split(",")
      .map((time) => time.trim())
      .filter((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time))
  )).sort();
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localTimeKey(date: Date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function startRefreshScheduler() {
  cron.schedule("* * * * *", async () => {
    if (!isSetupComplete()) return;
    if (running || isRefreshRunning()) return;

    const scheduledTimes = parseScheduleTimes(setting("refresh_schedule_times", ""));
    const now = new Date();
    let due = false;
    let scheduleKey = "";

    if (scheduledTimes.length) {
      const timeKey = localTimeKey(now);
      scheduleKey = `${localDateKey(now)} ${timeKey}`;
      due = scheduledTimes.includes(timeKey) && setting("last_scheduled_refresh_key", "") !== scheduleKey;
    } else {
      const interval = Math.max(1, Number(setting("refresh_interval_hours", "12")));
      const last = setting("last_scheduled_refresh_at", "");
      const lastTime = last ? new Date(last).getTime() : 0;
      due = !last || Date.now() - lastTime >= interval * 60 * 60 * 1000;
    }

    if (!due) return;

    running = true;
    try {
      const result = startRefreshGuide();
      if (result.started) {
        setSetting("last_scheduled_refresh_at", now.toISOString());
        if (scheduleKey) setSetting("last_scheduled_refresh_key", scheduleKey);
      }
    } catch (error) {
      console.error("Scheduled refresh failed:", error);
    } finally {
      running = false;
    }
  });
}
