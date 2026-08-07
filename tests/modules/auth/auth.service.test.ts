import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => {
  const mock: any = {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn() },
    account: { create: vi.fn(), update: vi.fn() },
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
  it("creates a PENDING account + user and returns a pending status, never tokens or the password hash", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null); // no existing account for this email
    prismaMock.account.create.mockResolvedValue({ id: "acc1", businessName: "Acme", status: "PENDING" });

    const result = await register({
      name: "Ali",
      email: "ali@example.com",
      password: "supersecret1",
      businessName: "Acme",
    });

    expect(result.status).toBe("pending");
    expect(result.accountId).toBe("acc1");
    expect(result).not.toHaveProperty("accessToken"); // no workspace/tokens exist until a super_admin approves
    expect(prismaMock.account.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessName: "Acme",
          ownerEmail: "ali@example.com",
          status: "PENDING",
          users: { create: expect.objectContaining({ name: "Ali", email: "ali@example.com" }) },
        }),
      })
    );
  });

  it("rejects signup with an email that's already registered and active/pending/suspended", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "existing",
      email: "ali@example.com",
      isSuperAdmin: false,
      account: { id: "acc1", status: "PENDING" },
    });

    await expect(
      register({ name: "Ali", email: "ali@example.com", password: "supersecret1", businessName: "Acme" })
    ).rejects.toBeInstanceOf(ConflictError);

    expect(prismaMock.account.create).not.toHaveBeenCalled();
  });

  it("treats a re-signup from a REJECTED account as a re-appeal instead of a conflict", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "existing",
      email: "ali@example.com",
      isSuperAdmin: false,
      account: { id: "acc1", status: "REJECTED" },
    });
    prismaMock.user.update.mockResolvedValue({});
    prismaMock.account.update.mockResolvedValue({ id: "acc1", status: "PENDING" });

    const result = await register({
      name: "Ali Updated",
      email: "ali@example.com",
      password: "newpassword1",
      businessName: "Acme v2",
    });

    expect(result.status).toBe("pending");
    expect(result.accountId).toBe("acc1");
    // Must reuse the same account row and clear the rejection instead of creating a new one.
    expect(prismaMock.account.create).not.toHaveBeenCalled();
    expect(prismaMock.account.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "acc1" },
        data: expect.objectContaining({ status: "PENDING", rejectionReason: null, approvedById: null, approvedAt: null }),
      })
    );
  });
});

describe("auth.service — login", () => {
  it("issues tokens for a correct email + password on an ACTIVE account", async () => {
    const passwordHash = await hashPassword("correct-horse-battery-staple");
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "ali@example.com",
      passwordHash,
      isSuperAdmin: false,
      account: { status: "ACTIVE" },
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
      isSuperAdmin: false,
      account: { status: "ACTIVE" },
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
      isSuperAdmin: false,
      account: { status: "ACTIVE" },
      memberships: [{ id: "m1", workspaceId: "ws1", role: "OWNER" }],
    });

    await expect(login({ email: "ali@example.com", password: "anything" })).rejects.toThrow(/Google sign-in/);
  });

  it("blocks login for an account still awaiting approval", async () => {
    const passwordHash = await hashPassword("supersecret1");
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "ali@example.com",
      passwordHash,
      isSuperAdmin: false,
      account: { status: "PENDING" },
      memberships: [],
    });

    await expect(login({ email: "ali@example.com", password: "supersecret1" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("re-appeals a REJECTED account on login instead of permanently blocking it", async () => {
    const passwordHash = await hashPassword("supersecret1");
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "ali@example.com",
      passwordHash,
      isSuperAdmin: false,
      account: { id: "acc1", status: "REJECTED", rejectionReason: "Not a real business" },
      memberships: [],
    });
    prismaMock.account.update.mockResolvedValue({});

    const result = await login({ email: "ali@example.com", password: "supersecret1" });

    expect(result).toEqual({ pending: true });
    expect(prismaMock.account.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "acc1" },
        data: expect.objectContaining({ status: "PENDING", rejectionReason: null, approvedById: null, approvedAt: null }),
      })
    );
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
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      isSuperAdmin: false,
      account: { status: "ACTIVE" },
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

  it("rejects refresh for an account that's no longer ACTIVE", async () => {
    const token = signRefreshToken("u1");
    prismaMock.refreshToken.findUnique.mockResolvedValue({
      id: "rt1",
      tokenHash: hashToken(token),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 100000),
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1",
      isSuperAdmin: false,
      account: { status: "SUSPENDED" },
    });
    prismaMock.refreshToken.update.mockResolvedValue({});

    await expect(refresh(token)).rejects.toBeInstanceOf(ForbiddenError);
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
