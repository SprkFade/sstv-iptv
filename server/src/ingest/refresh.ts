import Database from "better-sqlite3";
import { config, ensureRuntimeDirs } from "../config.js";
import { getDb, setting, setSetting } from "../db/database.js";
import { parseXmltv } from "./xmltv.js";
import { matchChannels } from "./match.js";
import { fetchXcChannels, xcXmltvUrl, type XcCredentials } from "./xc.js";

export interface RefreshProgress {
  active: boolean;
  runId: number | null;
  stage: string;
  detail: string;
  channelCount: number;
  programCount: number;
  totalProgramCount: number;
  savedChannelCount: number;
  savedProgramCount: number;
  matchedCount: number;
  startedAt: string | null;
  updatedAt: string | null;
  error: string;
}

let progress: RefreshProgress = {
  active: false,
  runId: null,
  stage: "Idle",
  detail: "",
  channelCount: 0,
  programCount: 0,
  totalProgramCount: 0,
  savedChannelCount: 0,
  savedProgramCount: 0,
  matchedCount: 0,
  startedAt: null,
  updatedAt: null,
  error: ""
};
let refreshInFlight: Promise<Awaited<ReturnType<typeof refreshGuide>>> | null = null;

function setProgress(update: Partial<RefreshProgress>) {
  progress = {
    ...progress,
    ...update,
    updatedAt: new Date().toISOString()
  };
}

export function getRefreshProgress() {
  return progress;
}

export function isRefreshRunning() {
  return Boolean(refreshInFlight);
}

export function startRefreshGuide() {
  if (refreshInFlight) return { started: false, progress };
  refreshInFlight = refreshGuide().finally(() => {
    refreshInFlight = null;
  });
  refreshInFlight.catch(() => undefined);
  return { started: true, progress };
}

async function fetchText(url: string, label: string) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "SSTV IPTV/1.0"
    }
  });
  if (!response.ok) {
    throw new Error(`Fetch failed for ${label}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function yieldToEventLoop() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function openIngestDb() {
  ensureRuntimeDirs();
  const ingestDb = new Database(config.databasePath);
  ingestDb.pragma("journal_mode = WAL");
  ingestDb.pragma("foreign_keys = ON");
  return ingestDb;
}

function currentXcCredentials(overrides?: Partial<XcCredentials>) {
  return {
    baseUrl: overrides?.baseUrl ?? setting("xc_base_url"),
    username: overrides?.username ?? setting("xc_username"),
    password: overrides?.password ?? setting("xc_password")
  };
}

export async function refreshGuide(overrides?: Partial<XcCredentials> & { xmltvUrl?: string }) {
  const db = getDb();
  const run = db
    .prepare("INSERT INTO refresh_runs (status) VALUES ('running')")
    .run();
  const runId = Number(run.lastInsertRowid);
  setProgress({
    active: true,
    runId,
    stage: "Preparing refresh",
    detail: "Checking source configuration.",
    channelCount: 0,
    programCount: 0,
    totalProgramCount: 0,
    savedChannelCount: 0,
    savedProgramCount: 0,
    matchedCount: 0,
    startedAt: new Date().toISOString(),
    error: ""
  });

  try {
    const xcCredentials = currentXcCredentials(overrides);
    if (!xcCredentials.baseUrl || !xcCredentials.username || !xcCredentials.password) {
      throw new Error("XtremeCodes server URL, username, and password must be configured before refreshing.");
    }
    const configuredXmltvUrl = overrides?.xmltvUrl ?? setting("xmltv_url");
    const xmltvUrl = configuredXmltvUrl || xcXmltvUrl(xcCredentials);

    if (overrides?.baseUrl) setSetting("xc_base_url", overrides.baseUrl);
    if (overrides?.username) setSetting("xc_username", overrides.username);
    if (overrides?.password) setSetting("xc_password", overrides.password);
    if (overrides?.xmltvUrl) setSetting("xmltv_url", overrides.xmltvUrl);

    setProgress({
      stage: "Loading guide sources",
      detail: "Fetching XtremeCodes live channels and XMLTV guide data."
    });
    const [sourceChannels, xmltvText] = await Promise.all([
      fetchXcChannels(xcCredentials),
      fetchText(xmltvUrl, "XMLTV guide")
    ]);
    setProgress({
      stage: "Parsing XMLTV guide",
      detail: "Reading channel and program listings.",
      channelCount: sourceChannels.length
    });
    const xmltv = await parseXmltv(xmltvText, (parseProgress) => {
      setProgress({
        stage: "Parsing XMLTV guide",
        detail: `Parsed ${parseProgress.channels} XMLTV channels and ${parseProgress.programs} programs.`,
        channelCount: sourceChannels.length,
        totalProgramCount: parseProgress.programs,
        programCount: parseProgress.programs
      });
    });
    setProgress({
      stage: "Matching channels",
      detail: `Matching ${sourceChannels.length} channels with ${xmltv.channels.length} XMLTV entries.`,
      channelCount: sourceChannels.length,
      totalProgramCount: xmltv.programs.length,
      programCount: xmltv.programs.length
    });
    const { matches, matchedCount } = matchChannels(sourceChannels, xmltv.channels);
    setProgress({
      stage: "Saving guide data",
      detail: `Saving channels and ${xmltv.programs.length} program entries.`,
      channelCount: sourceChannels.length,
      totalProgramCount: xmltv.programs.length,
      programCount: xmltv.programs.length,
      matchedCount
    });

    const applyRefresh = async () => {
      let savedChannelCount = 0;
      let savedProgramCount = 0;
      const ingestDb = openIngestDb();
      ingestDb.prepare("BEGIN IMMEDIATE").run();
      try {
        ingestDb.prepare("UPDATE channels SET enabled = 0, updated_at = CURRENT_TIMESTAMP").run();
        ingestDb.prepare("DELETE FROM programs").run();

        const findChannel = ingestDb.prepare(
          `SELECT id FROM channels
         WHERE (tvg_id IS NOT NULL AND tvg_id != '' AND tvg_id = ?)
            OR stream_url = ?
         ORDER BY CASE WHEN tvg_id = ? THEN 0 ELSE 1 END
         LIMIT 1`
        );
      const insertChannel = ingestDb.prepare(
        `INSERT INTO channels
         (tvg_id, tvg_name, display_name, logo_url, group_title, stream_url, xmltv_channel_id, channel_number, sort_order, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
      );
      const updateChannel = ingestDb.prepare(
        `UPDATE channels
         SET tvg_id = ?, tvg_name = ?, display_name = ?, logo_url = ?, group_title = ?,
             stream_url = ?, xmltv_channel_id = ?, channel_number = ?, sort_order = ?,
             enabled = 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      );
        const insertProgram = ingestDb.prepare(
          `INSERT INTO programs
         (channel_id, title, subtitle, description, category, start_time, end_time)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
        );

        const xmltvToChannelId = new Map<string, number>();
        for (let index = 0; index < sourceChannels.length; index += 1) {
          const channel = sourceChannels[index];
          const xmltvMatch = matches.get(index);
          const existing = findChannel.get(channel.tvgId, channel.streamUrl, channel.tvgId) as
            | { id: number }
            | undefined;

          const values = [
            channel.tvgId,
            channel.tvgName,
            channel.displayName,
            channel.logoUrl || xmltvMatch?.icon || "",
            channel.groupTitle,
            channel.streamUrl,
            xmltvMatch?.id ?? "",
            channel.channelNumber,
            channel.sortOrder
          ] as const;

          const channelId = existing
            ? (updateChannel.run(...values, existing.id), existing.id)
            : Number(insertChannel.run(...values).lastInsertRowid);

          if (xmltvMatch?.id) xmltvToChannelId.set(xmltvMatch.id, channelId);
          savedChannelCount += 1;
          if (savedChannelCount % 250 === 0 || savedChannelCount === sourceChannels.length) {
            setProgress({
              detail: `Saving channels ${savedChannelCount}/${sourceChannels.length}.`,
              savedChannelCount
            });
            await yieldToEventLoop();
          }
        }

        for (const program of xmltv.programs) {
          const channelId = xmltvToChannelId.get(program.channelXmltvId);
          if (!channelId) continue;
          insertProgram.run(
            channelId,
            program.title,
            program.subtitle,
            program.description,
            program.category,
            program.startTime,
            program.endTime
          );
          savedProgramCount += 1;
          if (savedProgramCount % 1000 === 0) {
            setProgress({
              detail: `Saving programs ${savedProgramCount}/${xmltv.programs.length}.`,
              savedProgramCount,
              programCount: savedProgramCount
            });
            await yieldToEventLoop();
          }
        }
        setProgress({
          detail: `Saving programs ${savedProgramCount}/${xmltv.programs.length}.`,
          savedChannelCount,
          savedProgramCount,
          programCount: savedProgramCount
        });
        ingestDb.prepare("COMMIT").run();

        return {
          channelCount: sourceChannels.length,
          programCount: { count: savedProgramCount },
          matchedCount
        };
      } catch (error) {
        ingestDb.prepare("ROLLBACK").run();
        throw error;
      } finally {
        ingestDb.close();
      }
    };

    const counts = await applyRefresh();
    setProgress({
      stage: "Finalizing refresh",
      detail: "Writing refresh results.",
      channelCount: counts.channelCount,
      programCount: counts.programCount.count,
      totalProgramCount: xmltv.programs.length,
      savedChannelCount: counts.channelCount,
      savedProgramCount: counts.programCount.count,
      matchedCount: counts.matchedCount
    });
    db.prepare(
      `UPDATE refresh_runs
       SET status = 'success', finished_at = CURRENT_TIMESTAMP,
           channel_count = ?, program_count = ?, matched_count = ?
       WHERE id = ?`
    ).run(counts.channelCount, counts.programCount.count, counts.matchedCount, runId);

    setProgress({
      active: false,
      stage: "Refresh complete",
      detail: `${counts.channelCount} channels, ${counts.programCount.count} programs, ${counts.matchedCount} matched.`,
      channelCount: counts.channelCount,
      programCount: counts.programCount.count,
      totalProgramCount: xmltv.programs.length,
      savedChannelCount: counts.channelCount,
      savedProgramCount: counts.programCount.count,
      matchedCount: counts.matchedCount
    });
    return { id: runId, status: "success", ...counts, programCount: counts.programCount.count };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(
      "UPDATE refresh_runs SET status = 'failed', finished_at = CURRENT_TIMESTAMP, error = ? WHERE id = ?"
    ).run(message, runId);
    setProgress({
      active: false,
      stage: "Refresh failed",
      detail: message,
      error: message
    });
    throw error;
  }
}
