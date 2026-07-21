import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceDock } from "@/components/voice/voice-core";

afterEach(cleanup);

describe("VoiceDock controls", () => {
  it("renders the active center as a status indicator, while microphone and End remain real controls", () => {
    const onMute = vi.fn();
    const onEnd = vi.fn();
    render(<VoiceDock state="listening" status="Listening…" active onMute={onMute} onEnd={onEnd} />);

    expect(screen.queryByRole("button", { name: "Listening…" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Listening…" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mute microphone" }));
    fireEvent.click(screen.getByRole("button", { name: "End voice session" }));
    expect(onMute).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("labels the muted action as Unmute microphone", () => {
    const { container } = render(<VoiceDock state="listening" status="Listening…" active muted onMute={vi.fn()} onEnd={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Unmute microphone" })).toBeInTheDocument();
    expect(container.querySelector(".lucide-mic-off")).toBeInTheDocument();
  });

  it("shows the microphone state rather than a misleading speaker or inverse-action icon", () => {
    const { container } = render(<VoiceDock state="listening" status="Listening…" active onMute={vi.fn()} onEnd={vi.fn()} />);
    expect(container.querySelector(".lucide-mic")).toBeInTheDocument();
    expect(container.querySelector(".lucide-mic-off")).not.toBeInTheDocument();
  });
});
