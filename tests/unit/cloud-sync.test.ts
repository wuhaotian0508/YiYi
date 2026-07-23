import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { cloudConfiguration } from "@/lib/cloud/supabase-client";
import { preferNewest } from "@/lib/cloud/sync";

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
});
