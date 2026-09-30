import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createAuth } from "@/server/auth/auth";
import { testDb } from "./setup";

const BASE_URL = "http://localhost:3000";
const SECRET = "integration-test-auth-secret-0123456789";
const PASSWORD = "correct horse battery";

const auth = createAuth({ client: testDb, secret: SECRET, baseURL: BASE_URL, production: false });

const signUp = (email: string, extra: Record<string, unknown> = {}) =>
  auth.api.signUpEmail({ body: { email, password: PASSWORD, name: "Test", ...extra } });

/** Calls the real HTTP handler, as a browser would. */
function post(
  instance: ReturnType<typeof createAuth>,
  path: string,
  body: unknown,
  ip = "203.0.113.7",
) {
  return instance.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL, "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
}

describe("sign-up", () => {
  it("creates a USER with a hashed credential", async () => {
    const result = await signUp("new@example.test");
    const user = await testDb.user.findUniqueOrThrow({
      where: { id: result.user.id },
      include: { accounts: true },
    });
    expect(user).toMatchObject({ email: "new@example.test", role: "USER", emailVerified: false });
    expect(user.accounts).toHaveLength(1);
    expect(user.accounts[0]).toMatchObject({ providerId: "credential" });
    expect(user.accounts[0]!.password).toBeTruthy();
    expect(user.accounts[0]!.password).not.toContain(PASSWORD);
  });

  it("never lets a sign-up choose its role", async () => {
    await signUp("sneaky@example.test", { role: "ADMIN" }).catch(() => undefined);
    const user = await testDb.user.findUnique({ where: { email: "sneaky@example.test" } });
    // Either the request is rejected outright or the role is ignored — never ADMIN.
    expect(user?.role ?? "USER").toBe("USER");
  });

  it("rejects duplicate emails and short passwords", async () => {
    await signUp("dupe@example.test");
    await expect(signUp("dupe@example.test")).rejects.toThrow();
    await expect(
      auth.api.signUpEmail({
        body: { email: "short@example.test", password: "too-short", name: "" },
      }),
    ).rejects.toThrow();
    expect(await testDb.user.count()).toBe(1);
  });
});

describe("sign-in and sessions", () => {
  it("issues a session that resolves to the user and their role", async () => {
    await signUp("editor@example.test");
    await testDb.user.update({ where: { email: "editor@example.test" }, data: { role: "EDITOR" } });

    const response = await post(auth, "/sign-in/email", {
      email: "editor@example.test",
      password: PASSWORD,
    });
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toMatch(/better-auth\.session_token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookie!.split(";")[0]! }),
    });
    expect(session?.user).toMatchObject({ email: "editor@example.test", role: "EDITOR" });
  });

  it("rejects a wrong password without revealing whether the account exists", async () => {
    await signUp("real@example.test");
    const wrong = await post(auth, "/sign-in/email", {
      email: "real@example.test",
      password: "wrong password!",
    });
    const missing = await post(auth, "/sign-in/email", {
      email: "ghost@example.test",
      password: "wrong password!",
    });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect((await wrong.json()).message).toBe((await missing.json()).message);
  });

  it("rejects cross-site sign-in requests", async () => {
    await signUp("csrf@example.test");
    const response = await auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          cookie: "x=1",
        },
        body: JSON.stringify({ email: "csrf@example.test", password: PASSWORD }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("ends the session on sign-out", async () => {
    await signUp("bye@example.test");
    const signIn = await post(auth, "/sign-in/email", {
      email: "bye@example.test",
      password: PASSWORD,
    });
    const cookie = signIn.headers.get("set-cookie")!.split(";")[0]!;
    await auth.api.signOut({ headers: new Headers({ cookie }) });
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  });
});

describe("rate limiting", () => {
  it("blocks repeated sign-in attempts from one address, using shared database storage", async () => {
    const limited = createAuth({
      client: testDb,
      secret: SECRET,
      baseURL: BASE_URL,
      production: false,
      rateLimit: true,
    });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (
          await post(limited, "/sign-in/email", {
            email: "x@example.test",
            password: "nope nope nope",
          })
        ).status,
      );
    }
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses[5]).toBe(429);
    expect(await testDb.rateLimit.count()).toBeGreaterThan(0);

    // A different address is unaffected.
    expect(
      (
        await post(
          limited,
          "/sign-in/email",
          { email: "x@example.test", password: "nope" },
          "198.51.100.1",
        )
      ).status,
    ).toBe(401);
  });
});

describe("user:role script", () => {
  const run = (...args: string[]) =>
    execFileSync("npx", ["tsx", "--conditions=react-server", "scripts/set-role.ts", ...args], {
      env: { ...process.env },
      encoding: "utf8",
      stdio: "pipe",
    });

  it("promotes an existing account and audits it", async () => {
    await signUp("boss@example.test");
    expect(run("Boss@Example.test", "ADMIN")).toContain("USER → ADMIN");
    const user = await testDb.user.findUniqueOrThrow({ where: { email: "boss@example.test" } });
    expect(user.role).toBe("ADMIN");
    expect(
      await testDb.auditLog.findFirst({ where: { entityId: user.id, action: "user.set-role" } }),
    ).not.toBeNull();
  });

  it.each([
    [["nobody@example.test", "ADMIN"], "No account"],
    [["boss@example.test", "SUPERUSER"], "Usage"],
  ])("refuses %j", async (args, message) => {
    expect(() => run(...args)).toThrow(message);
  });
});
