import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConversationalOnboarding,
  onboardingStoryLabels,
  type OnboardingTimelineController,
} from "@/components/onboarding/conversational-onboarding";

vi.mock("motion/react", async (importOriginal) => ({
  ...await importOriginal<typeof import("motion/react")>(),
  useReducedMotionConfig: () => false,
}));

afterEach(cleanup);

describe("authored onboarding motion contract", () => {
  it("exposes every storyboard label and removes the former tutorial pages", async () => {
    const controller: { current?: OnboardingTimelineController } = {};
    render(<ConversationalOnboarding reviewMode onComplete={vi.fn()} onTimelineReady={(value) => { controller.current = value; }} />);

    await waitFor(() => expect(controller.current).toBeDefined());
    expect(controller.current?.labels).toEqual(onboardingStoryLabels);
    expect(screen.queryByText("Tell YiYi about your day — not your clothes.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show me how" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try it yourself" })).not.toBeInTheDocument();
  });

  it("holds on Begin until the user explicitly advances the authored scene", async () => {
    const controller: { current?: OnboardingTimelineController } = {};
    render(<ConversationalOnboarding reviewMode onComplete={vi.fn()} onTimelineReady={(value) => { controller.current = value; }} />);
    await waitFor(() => expect(controller.current).toBeDefined());

    const splash = screen.getByRole("heading", { name: "What should I wear today?" }).closest("section");
    const story = screen.getByText("How YiYi helps").closest("section");
    expect(splash).not.toBeNull();
    expect(story).not.toBeNull();

    act(() => {
      controller.current?.timeline.pause(4.04);
      controller.current?.play();
    });
    await waitFor(() => expect(controller.current?.timeline.paused()).toBe(true));
    expect(splash).toHaveAttribute("aria-hidden", "false");
    expect(story).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(screen.getByRole("button", { name: "Begin" }));
    await waitFor(() => expect(story).toHaveAttribute("aria-hidden", "false"));
  });

  it("seeks and restarts deterministically without pre-rendering future characters", async () => {
    const controller: { current?: OnboardingTimelineController } = {};
    const { container } = render(<ConversationalOnboarding reviewMode onComplete={vi.fn()} onTimelineReady={(value) => { controller.current = value; }} />);
    await waitFor(() => expect(controller.current).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "Begin" }));
    await screen.findByText("How YiYi helps");
    const storyText = container.querySelector<HTMLElement>("[data-story-text]");
    expect(storyText).not.toBeNull();

    act(() => controller.current?.seek("decision:start"));
    expect(storyText).toHaveTextContent("");

    act(() => controller.current?.seek("decision:questions-complete"));
    expect(storyText).toHaveTextContent("what should I wear?????");
    expect(storyText?.textContent?.split("\n")).toHaveLength(8);

    act(() => controller.current?.seek("decision:delete"));
    expect(storyText?.textContent?.startsWith("Maybe my navy hoodie...")).toBe(true);
    expect(storyText).not.toHaveTextContent("what should I wear?????");

    act(() => controller.current?.seek("reframe:complete"));
    expect(storyText).toHaveTextContent("I have class, dinner with friends");
    expect(storyText).toHaveTextContent("still look put together");

  });

  it("changes only the authored shoe item at the revision label", async () => {
    const controller: { current?: OnboardingTimelineController } = {};
    const { container } = render(<ConversationalOnboarding reviewMode onComplete={vi.fn()} onTimelineReady={(value) => { controller.current = value; }} />);
    await waitFor(() => expect(controller.current).toBeDefined());

    await act(async () => { controller.current?.seek("outfit:assemble"); });
    const before = container.querySelector<HTMLElement>('[data-slot="shoes"] .garment-photo');
    expect(before?.style.getPropertyValue("--sprite-x")).toBe("33.333%");

    await act(async () => { controller.current?.seek("revision:replace"); });
    await waitFor(() => {
      expect(container.querySelector('[data-slot="shoes"] [data-item-id="44444444-4444-4444-8444-444444444441"]')).not.toBeNull();
    });
    expect(container.querySelectorAll('[data-slot="outerwear"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-slot="top"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-slot="bottom"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-slot="bag"]')).toHaveLength(1);

    await act(async () => { controller.current?.restart(); });
    await act(async () => { controller.current?.pause(); });
    expect(container.querySelector("[data-story-text]")).toHaveTextContent("");
  });
});
