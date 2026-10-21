import { describe, expect, it } from "vitest";
import type { InputSamples } from "../src/core/trace.ts";
import { cropBox, inputNote, pointerDown, sheetHtml, sheetTimes, timeLabel, withPoints } from "../src/gate/sheet.ts";

const DRAG: InputSamples = {
  kind: "pointer",
  samples: [
    [250, 640, 360, 1],
    [500, 700, 380, 1],
    [750, 760, 360, 0],
  ],
};
const SCROLL: InputSamples = {
  kind: "scroll",
  samples: [
    [250, 100],
    [300, 200],
  ],
};

describe("sheetTimes", () => {
  it("spaces the samples evenly from 0 to the span, both ends included", () => {
    expect(sheetTimes(3000, 4)).toEqual([0, 1000, 2000, 3000]);
    expect(sheetTimes(1000, 2)).toEqual([0, 1000]);
  });
});

describe("inputNote", () => {
  it("is empty with no input and before the input starts", () => {
    expect(inputNote(null, 500)).toBe("");
    expect(inputNote(DRAG, 100)).toBe("");
  });

  it("names the pointer state and position of the last sample at or before the time", () => {
    expect(inputNote(DRAG, 250)).toBe("pointer down 640, 360");
    expect(inputNote(DRAG, 600)).toBe("pointer down 700, 380");
    expect(inputNote(DRAG, 750)).toBe("pointer up 760, 360");
  });

  it("calls the pointer released after the last sample", () => {
    expect(inputNote(DRAG, 900)).toBe("released");
  });

  it("names the scroll position", () => {
    expect(inputNote(SCROLL, 260)).toBe("scrollY 100");
    expect(inputNote(SCROLL, 2000)).toBe("scrollY 200");
  });
});

describe("pointerDown", () => {
  it("is the pointer position while it is down, else null", () => {
    expect(pointerDown(DRAG, 100)).toBeNull();
    expect(pointerDown(DRAG, 600)).toEqual([700, 380]);
    expect(pointerDown(DRAG, 750)).toBeNull();
    expect(pointerDown(DRAG, 900)).toBeNull();
    expect(pointerDown(SCROLL, 260)).toBeNull();
  });
});

describe("sheetHtml", () => {
  it("labels every cell with its time and input, and marks a held pointer", () => {
    const html = sheetHtml({
      title: "page.html",
      subtitle: "8 frames",
      cells: [
        { ms: 0, note: "", src: "data:image/png;base64,AA", dot: null },
        { ms: 1250, note: "pointer down 640, 360", src: "data:image/png;base64,BB", dot: [640, 360] },
      ],
    });
    expect(html).toContain("0.00 s");
    expect(html).toContain("1.25 s");
    expect(html).toContain("pointer down 640, 360");
    expect(html.match(/class="dot"/g)).toHaveLength(1);
  });

  it("escapes the title", () => {
    expect(sheetHtml({ title: "<a&b>", subtitle: "", cells: [] })).toContain("&lt;a&amp;b&gt;");
  });
});

describe("cropBox", () => {
  const VP: [number, number] = [1280, 720];

  it("pads the changing box and keeps it inside the page", () => {
    expect(cropBox({ x: 600, y: 300, w: 200, h: 160 }, VP)).toEqual({ x: 576, y: 276, w: 248, h: 208 });
    expect(cropBox({ x: 0, y: 0, w: 200, h: 160 }, VP)).toEqual({ x: 0, y: 0, w: 248, h: 208 });
  });

  it("grows a tiny box to the smallest crop around its center", () => {
    expect(cropBox({ x: 640, y: 360, w: 2, h: 2 }, VP)).toEqual({ x: 561, y: 301, w: 160, h: 120 });
  });

  it("is null when nothing changed or the crop keeps most of the page", () => {
    expect(cropBox(null, VP)).toBeNull();
    expect(cropBox({ x: 100, y: 50, w: 1000, h: 600 }, VP)).toBeNull();
  });
});

describe("sheetHtml crop", () => {
  it("shifts the shot and the pointer ring by the crop", () => {
    const html = sheetHtml({
      title: "p",
      subtitle: "",
      viewport: [1280, 720],
      crop: { x: 100, y: 50, w: 360, h: 180 },
      cells: [{ ms: 0, note: "", src: "data:,", dot: [280, 140] }],
    });
    // The crop is 360 px wide, so it shows at 1:1.
    expect(html).toContain("left:-100.0px;top:-50.0px");
    expect(html).toContain('class="dot" style="left:180.0px;top:90.0px"');
  });
});

describe("timeLabel", () => {
  it("uses seconds, or ms when frames are under 50 ms apart so no two labels match", () => {
    expect(timeLabel(1250, 100)).toBe("1.25 s");
    expect(timeLabel(10, 10)).toBe("10.0 ms");
    expect(timeLabel(2.17, 2.17)).toBe("2.2 ms");
  });
});

describe("withPoints", () => {
  it("grows the box to hold every held pointer, and keeps null as null", () => {
    expect(withPoints({ x: 100, y: 100, w: 50, h: 50 }, [[300, 80]])).toEqual({ x: 100, y: 80, w: 200, h: 70 });
    expect(withPoints(null, [[300, 80]])).toBeNull();
  });
});

describe("sheetHtml height", () => {
  it("shrinks tall cells so 24 frames stay under 2000 px", () => {
    const cells = Array.from({ length: 24 }, (_, i) => ({ ms: i * 100, note: "", src: "data:,", dot: null }));
    const html = sheetHtml({ title: "p", subtitle: "", cells, viewport: [1280, 720], crop: { x: 450, y: 0, w: 380, h: 720 } });
    const h = Number(/\.shot\{[^}]*height:(\d+)px/.exec(html)![1]);
    // 6 rows of cells, captions and gaps, plus the header and padding.
    expect(32 + 56 + 6 * (h + 24) + 5 * 12).toBeLessThanOrEqual(2000);
    expect(h).toBeLessThan(360);
  });
});
