import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL = "postgresql://badges_user:Nico1001@localhost:5432/badges";
process.env.JWT_SECRET = "test-secret";

const { extractBearerToken } = await import("../src/auth.ts");
const { createApp } = await import("../src/app.ts");

test("extractBearerToken returns the token for valid bearer headers", () => {
  assert.equal(extractBearerToken("Bearer token-123"), "token-123");
});

test("extractBearerToken rejects malformed headers", () => {
  assert.equal(extractBearerToken("token-123"), null);
  assert.equal(extractBearerToken("Basic token-123"), null);
  assert.equal(extractBearerToken(undefined), null);
});

test("createApp serves health responses", async () => {
  const app = createApp();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok" });
  } finally {
    await app.close();
  }
});
