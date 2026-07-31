import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => {
  const mock: any = {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn() },
    workspace: { create: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    membership: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn() },
    integration: { createMany: vi.fn(), findMany: vi.fn() },
    refreshToken: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  };
  mock.$transaction = vi.fn((cb: (tx: unknown) => unknown) => cb(mock));
  return { prismaMock: mock };
});
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { register, login, refresh, logout } from "@/modules/auth/auth.service";
import { hashPassword, hashToken } from "@/lib/password";
import { signRefreshToken } from "@/lib/jwt";
import { ConflictError, UnauthorizedError, ForbiddenError } from "@/lib/errors";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auth.service — register", () => {
  it("creates a workspace + user + membership and returns tokens, never the password hash", async () => {
    prismaMock.workspace.count.mockResolvedValue(0); // first signup on this instance
    prismaMock.user.findUnique.mockResolvedValue(null); // no existing account
    prismaMock.workspace.create.mockResolvedValue({ id: "ws1", name: "Acme", slug: "acme-abcde" });
    prismaMock.user.create.mockResolvedValue({
      id: "u1",
      name: "Ali",
      email: "ali@example.com",
      passwordHash: "hashed",
    });
    prismaMock.membership.create.mockResolvedValue({ id: "m1", userId: "u1", workspaceId: "ws1", role: "OWNER" });
    prismaMock.integration.createMany.mockResolvedValue({ count: 9 });
    prismaMock.refreshToken.create.mockResolvedValue({});

    const result = await register({ name: "Ali", email: "ali@example.com", password: "supersecret1", workspaceName: "Acme" });

    expect(result.accessToken).toBeTypeOf("string");
    expect(result.refreshToken).toBeTypeOf("string");
    expect(result.user).not.toHaveProperty("passwordHash"); // sanitizeUser must strip this
    expect(result.user.email).toBe("ali@example.com");
    // 9 integration rows seeded (WhatsApp/Telegram/.../Google Sheets), all NOT_CONNECTED
    expect(prismaMock.integration.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([expect.objectContaining({ status: "NOT_CONNECTED" })]),
      })
    );
  });

  it("rejects signup with an email that's already registered", async () => {
    prismaMock.workspace.count.mockResolvedValue(0);
    prismaMock.user.findUnique.mockResolvedValue({ id: "existing", email: "ali@example.com" });

    await expect(
      register({ name: "Ali", email: "ali@example.com", password: "supersecret1", workspaceName: "Acme" })
    ).rejects.toBeInstanceOf(ConflictError);

    expect(prismaMock.workspace.create).not.toHaveBeenCalled(); // must not create anything on conflict
  });

  it("blocks signup once a business already exists on this instance — single-tenant, not open multi-tenant", async () => {
    prismaMock.workspace.count.mockResolvedValue(1); // someone already signed up

    await expect(
      register({ name: "Someone Else", email: "outsider@example.com", password: "supersecret1", workspaceName: "Other Co" })
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Must not even check for an email conflict or touch the DB further — the door is just closed.
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.workspace.create).not.toHaveBeenCalled();
  });

  it("allows exactly the first signup through when the instance is brand new", async () => {
    prismaMock.workspace.count.mockResolvedValue(0);
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.workspace.create.mockResolvedValue({ id: "ws1", name: "Acme", slug: "acme-abcde" });
    prismaMock.user.create.mockResolvedValue({ id: "u1", name: "Ali", email: "ali@example.com", passwordHash: "hashed" });
    prismaMock.membership.create.mockResolvedValue({ id: "m1", userId: "u1", workspaceId: "ws1", role: "OWNER" });
    prismaMock.integration.createMany.mockResolvedValue({ count: 9 });
    prismaMock.refreshToken.create.mockResolvedValue({});

    const result = await register({ name: "Ali", email: "ali@example.com", password: "supersecret1", workspaceName: "Acme" });

    expect(result.accessToken).toBeTypeOf("string");
  });
});

describe("auth.service — login", () => {
  it("issues tokens for a correct email + password", async () => {
    const passwordHash = await hashPassword("correct-horse-battery-staple");
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "ali@example.com",
      passwordHash,
      memberships: [{ id: "m1", workspaceId: "ws1", role: "OWNER" }],
    });
    prismaMock.membership.update.mockResolvedValue({});
    prismaMock.refreshToken.create.mockResolvedValue({});

    const result = await login({ email: "ali@example.com", password: "correct-horse-battery-staple" });

    expect(result.accessToken).toBeTypeOf("string");
  });

  it("rejects an incorrect password without revealing whether the email exists", async () => {
    const passwordHash = await hashPassword("the-real-password");
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "ali@example.com",
      passwordHash,
      memberships: [{ id: "m1", workspaceId: "ws1", role: "OWNER" }],
    });

    await expect(login({ email: "ali@example.com", password: "wrong-password" })).rejects.toThrow(UnauthorizedError);
  });

  it("rejects login for an unknown email", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(login({ email: "nobody@example.com", password: "whatever123" })).rejects.toThrow(UnauthorizedError);
  });

  it("tells Google-only accounts to use Google sign-in instead of accepting any password", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "ali@example.com",
      passwordHash: null, // signed up via Google, never set a password
      memberships: [{ id: "m1", workspaceId: "ws1", role: "OWNER" }],
    });

    await expect(login({ email: "ali@example.com", password: "anything" })).rejects.toThrow(/Google sign-in/);
  });
});

describe("auth.service — refresh", () => {
  it("rejects a garbage/expired refresh token before ever touching the database", async () => {
    await expect(refresh("not-a-real-jwt")).rejects.toBeInstanceOf(UnauthorizedError);
    expect(prismaMock.refreshToken.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a syntactically valid token that was already revoked", async () => {
    const token = signRefreshToken("u1");
    prismaMock.refreshToken.findUnique.mockResolvedValue({
      id: "rt1",
      tokenHash: hashToken(token),
      revokedAt: new Date(), // already used once — rotation must not allow reuse
      expiresAt: new Date(Date.now() + 100000),
    });

    await expect(refresh(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rotates a valid token: revokes the old one and issues a new pair", async () => {
    const token = signRefreshToken("u1");
    prismaMock.refreshToken.findUnique.mockResolvedValue({
      id: "rt1",
      tokenHash: hashToken(token),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 100000),
    });
    prismaMock.membership.findFirst.mockResolvedValue({ workspaceId: "ws1", role: "OWNER" });
    prismaMock.refreshToken.update.mockResolvedValue({});
    prismaMock.refreshToken.create.mockResolvedValue({});

    const result = await refresh(token);

    expect(prismaMock.refreshToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rt1" }, data: expect.objectContaining({ revokedAt: expect.any(Date) }) })
    );
    expect(result.accessToken).toBeTypeOf("string");
    expect(prismaMock.refreshToken.create).toHaveBeenCalled(); // a new token record was actually issued
  });
});

describe("auth.service — logout", () => {
  it("revokes the refresh token by its hash", async () => {
    prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    const token = signRefreshToken("u1");

    await logout(token);

    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { tokenHash: hashToken(token) },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
