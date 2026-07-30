import { describe, it, expect, vi, beforeEach } from "vitest";

const { verifyMock, prismaMock } = vi.hoisted(() => ({ verifyMock: vi.fn(), prismaMock: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ verify: verifyMock }) },
  createTransport: () => ({ verify: verifyMock }),
}));

import { testConnection } from "@/modules/channels/channel-connections.service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("channel-connections — email test connection", () => {
  it("fails clearly when no SMTP account is configured for this deployment", async () => {
    // .env.test leaves SMTP_HOST unset.
    const result = await testConnection({ channel: "EMAIL", fromAddress: "hello@example.com" });
    expect(result.valid).toBe(false);
    expect(result.detail).toMatch(/no smtp account/i);
  });
});
