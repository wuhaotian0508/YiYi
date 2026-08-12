import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMagicLink = vi.hoisted(() => vi.fn());
const signInWithGoogle = vi.hoisted(() => vi.fn());

vi.mock("@/lib/cloud/auth", () => ({ sendMagicLink, signInWithGoogle }));

import { CloudSignInForm, cloudSignInRedirectUrl } from "@/components/cloud/cloud-sign-in-form";

describe("CloudSignInForm", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    sendMagicLink.mockResolvedValue(undefined);
    signInWithGoogle.mockResolvedValue(undefined);
    window.history.replaceState({}, "", "/sign-in?next=/settings");
  });

  it("keeps the post-sign-in destination in the Magic Link callback", async () => {
    expect(cloudSignInRedirectUrl(window.location.href)).toBe(`${window.location.origin}/sign-in?next=%2Fsettings`);

    render(<CloudSignInForm />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "person@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));

    expect(sendMagicLink).toHaveBeenCalledWith(
      "person@example.com",
      `${window.location.origin}/sign-in?next=%2Fsettings`,
    );
  });

  it("sends Google back to the same callback the Magic Link uses", () => {
    render(<CloudSignInForm />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(signInWithGoogle).toHaveBeenCalledWith(`${window.location.origin}/sign-in?next=%2Fsettings`);
  });

  it("re-enables Google when the handoff fails", async () => {
    signInWithGoogle.mockRejectedValue(new Error("Provider is not enabled."));
    render(<CloudSignInForm />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByText("Provider is not enabled.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue with Google" }).hasAttribute("disabled")).toBe(false);
  });

  it("rejects an external next destination", () => {
    expect(cloudSignInRedirectUrl(`${window.location.origin}/sign-in?next=https://example.com`)).toBe(
      `${window.location.origin}/sign-in`,
    );
  });
});
