import { useEffect, useMemo, useState } from "react";
import { ArrowDownAZ, Eye, EyeOff, GripVertical, Layers3, RefreshCw, Save, X } from "lucide-react";
import { api, type ChannelGroup } from "../api/client";

function numberRange(group: ChannelGroup) {
  if (!group.enabled) return "Hidden";
  if (group.first_channel_number === null || group.last_channel_number === null) return "No channels";
  if (group.first_channel_number === group.last_channel_number) return `CH ${group.first_channel_number}`;
  return `CH ${group.first_channel_number}-${group.last_channel_number}`;
}

function enabledCount(groups: ChannelGroup[]) {
  return groups.filter((group) => group.enabled).length;
}

export function GroupsPage() {
  const [groups, setGroups] = useState<ChannelGroup[]>([]);
  const [savedGroups, setSavedGroups] = useState<ChannelGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const [pendingGroupIds, setPendingGroupIds] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const dirtyOrder = useMemo(() => {
    if (groups.length !== savedGroups.length) return true;
    return groups.some((group, index) => group.id !== savedGroups[index]?.id);
  }, [groups, savedGroups]);

  const load = async () => {
    const response = await api.groups();
    setGroups(response.groups);
    setSavedGroups(response.groups);
  };

  useEffect(() => {
    load()
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load groups"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 4000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const applyGroups = (nextGroups: ChannelGroup[]) => {
    setGroups(nextGroups);
    setSavedGroups(nextGroups);
  };

  const mergeGroupUpdates = (nextGroups: ChannelGroup[]) => {
    const nextById = new Map(nextGroups.map((group) => [group.id, group]));
    const merge = (current: ChannelGroup[]) => current.map((group) => nextById.get(group.id) ?? group);
    setGroups(merge);
    setSavedGroups(merge);
  };

  const updateGroup = async (group: ChannelGroup, body: { enabled?: boolean; useChannelNameForEpg?: boolean }) => {
    setError("");
    setMessage("");
    setPendingGroupIds((current) => new Set(current).add(group.id));
    const previousGroups = groups;
    const previousSavedGroups = savedGroups;
    setGroups((current) => current.map((item) => item.id === group.id ? {
      ...item,
      enabled: typeof body.enabled === "boolean" ? (body.enabled ? 1 : 0) : item.enabled,
      use_channel_name_for_epg: typeof body.useChannelNameForEpg === "boolean" ? (body.useChannelNameForEpg ? 1 : 0) : item.use_channel_name_for_epg
    } : item));
    try {
      const response = await api.updateGroup(group.id, body);
      mergeGroupUpdates(response.groups);
      setMessage("Group settings saved.");
    } catch (err) {
      setGroups(previousGroups);
      setSavedGroups(previousSavedGroups);
      setError(err instanceof Error ? err.message : "Unable to save group");
    } finally {
      setPendingGroupIds((current) => {
        const next = new Set(current);
        next.delete(group.id);
        return next;
      });
    }
  };

  const moveDraggedGroup = (targetId: number) => {
    if (dragId === null || dragId === targetId) return;
    setGroups((current) => {
      const from = current.findIndex((group) => group.id === dragId);
      const to = current.findIndex((group) => group.id === targetId);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      const [dragged] = next.splice(from, 1);
      next.splice(to, 0, dragged);
      return next;
    });
  };

  const saveOrder = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await api.saveGroupOrder(groups.map((group) => group.id));
      applyGroups(response.groups);
      setEditMode(false);
      setMessage("Group order saved and channel numbers recalculated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save group order");
    } finally {
      setSaving(false);
    }
  };

  const recalculate = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await api.recalculateGroups();
      applyGroups(response.groups);
      setMessage("Channel numbers recalculated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to recalculate channel numbers");
    } finally {
      setSaving(false);
    }
  };

  const defaultSort = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await api.defaultSortGroups();
      applyGroups(response.groups);
      setEditMode(false);
      setMessage("Default group order applied and channel numbers recalculated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to apply default group order");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="rounded-md border border-line bg-panel p-4 shadow-soft">
        <h1 className="text-2xl font-bold">Groups</h1>
        <p className="mt-1 text-sm text-ink/60">Loading channel groups...</p>
      </section>
    );
  }

  return (
    <div className="grid min-w-0 gap-4">
      <section className="rounded-md border border-line bg-panel p-4 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-md bg-accent text-white">
              <Layers3 size={22} />
            </span>
            <div>
              <h1 className="text-2xl font-bold">Groups</h1>
              <p className="text-sm text-ink/60">
                {enabledCount(groups)} enabled of {groups.length} groups. Enabled groups assign guide channel numbers in this order.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {editMode ? (
              <>
                <button
                  className="flex min-h-10 items-center gap-2 rounded-md bg-accent px-3 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={saving || !dirtyOrder}
                  onClick={saveOrder}
                >
                  <Save size={16} /> Save order
                </button>
                <button
                  className="flex min-h-10 items-center gap-2 rounded-md border border-line bg-panel px-3 text-sm font-semibold hover:bg-ink/5"
                  onClick={() => {
                    setGroups(savedGroups);
                    setEditMode(false);
                  }}
                >
                  <X size={16} /> Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  className="flex min-h-10 items-center gap-2 rounded-md border border-line bg-panel px-3 text-sm font-semibold hover:bg-ink/5"
                  onClick={() => setEditMode(true)}
                >
                  <GripVertical size={16} /> Edit order
                </button>
                <button
                  className="flex min-h-10 items-center gap-2 rounded-md border border-line bg-panel px-3 text-sm font-semibold hover:bg-ink/5 disabled:opacity-60"
                  disabled={saving}
                  onClick={defaultSort}
                  title="Sort country-prefixed groups first: US, CA, UK, AU, NZ, then the rest"
                >
                  <ArrowDownAZ size={16} /> Default sort
                </button>
                <button
                  className="flex min-h-10 items-center gap-2 rounded-md border border-line bg-panel px-3 text-sm font-semibold hover:bg-ink/5 disabled:opacity-60"
                  disabled={saving}
                  onClick={recalculate}
                >
                  <RefreshCw size={16} className={saving ? "animate-spin" : ""} /> Recalculate
                </button>
              </>
            )}
          </div>
        </div>
        {message && <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}
        {error && <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
      </section>

      {groups.length === 0 ? (
        <section className="rounded-md border border-line bg-panel p-6 text-center shadow-soft">
          <h2 className="text-lg font-bold">No groups yet</h2>
          <p className="mt-1 text-sm text-ink/60">Run a source refresh to discover channel groups.</p>
        </section>
      ) : (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group, index) => {
            const groupPending = pendingGroupIds.has(group.id);
            return (
              <article
                key={group.id}
                draggable={editMode}
                onDragStart={() => setDragId(group.id)}
                onDragEnd={() => setDragId(null)}
                onDragOver={(event) => {
                  if (!editMode) return;
                  event.preventDefault();
                  moveDraggedGroup(group.id);
                }}
                className={`rounded-md border bg-panel p-4 shadow-soft transition ${dragId === group.id ? "border-accent opacity-70" : "border-line"} ${!group.enabled ? "opacity-55" : ""} ${editMode ? "cursor-grab active:cursor-grabbing" : ""}`}
              >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <span className={`mt-1 grid size-9 shrink-0 place-items-center rounded-md border ${group.enabled ? "border-accent/50 bg-accent/15 text-accent" : "border-line text-ink/45"}`}>
                    {editMode ? <GripVertical size={18} /> : <Layers3 size={18} />}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-bold">{group.name}</h2>
                      <span className="rounded-md border border-line px-2 py-0.5 text-xs font-semibold text-ink/60">#{index + 1}</span>
                    </div>
                    <p className="mt-1 text-sm text-ink/60">
                      {group.channel_count} channels · {numberRange(group)}
                    </p>
                  </div>
                </div>
                <button
                  className={`grid size-9 shrink-0 place-items-center rounded-md border transition hover:bg-ink/5 disabled:opacity-60 ${group.enabled ? "border-accent/50 bg-accent/15 text-accent" : "border-line bg-mist text-ink/50"}`}
                  disabled={groupPending}
                  onClick={() => updateGroup(group, { enabled: !group.enabled })}
                  title={group.enabled ? "Hide group everywhere" : "Show group"}
                >
                  {group.enabled ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>
              </div>

              <div className="mt-4 grid gap-3">
                <label className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-line bg-mist px-3 text-sm font-semibold">
                  Use channel name when EPG is empty
                  <input
                    className="size-5 accent-accent"
                    type="checkbox"
                    disabled={groupPending}
                    checked={Boolean(group.use_channel_name_for_epg)}
                    onChange={(event) => updateGroup(group, { useChannelNameForEpg: event.target.checked })}
                  />
                </label>
              </div>
            </article>
          )})}
        </section>
      )}
    </div>
  );
}
