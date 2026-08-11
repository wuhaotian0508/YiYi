export type OperationToken = {
  id: number;
  baseVersionId: string | null;
  abortController: AbortController;
  phase: "preparing" | "committing" | "publishing";
};

export class RecommendationOperationController {
  private currentId = 0;
  private active: OperationToken | null = null;
  private readonly idleListeners = new Set<() => void>();

  begin(baseVersionId: string | null) {
    if (this.active) throw new Error("OUTFIT_OPERATION_IN_PROGRESS");
    const token: OperationToken = { id: ++this.currentId, baseVersionId, abortController: new AbortController(), phase: "preparing" };
    this.active = token;
    return token;
  }

  enterCommit(token: OperationToken) {
    if (!this.isCurrent(token)) throw new Error("STALE_OUTFIT_OPERATION");
    token.phase = "committing";
  }

  enterPublish(token: OperationToken) {
    if (!this.isCurrent(token)) throw new Error("STALE_OUTFIT_OPERATION");
    token.phase = "publishing";
  }

  isBusy() {
    return this.active !== null;
  }

  isCurrent(token: OperationToken) {
    return this.active?.id === token.id && !token.abortController.signal.aborted;
  }

  onIdle(listener: () => void) {
    this.idleListeners.add(listener);
    return () => this.idleListeners.delete(listener);
  }

  finish(token: OperationToken) {
    if (this.active?.id !== token.id) return;
    this.active = null;
    this.idleListeners.forEach((listener) => listener());
  }

  cancel() {
    if (this.active?.phase !== "preparing") return false;
    this.active?.abortController.abort();
    this.active = null;
    this.idleListeners.forEach((listener) => listener());
    return true;
  }
}

export async function runCommitPhase<T>(
  controller: RecommendationOperationController,
  token: OperationToken,
  mutation: () => Promise<T>,
) {
  controller.enterCommit(token);
  const result = await mutation();
  controller.enterPublish(token);
  return result;
}
