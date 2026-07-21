import { execFileSync } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const forbiddenSegments = new Set([".git", ".next", ".vercel", "node_modules", "cache", "coverage", "playwright-report", "test-results"]);
const forbiddenExtensions = [/\.log$/i, /\.pem$/i, /\.key$/i, /\.p12$/i, /\.tgz$/i, /\.zip$/i];
const secretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /Bearer\s+[A-Za-z0-9._-]{20,}/,
  /(?:UPSTASH_REDIS_REST_TOKEN|PHOTOROOM_API_KEY|OPENAI_API_KEY)[\t ]*=[\t ]*[^\s"']+/,
  /(?:client_secret|access_token|refresh_token)\s*[=:]\s*["']?[A-Za-z0-9._-]{20,}/i,
];
const allowedTopLevelDirectories = new Set([".github", "public", "release-audit", "scripts", "src", "tests"]);
const allowedRootFiles = new Set([
  "AGENTS.md", "API_CONTRACTS.md", "ARCHITECTURE.md", "ASSET_ATTRIBUTION.md", "DATA_MODEL.md", "PRODUCT_SPEC.md", "README.md", "README_PACKAGE.md", "TEST_PLAN.md",
  "eslint.config.mjs", "next-env.d.ts", "next.config.ts", "package.json", "playwright.config.ts", "playwright.live.config.ts", "playwright.motion.config.ts", "pnpm-lock.yaml", "pnpm-workspace.yaml", "postcss.config.mjs", "tsconfig.json",
  "YIYI_MASTER_DEVELOPMENT_SPEC.md", "YIYI_MOTION_ACCEPTANCE.md", "YIYI_MOTION_ARCHITECTURE_DECISION.md", "YIYI_MOTION_STORYBOARD.md", "YIYI_RECOMMENDATION_ENGINE_RESEARCH.md", "YIYI_STYLE_CALIBRATION_RESEARCH.md",
]);

export function assertSafeRelativePath(input) {
  const normalized = input.replaceAll("\\", "/").replace(/^\.\//, "");
  const segments = normalized.split("/").filter(Boolean);
  if (!normalized || normalized.startsWith("/") || segments.includes("..")) throw new Error(`Unsafe release path: ${input}`);
  if (segments.some((segment) => forbiddenSegments.has(segment))) throw new Error(`Forbidden release path: ${input}`);
  if (segments.some((segment) => /^\.env(?:\.|$)/i.test(segment))) throw new Error(`Environment file is forbidden in release archive: ${input}`);
  if (forbiddenExtensions.some((expression) => expression.test(normalized))) throw new Error(`Forbidden release file: ${input}`);
  return normalized;
}

function isAllowlistedTrackedFile(file) {
  const normalized = file.replaceAll("\\", "/").replace(/^\.\//, "");
  const [topLevel] = normalized.split("/");
  const allowlisted = normalized.includes("/") ? allowedTopLevelDirectories.has(topLevel) : allowedRootFiles.has(normalized);
  // Root files outside the explicit allowlist (including .env.example) never
  // enter staging. Once a path is allowlisted, every forbidden-path check is
  // still strict, so an accidental src/.env or bundled archive fails closed.
  if (!allowlisted) return false;
  assertSafeRelativePath(normalized);
  return true;
}

async function walk(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    const relativePath = relative(root, absolute).split(sep).join("/");
    assertSafeRelativePath(relativePath);
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are forbidden in release archive: ${relativePath}`);
    if (entry.isDirectory()) files.push(...await walk(root, absolute));
    else if (entry.isFile()) files.push({ absolute, relativePath });
    else throw new Error(`Unsupported release entry: ${relativePath}`);
  }
  return files;
}

export async function scanDirectory(root) {
  const files = await walk(root);
  const findings = [];
  for (const file of files) {
    const content = await readFile(file.absolute);
    if (content.includes(0)) continue;
    const text = content.toString("utf8");
    if (secretPatterns.some((pattern) => pattern.test(text))) findings.push(file.relativePath);
  }
  if (findings.length) throw new Error(`Potential secret material in release staging: ${findings.join(", ")}`);
  return { filesScanned: files.length };
}

export async function buildReleaseArchive(input = {}) {
  const repositoryRoot = resolve(input.repositoryRoot ?? process.cwd());
  const outputPath = resolve(repositoryRoot, input.outputPath ?? "release-artifacts/yiyi-release.tgz");
  const temporaryRoot = await mkdtemp(join(tmpdir(), "yiyi-release-"));
  const stage = join(temporaryRoot, "stage");
  const extracted = join(temporaryRoot, "extracted");
  const archive = join(temporaryRoot, "yiyi-release.tgz");
  await mkdir(stage);
  try {
    const tracked = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: repositoryRoot, encoding: "utf8" }).split("\0").filter(Boolean);
    const allowlisted = tracked.filter(isAllowlistedTrackedFile);
    if (!allowlisted.length) throw new Error("Release allowlist produced no files.");
    for (const file of allowlisted) {
      const source = resolve(repositoryRoot, file);
      const repositoryRealPath = await realpath(repositoryRoot);
      const sourceRealPath = await realpath(source);
      if (!sourceRealPath.startsWith(`${repositoryRealPath}${sep}`)) throw new Error(`Release source escapes repository: ${file}`);
      if ((await lstat(source)).isSymbolicLink()) throw new Error(`Release source symlink is forbidden: ${file}`);
      const destination = join(stage, file);
      await mkdir(dirname(destination), { recursive: true });
      await cp(source, destination, { errorOnExist: true, force: false });
    }
    const before = await scanDirectory(stage);
    execFileSync("tar", ["-czf", archive, "-C", stage, "."]);
    await mkdir(extracted);
    execFileSync("tar", ["-xzf", archive, "-C", extracted]);
    const after = await scanDirectory(extracted);
    if (before.filesScanned !== after.filesScanned) throw new Error("Release archive file count changed after extraction.");
    await mkdir(dirname(outputPath), { recursive: true });
    await cp(archive, outputPath, { force: true });
    return { outputPath, files: after.filesScanned };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  buildReleaseArchive().then((result) => console.log(JSON.stringify({ event: "yiyi_release_archive", outcome: "success", ...result }))).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
