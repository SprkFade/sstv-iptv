import { getDb, setting, setSetting } from "../db/database.js";
import { parseXmltv } from "./xmltv.js";
import { matchChannels } from "./match.js";
import { fetchXcChannels, xcXmltvUrl, type XcCredentials } from "./xc.js";

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

    const [sourceChannels, xmltvText] = await Promise.all([
      fetchXcChannels(xcCredentials),
      fetchText(xmltvUrl, "XMLTV guide")
    ]);
    const xmltv = parseXmltv(xmltvText);
    const { matches, matchedCount } = matchChannels(sourceChannels, xmltv.channels);

    const applyRefresh = db.transaction(() => {
      db.prepare("UPDATE channels SET enabled = 0, updated_at = CURRENT_TIMESTAMP").run();
      db.prepare("DELETE FROM programs").run();

      const findChannel = db.prepare(
        `SELECT id FROM channels
         WHERE (tvg_id IS NOT NULL AND tvg_id != '' AND tvg_id = ?)
            OR stream_url = ?
         ORDER BY CASE WHEN tvg_id = ? THEN 0 ELSE 1 END
         LIMIT 1`
      );
      const insertChannel = db.prepare(
        `INSERT INTO channels
         (tvg_id, tvg_name, display_name, logo_url, group_title, stream_url, xmltv_channel_id, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
      );
      const updateChannel = db.prepare(
        `UPDATE channels
         SET tvg_id = ?, tvg_name = ?, display_name = ?, logo_url = ?, group_title = ?,
             stream_url = ?, xmltv_channel_id = ?, enabled = 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      );
      const insertProgram = db.prepare(
        `INSERT INTO programs
         (channel_id, title, subtitle, description, category, start_time, end_time)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      const xmltvToChannelId = new Map<string, number>();
      sourceChannels.forEach((channel, index) => {
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
          xmltvMatch?.id ?? ""
        ] as const;

        const channelId = existing
          ? (updateChannel.run(...values, existing.id), existing.id)
          : Number(insertChannel.run(...values).lastInsertRowid);

        if (xmltvMatch?.id) xmltvToChannelId.set(xmltvMatch.id, channelId);
      });

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
      }

      return {
        channelCount: sourceChannels.length,
        programCount: db.prepare("SELECT COUNT(*) AS count FROM programs").get() as { count: number },
        matchedCount
      };
    });

    const counts = applyRefresh();
    db.prepare(
      `UPDATE refresh_runs
       SET status = 'success', finished_at = CURRENT_TIMESTAMP,
           channel_count = ?, program_count = ?, matched_count = ?
       WHERE id = ?`
    ).run(counts.channelCount, counts.programCount.count, counts.matchedCount, runId);

    return { id: runId, status: "success", ...counts, programCount: counts.programCount.count };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(
      "UPDATE refresh_runs SET status = 'failed', finished_at = CURRENT_TIMESTAMP, error = ? WHERE id = ?"
    ).run(message, runId);
    throw error;
  }
}
