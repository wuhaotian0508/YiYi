import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { cloudConfiguration } from "@/lib/cloud/supabase-client";
import { parseCloudRecord, preferNewest, serializeCloudRecords } from "@/lib/cloud/sync";

describe("Supabase cloud sync schema", () => {
  it("creates RLS-protected user-scoped tables", async () => {
    const sql = await readFile("supabase/migrations/20260722190000_create_yiyi_cloud_sync.sql", "utf8");

    for (const table of ["yiyi_wardrobe_items", "yiyi_preference_profiles", "yiyi_daily_sessions", "yiyi_outfit_versions"]) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain("auth.uid() = user_id");
    }
  });
});

describe("cloud synchronization policy", () => {
  it("reports missing configuration when a public value is absent", () => {
    expect(cloudConfiguration({ url: "", key: "pk" })).toEqual({ configured: false, reason: "missing_configuration" });
  });

  it("keeps the local record when timestamps are equal", () => {
    expect(preferNewest({ updatedAt: 10, value: "local" }, { updatedAt: 10, value: "remote" })).toEqual({ updatedAt: 10, value: "local" });
  });

  it("serializes metadata without touching image records", () => {
    const rows = serializeCloudRecords("user-1", "yiyi_wardrobe_items", [
      { id: "item-1", updatedAt: 42, category: "tops" },
    ]);

    expect(rows).toEqual([{ id: "item-1", user_id: "user-1", updated_at: 42, data: { id: "item-1", updatedAt: 42, category: "tops" } }]);
  });

  it("rejects a remote row owned by another user", () => {
    expect(parseCloudRecord("user-1", {
      id: "item-1",
      user_id: "user-2",
      updated_at: 42,
      data: { id: "item-1" },
    })).toBeNull();
  });
});
