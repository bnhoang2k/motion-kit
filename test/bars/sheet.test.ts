import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser } from "../../src/gate/harness.ts";
import { frameSheet } from "../../src/gate/sheet.ts";

const PAGES = path.resolve(import.meta.dirname, "../fixtures/gate-pages");

/** The width and height in a PNG's IHDR chunk. */
function pngSize(png: Uint8Array): [number, number] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

afterAll(async () => {
  await closeBrowser();
});

describe("frameSheet", () => {
  it("draws a live page at evenly spaced times as one PNG, with the gate's input", async () => {
    const sheet = await frameSheet(path.join(PAGES, "kinds/live-good.html"), { samples: 8 });
    expect([...sheet.png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(sheet.times).toHaveLength(8);
    expect(sheet.times[0]).toBe(0);
    expect(sheet.note).toMatch(/^pointer input from \d+ to \d+ ms$/);
    const [w, h] = pngSize(sheet.png);
    // Four columns, two rows: wider than tall, and under the 2000 px an agent's image read allows.
    expect(w).toBeGreaterThan(h);
    expect(Math.max(w, h)).toBeLessThanOrEqual(2000);
  });

  it("names a page with no input", async () => {
    const sheet = await frameSheet(path.join(PAGES, "kinds/idle-good.html"), { samples: 4, toMs: 6000 });
    expect(sheet.times).toEqual([0, 2000, 4000, 6000]);
    expect(sheet.note).toBe("no input");
  });

  it("throws on a page with no clock hook", async () => {
    await expect(frameSheet(path.join(PAGES, "no-hook.html"), { samples: 4 })).rejects.toThrow(/window\.__seek/);
  });
});
