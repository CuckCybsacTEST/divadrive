import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapApp } from "../src/index.js";

test("request observability adds x-request-id to responses", async (t) => {
  const app = await bootstrapApp();
  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "GET",
    url: "/health"
  });

  assert.equal(response.statusCode, 200);
  assert.ok(response.headers["x-request-id"]);
});
