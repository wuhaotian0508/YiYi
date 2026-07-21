import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CalibrationProfileReview,
  OnboardingCalibration,
} from "@/components/calibration/onboarding-calibration";
import {
  buildCalibrationPreferenceProfile,
  createCalibrationResponse,
} from "@/domain/preferences/calibration-engine";
import { calibrationCatalogV2 } from "@/domain/preferences/calibration-catalog";
import type { CalibrationResponse, CalibrationResponseChoice } from "@/domain/schemas";

afterEach(cleanup);

function CalibrationHarness({
  onFinish = vi.fn(),
  initialResponses = [],
  initialQuestionIndex = 0,
}: {
  onFinish?: () => void;
  initialResponses?: CalibrationResponse[];
  initialQuestionIndex?: number;
}) {
  const [responses, setResponses] = useState<CalibrationResponse[]>(initialResponses);
  const [questionIndex, setQuestionIndex] = useState(initialQuestionIndex);
  return <OnboardingCalibration
      questionIndex={questionIndex}
      responses={responses}
      onQuestionIndexChange={setQuestionIndex}
    onResponses={setResponses}
    onBack={vi.fn()}
    onFinish={onFinish}
  />;
}

function response(index: number, choice: CalibrationResponseChoice) {
  return createCalibrationResponse(calibrationCatalogV2.questions[index].id, choice, 1_750_000_000_000 + index);
}

describe("formal onboarding calibration", () => {
  it("uses four base comparisons and finishes without inventing extra work for decisive answers", () => {
    const onFinish = vi.fn();
    render(<CalibrationHarness onFinish={onFinish} />);

    expect(screen.getByText("1 of 4")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /matching mannequins/i })).toHaveAttribute(
      "src",
      expect.stringContaining("pair-relaxed-polished.webp"),
    );

    for (let index = 0; index < 4; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "A feels like me" }));
    }

    expect(onFinish).toHaveBeenCalledOnce();
  });

  it("asks no more than two follow-ups when the base answers are ambiguous", () => {
    const onFinish = vi.fn();
    render(<CalibrationHarness onFinish={onFinish} />);

    for (let index = 0; index < 4; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Both" }));
    }
    expect(screen.getByText("Optional 1 of 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Both" }));
    expect(screen.getByText("Optional 2 of 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Both" }));

    expect(onFinish).toHaveBeenCalledOnce();
  });

  it("lets the user finish before answering and keeps the pair choices explicit", () => {
    const onFinish = vi.fn();
    render(<CalibrationHarness onFinish={onFinish} />);

    expect(screen.getByRole("button", { name: "A feels like me" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "B feels like me" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Both" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Neither" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Finish for now" }));
    expect(onFinish).toHaveBeenCalledOnce();
  });

  it("keeps canonical A on the left and B on the right", () => {
    render(<CalibrationHarness />);

    expect(screen.getByRole("img", { name: "Relaxed everyday beside Polished tailoring, shown on matching mannequins" })).toBeInTheDocument();
    const labels = document.querySelectorAll("[data-calibration-option]");
    expect([...labels].map((label) => label.textContent)).toEqual(["ARelaxed everyday", "BPolished tailoring"]);
    expect(document.querySelector('[data-source-option="a"]')).toHaveAttribute("data-presentation-position", "left");
    expect(document.querySelector('[data-source-option="b"]')).toHaveAttribute("data-presentation-position", "right");
  });

  it("restores a legacy reversed response without moving the options or changing its canonical choice", () => {
    const legacy = createCalibrationResponse(
      calibrationCatalogV2.questions[0].id,
      "b",
      1_750_000_000_000,
      calibrationCatalogV2,
      ["b", "a"],
    );
    render(<CalibrationHarness initialResponses={[legacy]} />);

    expect(document.querySelector('[data-source-option="a"]')).toHaveAttribute("data-presentation-position", "left");
    expect(document.querySelector('[data-source-option="b"]')).toHaveAttribute("data-presentation-position", "right");
    expect(screen.getByRole("button", { name: "B feels like me" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "A feels like me" })).toHaveAttribute("aria-pressed", "false");
  });

  it("ends the calibration early after two consecutive Skips", () => {
    const onFinish = vi.fn();
    render(<CalibrationHarness onFinish={onFinish} />);

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onFinish).not.toHaveBeenCalled();
    expect(screen.getByText("2 of 4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(onFinish).toHaveBeenCalledOnce();
  });

  it("keeps previously answered optional comparisons reachable from Edit", () => {
    const responses = calibrationCatalogV2.questions.map((_, index) => response(index, "both"));
    render(<CalibrationHarness initialResponses={responses} initialQuestionIndex={3} />);

    fireEvent.click(screen.getByRole("button", { name: "Both" }));
    expect(screen.getByText("Optional 1 of 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Both" }));
    expect(screen.getByText("Optional 2 of 2")).toBeInTheDocument();
  });

  it("shows canonical More, Less, Unknown and confidence without treating the relative loser as Less", () => {
    const profile = buildCalibrationPreferenceProfile({
      direction: "neutral",
      responses: [response(0, "a")],
      now: 1_750_000_000_100,
    });
    render(<CalibrationProfileReview
      direction="neutral"
      profile={profile}
      canUndo
      onBack={vi.fn()}
      onEdit={vi.fn()}
      onUndo={vi.fn()}
      onNext={vi.fn()}
    />);

    expect(screen.getByRole("heading", { name: "More of" })).toBeInTheDocument();
    expect(screen.getByText("Relaxed everyday")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Less of" })).toBeInTheDocument();
    expect(screen.getByText("Nothing yet — YiYi will not invent dislikes.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Still open" })).toBeInTheDocument();
    expect(screen.getByText("Polished tailoring")).toBeInTheDocument();
    expect(screen.getByText(/starting confidence/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit comparisons" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo last answer" })).toBeInTheDocument();
  });

  it("keeps needs-review signals out of More and Less until the user confirms them", () => {
    const profile = buildCalibrationPreferenceProfile({
      direction: "neutral",
      responses: [response(0, "a")],
      now: 1_750_000_000_100,
    });
    const pending = profile.preferenceSignals?.find((signal) => signal.polarity === "more");
    const reviewProfile = {
      ...profile,
      preferenceSignals: (profile.preferenceSignals ?? []).map((signal) => (
        signal.id === pending?.id ? { ...signal, status: "needs_review" as const } : signal
      )),
    };
    render(<CalibrationProfileReview
      direction="neutral"
      profile={reviewProfile}
      canUndo={false}
      onBack={vi.fn()}
      onEdit={vi.fn()}
      onUndo={vi.fn()}
      onNext={vi.fn()}
    />);

    expect(screen.getByRole("heading", { name: "Needs your review" })).toBeInTheDocument();
    expect(screen.getByText("Relaxed everyday")).toBeInTheDocument();
    expect(screen.getByText("Open to suggestions.")).toBeInTheDocument();
  });
});
