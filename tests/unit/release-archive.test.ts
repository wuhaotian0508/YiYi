import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertSafeRelativePath, scanDirectory } from "../../scripts/build-release-archive.mjs";

describe("release archive safety gate", () => {
  it.each([".env", ".env.local", ".next/server.js", ".vercel/project.json", "node_modules/pkg/index.js", "debug.log", "cache/token.txt"])("rejects forbidden release path %s", (path) => {
    expect(() => assertSafeRelativePath(path)).toThrow();
  });

  it("detects secrets in an untracked-style staging file", async () => {
    const root = await mkdtemp(join(tmpdir(), "yiyi-release-scan-"));
    await mkdir(join(root, "src"));
    const fakeSecret = ["OPENAI_API_KEY=", "sk-", "test-only-value-that-must-never-ship"].join("");
    await writeFile(join(root, "src", "accidental.txt"), fakeSecret);
    await expect(scanDirectory(root)).rejects.toThrow(/accidental\.txt/);
  });

  it("accepts an allowlisted tree without forbidden paths or secret values", async () => {
    const root = await mkdtemp(join(tmpdir(), "yiyi-release-safe-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "safe.ts"), "export const configured = Boolean(process.env.OPENAI_API_KEY);");
    await expect(scanDirectory(root)).resolves.toEqual({ filesScanned: 1 });
  });
});
