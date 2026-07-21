export type VoiceTurnState =
  | "idle"
  | "connecting"
  | "listening"
  | "committing"
  | "understanding"
  | "tool_running"
  | "revising"
  | "speaking"
  | "interrupted"
  | "recoverable_error";

type PrimaryActions = { commit(): void; interrupt(): void };

export class VoiceTurnController {
  private current: VoiceTurnState = "idle";

  constructor(private readonly effects: {
    publish(state: VoiceTurnState): void;
    setMicrophoneMuted(muted: boolean): void;
  }) {}

  get state() { return this.current; }

  connecting() { this.transition("connecting"); }
  connected() { this.transition("listening"); }
  idle() { this.transition("idle"); }
  fail() { this.transition("recoverable_error"); }

  speechStarted() {
    // SDK VAD is evidence only. Background audio cannot unlock a protected
    // product phase or interrupt a mutation/response.
    if (this.current === "listening") this.transition("listening");
  }

  speechStopped() {
    if (this.current === "listening") this.transition("committing");
  }

  agentStarted() {
    if (["listening", "committing", "interrupted"].includes(this.current)) this.transition("understanding");
  }

  awaitingTool() {
    if (this.current !== "tool_running" && this.current !== "revising") this.transition("understanding");
  }

  toolStarted(toolName: string) {
    // Tool name alone does not reveal whether handle_outfit_turn is revise,
    // random, undo, confirm, availability, or no_change. The owning product
    // surface applies the parsed action; the low-level controller only reports
    // that verified work is running.
    void toolName;
    this.transition("tool_running");
  }

  toolEnded(success: boolean) {
    this.transition(success ? "understanding" : "recoverable_error");
  }

  audioStarted() { this.transition("speaking"); }

  audioStopped() {
    if (this.current === "speaking" || this.current === "understanding" || this.current === "interrupted") {
      this.transition("listening");
    }
  }

  primaryAction(actions: PrimaryActions): "commit" | "interrupt" | "none" {
    if (this.current === "listening") {
      this.transition("committing");
      actions.commit();
      return "commit";
    }
    if (this.current === "speaking") {
      actions.interrupt();
      this.transition("interrupted");
      return "interrupt";
    }
    return "none";
  }

  private transition(next: VoiceTurnState) {
    if (this.current === next && next !== "listening") return;
    this.current = next;
    this.effects.setMicrophoneMuted(next !== "listening");
    this.effects.publish(next);
  }
}
