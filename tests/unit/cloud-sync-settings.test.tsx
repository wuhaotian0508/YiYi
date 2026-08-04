import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMagicLink } = vi.hoisted(() => ({ sendMagicLink: vi.fn() }));

vi.mock("@/lib/cloud/supabase-client", () => ({ cloudConfiguration: () => ({ configured: true }) }));
vi.mock("@/lib/cloud/auth", () => ({
  getCloudSession: vi.fn().mockResolvedValue(null),
  sendMagicLink,
  signOutCloud: vi.fn(),
  subscribeToCloudAuth: vi.fn(() => () => undefined),
}));
vi.mock("@/lib/cloud/sync", () => ({ bootstrapCloudSync: vi.fn() }));

import { CloudSyncSettings } from "@/components/settings/cloud-sync-settings";

async function requestLink() {
  render(<CloudSyncSettings />);
  fireEvent.change(await screen.findByLabelText("Email address"), { target: { value: "person@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
}

describe("CloudSyncSettings", () => {
  afterEach(cleanup);

  beforeEach(() => {
    sendMagicLink.mockClear();
    window.history.replaceState({}, "", "/");
  });

  it("offers an optional Magic Link without gating local use", async () => {
    render(<CloudSyncSettings />);
    expect(await screen.findByText("Cloud sync")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Email me a sign-in link" })).toBeTruthy();
  });

  /**
   * Only routes that mount a Supabase client can exchange the PKCE `?code=`
   * parameter. Returning to the sending page keeps the link on such a route;
   * a bare origin lands on "/", which drops the code before it is redeemed.
   */
  it("returns the Magic Link to the page that sent it", async () => {
    window.history.replaceState({}, "", "/settings");
    await requestLink();
    expect(sendMagicLink).toHaveBeenCalledWith("person@example.com", `${window.location.origin}/settings`);
  });
});
