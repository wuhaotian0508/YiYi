import { beforeEach, describe, expect, it, vi } from "vitest";

type MockGetUserResult = {
  data: { user: { email?: string | null } | null };
  error: Error | null;
};

const mocks = vi.hoisted(() => ({
  cloudConfiguration: vi.fn<
    () =>
      | { configured: true; url: string; key: string }
      | { configured: false; reason: "missing_configuration" }
  >(),
  createClient: vi.fn(),
  getUser: vi.fn<(token: string) => Promise<MockGetUserResult>>(),
}));

vi.mock("@/lib/cloud/supabase-client", () => ({
  cloudConfiguration: mocks.cloudConfiguration,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}));

import { verifiedCloudUser } from "@/lib/cloud/server-auth";

describe("verifiedCloudUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cloudConfiguration.mockReturnValue({
      configured: true,
      url: "https://cloud.example.test",
      key: "public-key",
    });
    mocks.createClient.mockReturnValue({ auth: { getUser: mocks.getUser } });
  });

  it.each([
    undefined,
    "",
    "Basic credential",
    "Bearer",
    "Bearer ",
    "Bearer  token",
    "Bearer token extra",
    "Bearer first, Bearer second",
    `Bearer ${"x".repeat(4097)}`,
  ])("rejects a missing or malformed Authorization header: %s", async (authorization) => {
    const headers = authorization === undefined ? undefined : { authorization };

    await expect(
      verifiedCloudUser(new Request("https://app.example.test/api", { headers })),
    ).resolves.toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each(["bearer", "bEaReR"])(
    "accepts the case-insensitive %s authorization scheme",
    async (scheme) => {
      mocks.getUser.mockResolvedValue({
        data: { user: { email: "Person@Example.COM" } },
        error: null,
      });

      await expect(
        verifiedCloudUser(
          new Request("https://app.example.test/api", {
            headers: { authorization: `${scheme} access-token` },
          }),
        ),
      ).resolves.toEqual({ ok: true, email: "person@example.com" });
    },
  );

  it("reports missing cloud configuration without creating a client", async () => {
    mocks.cloudConfiguration.mockReturnValue({
      configured: false,
      reason: "missing_configuration",
    });

    await expect(
      verifiedCloudUser(
        new Request("https://app.example.test/api", {
          headers: { authorization: "Bearer access-token" },
        }),
      ),
    ).resolves.toEqual({ ok: false, code: "CLOUD_NOT_CONFIGURED" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "provider error",
      response: { data: { user: null }, error: new Error("invalid session") },
    },
    {
      name: "missing user",
      response: { data: { user: null }, error: null },
    },
    {
      name: "missing email",
      response: { data: { user: {} }, error: null },
    },
    {
      name: "invalid email",
      response: { data: { user: { email: "not-an-email" } }, error: null },
    },
  ])("rejects an invalid session with $name", async ({ response }) => {
    mocks.getUser.mockResolvedValue(response);

    await expect(
      verifiedCloudUser(
        new Request("https://app.example.test/api", {
          headers: { authorization: "Bearer invalid-token" },
        }),
      ),
    ).resolves.toEqual({ ok: false, code: "UNAUTHORIZED" });
  });

  it("fails closed when Supabase client creation throws", async () => {
    mocks.createClient.mockImplementationOnce(() => {
      throw new Error("client unavailable");
    });

    await expect(
      verifiedCloudUser(
        new Request("https://app.example.test/api", {
          headers: { authorization: "Bearer access-token" },
        }),
      ),
    ).resolves.toEqual({ ok: false, code: "UNAUTHORIZED" });
  });

  it("fails closed when Supabase user verification rejects", async () => {
    mocks.getUser.mockRejectedValueOnce(new Error("verification unavailable"));

    await expect(
      verifiedCloudUser(
        new Request("https://app.example.test/api", {
          headers: { authorization: "Bearer access-token" },
        }),
      ),
    ).resolves.toEqual({ ok: false, code: "UNAUTHORIZED" });
  });

  it("returns only the normalized verified email from a non-persisting client", async () => {
    const token = "secret-access-token";
    mocks.getUser.mockResolvedValue({
      data: { user: { email: "  Person.Name@Example.COM  " } },
      error: null,
    });

    const result = await verifiedCloudUser(
      new Request("https://app.example.test/api", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );

    expect(mocks.createClient).toHaveBeenCalledWith(
      "https://cloud.example.test",
      "public-key",
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
    expect(mocks.getUser).toHaveBeenCalledWith(token);
    expect(result).toEqual({ ok: true, email: "person.name@example.com" });
    expect(JSON.stringify(result)).not.toContain(token);
  });
});
