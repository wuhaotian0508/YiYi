import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceDock } from "@/components/voice/voice-core";

afterEach(cleanup);

describe("VoiceDock controls", () => {
  it("uses one central control to commit a listening turn", () => {
    const onPrimary = vi.fn();
    render(<VoiceDock state="listening" status="Listening…" active onPrimary={onPrimary} />);

    const control = screen.getByRole("button", { name: "Done speaking" });
    fireEvent.click(control);
    expect(onPrimary).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /microphone/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /end voice/i })).not.toBeInTheDocument();
  });

  it("uses the same central control to interrupt speaking", () => {
    const onPrimary = vi.fn();
    render(<VoiceDock state="speaking" status="YiYi is speaking…" active onPrimary={onPrimary} />);
    fireEvent.click(screen.getByRole("button", { name: "Interrupt YiYi" }));
    expect(onPrimary).toHaveBeenCalledOnce();
  });

  it("renders protected phases as status, not fake buttons", () => {
    render(<VoiceDock state="tool_running" status="Choosing…" active onPrimary={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Choosing…" })).toBeInTheDocument();
  });
});
