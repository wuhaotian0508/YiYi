import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .filter((file) => file !== "pnpm-lock.yaml" && !file.startsWith("release-audit/"));
const patterns = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /Bearer [A-Za-z0-9._-]{20,}/,
  /(?:UPSTASH_REDIS_REST_TOKEN|PHOTOROOM_API_KEY|OPENAI_API_KEY)=\S+/,
];
const findings = [];
for (const file of tracked) {
  let content;
  try { content = readFileSync(file, "utf8"); } catch { continue; }
  if (content.includes("\0")) continue;
  if (patterns.some((pattern) => pattern.test(content))) findings.push(file);
}
if (findings.length) {
  console.error(`Potential secret material in tracked files: ${findings.join(", ")}`);
  process.exit(1);
}
console.log("No potential secret material in tracked files.");
