import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { redactPath, requestLog } from "./request-log.js";

const TOKEN = "AbC_def-123456789012345678901234567890123456";

describe("request log", () => {
  it("never writes status-page tokens", async () => {
    const lines: string[] = [];
    const app = new Hono()
      .use(requestLog((l) => lines.push(l)))
      .get("/api/requests/by-token/:token", (c) => c.json({}))
      .post("/api/requests/by-token/:token/cancel", (c) => c.json({}, 409));
    await app.request(`/api/requests/by-token/${TOKEN}?x=${TOKEN}`);
    await app.request(`/api/requests/by-token/${TOKEN}/cancel`, { method: "POST" });

    expect(lines).toEqual([
      expect.stringMatching(/^GET \/api\/requests\/by-token\/\[token\] 200 \d+ms$/),
      expect.stringMatching(/^POST \/api\/requests\/by-token\/\[token\]\/cancel 409 \d+ms$/),
    ]);
    expect(lines.join("\n")).not.toContain(TOKEN);
  });

  it("leaves other paths alone", () => {
    expect(redactPath("/api/admin/requests/01K0000")).toBe("/api/admin/requests/01K0000");
  });
});
