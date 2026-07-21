import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReleaseArchive } from "../../scripts/build-release-archive.mjs";

const outputDirectory = await mkdtemp(join(tmpdir(), "yiyi-secret-audit-"));
try {
  const result = await buildReleaseArchive({ outputPath: join(outputDirectory, "verified-release.tgz") });
  console.log(`Verified allowlist staging and extracted archive (${result.files} files); no forbidden paths or secret material found.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}
