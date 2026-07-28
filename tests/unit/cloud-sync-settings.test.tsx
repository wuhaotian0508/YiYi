import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

describe("CloudSyncSettings", () => {
  it("offers an optional Magic Link without gating local use", async () => {
    render(<CloudSyncSettings />);
    expect(await screen.findByText("Cloud sync")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "person@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(sendMagicLink).toHaveBeenCalledWith("person@example.com", window.location.origin);
  });
});
