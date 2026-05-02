import type Database from "better-sqlite3";

export const UNGROUPED_NAME = "Ungrouped";
const DEFAULT_PREFIX_ORDER = ["US", "CA", "UK", "AU", "NZ"];

export function groupNameSql(alias = "channels") {
  return `COALESCE(NULLIF(${alias}.group_title, ''), '${UNGROUPED_NAME}')`;
}

function compareNatural(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function groupPrefix(name: string) {
  const match = name.match(/^\s*([A-Za-z0-9]+)\s*\|/);
  return match?.[1]?.toUpperCase() ?? "";
}

function defaultSortRank(name: string) {
  const prefix = groupPrefix(name);
  if (!prefix) return { bucket: 2, prefix: "", prefixRank: Number.MAX_SAFE_INTEGER };
  const knownIndex = DEFAULT_PREFIX_ORDER.indexOf(prefix);
  return {
    bucket: knownIndex >= 0 ? 0 : 1,
    prefix,
    prefixRank: knownIndex >= 0 ? knownIndex : Number.MAX_SAFE_INTEGER
  };
}

export function ensureChannelGroups(database: Database.Database, defaultEnabled = false) {
  const groups = database
    .prepare(
      `SELECT DISTINCT ${groupNameSql()} AS name
       FROM channels
       WHERE enabled = 1
       ORDER BY name COLLATE NOCASE`
    )
    .all() as Array<{ name: string }>;
  if (groups.length === 0) return;

  const existing = new Set(
    (database.prepare("SELECT name FROM channel_groups").all() as Array<{ name: string }>).map((row) => row.name)
  );
  let nextSort = Number(
    (database.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM channel_groups").get() as { next_sort: number }).next_sort
  );
  const insert = database.prepare(
    `INSERT INTO channel_groups (name, enabled, sort_order)
     VALUES (?, ?, ?)`
  );

  for (const group of groups) {
    if (existing.has(group.name)) continue;
    insert.run(group.name, defaultEnabled ? 1 : 0, nextSort);
    nextSort += 1;
  }
}

export function recalculateChannelNumbers(database: Database.Database) {
  ensureChannelGroups(database, false);

  const groups = database
    .prepare(
      `SELECT id, name
       FROM channel_groups
       WHERE enabled = 1
       ORDER BY sort_order, name COLLATE NOCASE`
    )
    .all() as Array<{ id: number; name: string }>;

  const channels = database
    .prepare(
      `SELECT id, display_name, sort_order, ${groupNameSql()} AS group_name
       FROM channels
       WHERE enabled = 1`
    )
    .all() as Array<{ id: number; display_name: string; sort_order: number; group_name: string }>;
  const channelsByGroup = new Map<string, typeof channels>();
  for (const channel of channels) {
    const list = channelsByGroup.get(channel.group_name) ?? [];
    list.push(channel);
    channelsByGroup.set(channel.group_name, list);
  }

  const clearNumbers = database.prepare("UPDATE channels SET channel_number = NULL, updated_at = CURRENT_TIMESTAMP WHERE enabled = 1");
  const updateNumber = database.prepare(
    "UPDATE channels SET channel_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  );

  clearNumbers.run();
  let nextNumber = 1;
  for (const group of groups) {
    const groupChannels = (channelsByGroup.get(group.name) ?? []).sort((left, right) => {
      const byName = compareNatural(left.display_name, right.display_name);
      if (byName !== 0) return byName;
      return left.sort_order - right.sort_order;
    });
    if (groupChannels.length === 0) continue;

    for (const channel of groupChannels) {
      updateNumber.run(nextNumber, channel.id);
      nextNumber += 1;
    }
    nextNumber += groupChannels.length <= 50 ? 25 : 50;
  }
}

export function applyDefaultGroupSort(database: Database.Database) {
  ensureChannelGroups(database, false);
  const groups = database
    .prepare("SELECT id, name FROM channel_groups")
    .all() as Array<{ id: number; name: string }>;

  groups.sort((left, right) => {
    const leftRank = defaultSortRank(left.name);
    const rightRank = defaultSortRank(right.name);
    if (leftRank.bucket !== rightRank.bucket) return leftRank.bucket - rightRank.bucket;
    if (leftRank.prefixRank !== rightRank.prefixRank) return leftRank.prefixRank - rightRank.prefixRank;
    const byPrefix = compareNatural(leftRank.prefix, rightRank.prefix);
    if (byPrefix !== 0) return byPrefix;
    return compareNatural(left.name, right.name);
  });

  const update = database.prepare("UPDATE channel_groups SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
  groups.forEach((group, index) => update.run(index, group.id));
  recalculateChannelNumbers(database);
}

export function listChannelGroups(database: Database.Database) {
  ensureChannelGroups(database, false);
  return database
    .prepare(
      `SELECT channel_groups.id,
              channel_groups.name,
              channel_groups.enabled,
              channel_groups.sort_order,
              channel_groups.use_channel_name_for_epg,
              COUNT(channels.id) AS channel_count,
              MIN(channels.channel_number) AS first_channel_number,
              MAX(channels.channel_number) AS last_channel_number
       FROM channel_groups
       LEFT JOIN channels ON ${groupNameSql()} = channel_groups.name
        AND channels.enabled = 1
       GROUP BY channel_groups.id
       ORDER BY channel_groups.sort_order, channel_groups.name COLLATE NOCASE`
    )
    .all();
}
