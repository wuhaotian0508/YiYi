import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VoiceCore } from "@/components/voice/voice-core";
import { OutfitCanvas } from "@/components/outfit/outfit-canvas";
import { generateCandidates } from "@/domain/recommendation/engine";
import { demoIntent, demoWardrobe } from "@/mocks/wardrobe";

describe("UI primitives", () => {
  it("exposes the voice core as a single continuous-session action", () => {
    const onClick = vi.fn();
    render(<VoiceCore active={false} onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Start live voice session" });
    button.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders outfit pieces with accessible focus labels", () => {
    const outfit = generateCandidates(demoWardrobe, demoIntent)[0];
    render(<OutfitCanvas outfit={outfit} wardrobe={demoWardrobe} onSelect={() => undefined} />);
    expect(screen.getByLabelText("Recommended outfit")).toBeInTheDocument();
    expect(screen.getAllByRole("button").length).toBeGreaterThanOrEqual(4);
  });
});
