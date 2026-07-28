import { DailySessionSchema, OutfitVersionSchema, PreferenceProfileSchema, WardrobeItemSchema, type DailySession, type OutfitVersion, type PreferenceProfile, type WardrobeItem } from "@/domain/schemas";
import { getCloudSession } from "@/lib/cloud/auth";
import { getSupabaseClient } from "@/lib/cloud/supabase-client";
import { db } from "@/lib/storage/db";

export type CloudTable =
  | "yiyi_wardrobe_items"
  | "yiyi_preference_profiles"
  | "yiyi_daily_sessions"
  | "yiyi_outfit_versions";

export type CloudRecord<T = unknown> = {
  id: string;
  user_id: string;
  updated_at: number;
  data: T;
};

type TimestampedRecord = { id: string; updatedAt?: number; createdAt?: number };
type CloudDataClient = {
  from(table: CloudTable): {
    upsert(rows: CloudRecord<unknown>[], options: { onConflict: string }): Promise<{ error: Error | null }>;
    select(columns: string): { eq(column: string, value: string): Promise<{ data: unknown; error: Error | null }> };
  };
};

const cloudTables: CloudTable[] = [
  "yiyi_wardrobe_items",
  "yiyi_preference_profiles",
  "yiyi_daily_sessions",
  "yiyi_outfit_versions",
];

function cloudTimestamp(record: TimestampedRecord) {
  return record.updatedAt ?? record.createdAt ?? 0;
}

export function preferNewest<T extends { updatedAt: number }>(local: T, remote: T): T {
  return remote.updatedAt > local.updatedAt ? remote : local;
}

/** Converts only non-image local records to the shared Supabase JSONB row shape. */
export function serializeCloudRecords<T extends TimestampedRecord>(userId: string, _table: CloudTable, records: T[]): CloudRecord<T>[] {
  return records.map((record) => ({ id: record.id, user_id: userId, updated_at: cloudTimestamp(record), data: record }));
}

/** Rejects malformed or cross-account rows before they can reach Dexie. */
export function parseCloudRecord<T>(userId: string, value: unknown): CloudRecord<T> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Partial<CloudRecord<T>>;
  if (record.user_id !== userId || typeof record.id !== "string" || typeof record.updated_at !== "number" || typeof record.data !== "object" || record.data === null || Array.isArray(record.data)) return null;
  return record as CloudRecord<T>;
}

function clientOrNull(): CloudDataClient | null {
  return getSupabaseClient() as CloudDataClient | null;
}

async function localRows(userId: string) {
  const [wardrobe, preferences, sessions, versions] = await Promise.all([
    db.wardrobeItems.toArray(),
    db.preferenceProfiles.toArray(),
    db.dailySessions.toArray(),
    db.outfitVersions.toArray(),
  ]);
  return [
    ["yiyi_wardrobe_items", serializeCloudRecords(userId, "yiyi_wardrobe_items", wardrobe)],
    ["yiyi_preference_profiles", serializeCloudRecords(userId, "yiyi_preference_profiles", preferences)],
    ["yiyi_daily_sessions", serializeCloudRecords(userId, "yiyi_daily_sessions", sessions)],
    ["yiyi_outfit_versions", serializeCloudRecords(userId, "yiyi_outfit_versions", versions)],
  ] as const;
}

/** Pushes local metadata after a Dexie commit; callers deliberately do not await it. */
export async function queueCloudSync() {
  const [client, session] = [clientOrNull(), await getCloudSession()];
  if (!client || !session) return { synced: false as const, reason: "unavailable" as const };
  const batches = await localRows(session.user.id);
  for (const [table, rows] of batches) {
    if (!rows.length) continue;
    const { error } = await client.from(table).upsert(rows as CloudRecord<unknown>[], { onConflict: "user_id,id" });
    if (error) throw error;
  }
  return { synced: true as const };
}

function validRemoteRows<T extends TimestampedRecord>(userId: string, rows: unknown, parser: { safeParse(value: unknown): { success: boolean; data?: T } }) {
  if (!Array.isArray(rows)) return [] as T[];
  return rows.flatMap((row) => {
    const cloudRow = parseCloudRecord<T>(userId, row);
    if (!cloudRow) return [];
    const parsed = parser.safeParse(cloudRow.data);
    if (!parsed.success || !parsed.data || parsed.data.id !== cloudRow.id || cloudTimestamp(parsed.data) !== cloudRow.updated_at) return [];
    return [parsed.data];
  });
}

async function readRows(client: CloudDataClient, table: CloudTable, userId: string) {
  const { data, error } = await client.from(table).select("*").eq("user_id", userId);
  if (error) throw error;
  return data;
}

/** Pulls validated rows and merges them into Dexie without reading or replacing image blobs. */
export async function bootstrapCloudSync() {
  const [client, session] = [clientOrNull(), await getCloudSession()];
  if (!client || !session) return { synced: false as const, reason: "unavailable" as const };
  const remote = await Promise.all(cloudTables.map((table) => readRows(client, table, session.user.id)));
  const wardrobe = validRemoteRows<WardrobeItem>(session.user.id, remote[0], WardrobeItemSchema);
  const preferences = validRemoteRows<PreferenceProfile>(session.user.id, remote[1], PreferenceProfileSchema);
  const sessions = validRemoteRows<DailySession>(session.user.id, remote[2], DailySessionSchema);
  const versions = validRemoteRows<OutfitVersion>(session.user.id, remote[3], OutfitVersionSchema);

  await db.transaction("rw", [db.wardrobeItems, db.preferenceProfiles, db.dailySessions, db.outfitVersions], async () => {
    for (const item of wardrobe) {
      const local = await db.wardrobeItems.get(item.id);
      if (!local || item.updatedAt > local.updatedAt) await db.wardrobeItems.put(item);
    }
    for (const profile of preferences) {
      const local = await db.preferenceProfiles.get(profile.id);
      if (!local || profile.updatedAt > local.updatedAt) await db.preferenceProfiles.put(profile);
    }
    for (const sessionRow of sessions) {
      const local = await db.dailySessions.get(sessionRow.id);
      if (!local || sessionRow.updatedAt > local.updatedAt) await db.dailySessions.put(sessionRow);
    }
    for (const version of versions) {
      const local = await db.outfitVersions.get(version.id);
      if (!local || version.createdAt > local.createdAt) await db.outfitVersions.put(version);
    }
  });
  await queueCloudSync();
  return { synced: true as const };
}
