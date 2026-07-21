export function assertSafeRelativePath(input: string): string;
export function scanDirectory(root: string): Promise<{ filesScanned: number }>;
export function buildReleaseArchive(input?: { repositoryRoot?: string; outputPath?: string }): Promise<{ outputPath: string; files: number }>;
