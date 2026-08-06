import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditableVoiceTranscript } from "@/components/voice/editable-voice-transcript";

describe("EditableVoiceTranscript", () => {
  afterEach(() => cleanup());
  it("shows the transcript and enters edit mode from the pencil", () => {
    render(<EditableVoiceTranscript text="Dinner tonight, lots of walking." onCommit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText("Dinner tonight, lots of walking.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Edit transcript" }));
    expect(screen.getByRole("textbox", { name: "Voice transcript" })).toHaveValue("Dinner tonight, lots of walking.");
  });

  it("commits edited text with the checkmark", () => {
    const onCommit = vi.fn();
    render(<EditableVoiceTranscript text="Dinner tonight." onCommit={onCommit} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit transcript" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Voice transcript" }), { target: { value: "Dinner and walking tonight." } });
    fireEvent.click(screen.getByRole("button", { name: "Use edited transcript" }));
    expect(onCommit).toHaveBeenCalledWith("Dinner and walking tonight.");
  });

  it("keeps editing and validates blank text", () => {
    render(<EditableVoiceTranscript text="Dinner tonight." onCommit={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit transcript" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Voice transcript" }), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Use edited transcript" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Transcript cannot be empty.");
  });

  it("cancels without committing", () => {
    const onCancel = vi.fn();
    render(<EditableVoiceTranscript text="Dinner tonight." onCommit={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit transcript" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel transcript edit" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
