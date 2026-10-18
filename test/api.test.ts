import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "../src/core/merge.ts";
import type { Overrides } from "../src/core/types.ts";
import { adopt, createLabState, edit, overrides } from "../src/lab-server/state.ts";
import { labMiddleware } from "../src/lab-server/api.ts";

let server: Server | undefined;
afterEach(async () => {
  await new Promise((done) => (server ? server.close(done) : done(undefined)));
  server = undefined;
});

async function start(): Promise<{ cwd: string; port: number; file: string }> {
  const cwd = mkdtempSync(path.join(tmpdir(), "motion-api-"));
  const mw = labMiddleware(cwd);
  server = createServer((req, res) => mw(req, res, () => {
    res.statusCode = 404;
    res.end();
  }));
  await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
  return { cwd, port: (server!.address() as AddressInfo).port, file: path.join(cwd, "motion.json") };
}

const post = (port: number, headers: Record<string, string>, body: string) =>
  fetch(`http://127.0.0.1:${port}/api/save`, { method: "POST", headers, body });
const JSON_TYPE = { "content-type": "application/json" };

describe("POST /api/save", () => {
  const calmTap = { feels: { calm: { moves: { tap: { bounce: 0.05 } } } } };

  it("writes the overrides it is sent to motion.json", async () => {
    const { port, file } = await start();
    const res = await post(port, JSON_TYPE, JSON.stringify({ overrides: calmTap }));
    expect(res.status).toBe(200);
    expect(readFileSync(file, "utf8")).toBe(`${JSON.stringify(calmTap, null, 2)}\n`);
  });

  it("returns ok, the path and the overrides it wrote", async () => {
    const { port, file } = await start();
    const out = (await (await post(port, JSON_TYPE, JSON.stringify({ overrides: calmTap }))).json()) as { ok: boolean; path: string; overrides: unknown };
    expect(out).toEqual({ ok: true, path: file, overrides: calmTap });
    expect(out.overrides).toEqual(JSON.parse(readFileSync(file, "utf8")));
  });

  it("a parent drag, then Save twice, leaves the child inherited and motion.json byte-identical", async () => {
    const { port, file } = await start();
    const existing = { feels: { "demo-playful": { extends: "whimsical", stagger: 0.07 } } };
    writeFileSync(file, `${JSON.stringify(existing, null, 2)}\n`);
    const s = createLabState(existing);
    for (const v of [0.1, 0.2, 0.3]) edit(s, "whimsical", ["moves", "tap", "bounce"], v);
    const saveOnce = async () => {
      const res = await post(port, JSON_TYPE, JSON.stringify({ overrides: overrides(s) }));
      expect(res.status).toBe(200);
      adopt(s, ((await res.json()) as { overrides: Overrides }).overrides);
      return readFileSync(file, "utf8");
    };
    const first = await saveOnce();
    expect(JSON.parse(first).feels["demo-playful"]).toEqual({ extends: "whimsical", stagger: 0.07 });
    expect(resolve(JSON.parse(first)).feels["demo-playful"]!.moves.tap.bounce).toBe(0.3);
    expect(await saveOnce()).toBe(first);
  });

  it("refuses overrides with the wrong shape with 400 and writes nothing", async () => {
    const { port, file } = await start();
    for (const overrides of [{ feels: [] }, { feels: { calm: { moves: { tap: { bouce: 0.3 } } } } }, { feels: { calm: null } }]) {
      const res = await post(port, JSON_TYPE, JSON.stringify({ overrides }));
      expect(res.status).toBe(400);
      expect(existsSync(file)).toBe(false);
    }
  });

  it("accepts a charset on the content type", async () => {
    const { port } = await start();
    const res = await post(port, { "content-type": "application/json; charset=utf-8" }, JSON.stringify({ overrides: {} }));
    expect(res.status).toBe(200);
  });

  it("rejects a body that is not application/json with 415 and writes nothing", async () => {
    const { port, file } = await start();
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const res = await post(port, { "content-type": type }, JSON.stringify({ overrides: {} }));
      expect(res.status).toBe(415);
    }
    const none = await fetch(`http://127.0.0.1:${port}/api/save`, { method: "POST", body: new Blob([JSON.stringify({ overrides: {} })]) });
    expect(none.status).toBe(415);
    expect(existsSync(file)).toBe(false);
  });

  it("rejects a foreign Origin with 403 and writes nothing", async () => {
    const { port, file } = await start();
    for (const origin of ["https://evil.example", "http://localhost.evil.example", "null"]) {
      const res = await post(port, { ...JSON_TYPE, origin }, JSON.stringify({ overrides: {} }));
      expect(res.status).toBe(403);
    }
    expect(existsSync(file)).toBe(false);
  });

  it("allows localhost, 127.0.0.1 and [::1] origins", async () => {
    const { port } = await start();
    for (const origin of ["http://localhost:5173", "http://127.0.0.1:5173", "http://[::1]:5173"]) {
      const res = await post(port, { ...JSON_TYPE, origin }, JSON.stringify({ overrides: {} }));
      expect(res.status).toBe(200);
    }
  });

  it("returns 400 with problems for bad overrides and leaves motion.json as it was", async () => {
    const { port, file } = await start();
    const before = `${JSON.stringify(calmTap, null, 2)}\n`;
    writeFileSync(file, before);
    const bodies = [
      JSON.stringify({ overrides: { feels: { calm: { stagger: 9 } } } }),
      JSON.stringify({ overrides: { feels: { child: { extends: "nope" } } } }),
      JSON.stringify({ overrides: [] }),
      JSON.stringify({ overrides: null }),
      JSON.stringify({ edited: resolve() }),
      "xx",
    ];
    for (const b of bodies) {
      const res = await post(port, JSON_TYPE, b);
      expect(res.status, b).toBe(400);
      const out = (await res.json()) as { ok: boolean; problems: string[] };
      expect(out.ok).toBe(false);
      expect(out.problems.length).toBeGreaterThan(0);
    }
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("survives a client that closes the socket mid-body, writes nothing, and keeps serving", async () => {
    const { port, file } = await start();
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    await new Promise<void>((done) => {
      const sock = net.connect(port, "127.0.0.1", () => {
        sock.write("POST /api/save HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 5000\r\n\r\n{\"overrides\":");
        setTimeout(() => {
          sock.resetAndDestroy();
          done();
        }, 50);
      });
    });
    await new Promise((r) => setTimeout(r, 150));
    process.off("unhandledRejection", onUnhandled);
    expect(unhandled).toEqual([]);
    expect(existsSync(file)).toBe(false);
    const res = await fetch(`http://127.0.0.1:${port}/api/project`);
    expect(res.status).toBe(200);
  });
});
