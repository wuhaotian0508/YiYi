export function preferNewest<T extends { updatedAt: number }>(local: T, remote: T): T {
  return remote.updatedAt > local.updatedAt ? remote : local;
}
