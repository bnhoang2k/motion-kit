import { describe, expect, it } from "vitest";
import { findBlender, standardPaths } from "../scripts/blender-path.mjs";

const none = () => false;
const only = (...files: string[]) => (file: string) => files.includes(file);

describe("findBlender", () => {
  it("takes BLENDER first, as given", () => {
    expect(findBlender({ env: { BLENDER: "/x/blender", PATH: "/usr/bin" }, platform: "linux", exists: none })).toBe("/x/blender");
  });

  it("takes the standard install path for the platform", () => {
    const mac = "/Applications/Blender.app/Contents/MacOS/Blender";
    expect(findBlender({ env: {}, platform: "darwin", exists: only(mac) })).toBe(mac);
    expect(findBlender({ env: {}, platform: "linux", exists: only("/snap/bin/blender") })).toBe("/snap/bin/blender");
  });

  it("takes the newest Windows install folder", () => {
    const list = () => ["Blender 3.6", "Blender 4.10", "Blender 4.2", "Other"];
    const env = { ProgramFiles: "D:\\Apps" };
    expect(standardPaths("win32", env, list)).toEqual([
      "D:\\Apps\\Blender Foundation\\Blender 4.10\\blender.exe",
      "D:\\Apps\\Blender Foundation\\Blender 4.2\\blender.exe",
      "D:\\Apps\\Blender Foundation\\Blender 3.6\\blender.exe",
    ]);
    expect(findBlender({ env, platform: "win32", list, exists: only("D:\\Apps\\Blender Foundation\\Blender 4.2\\blender.exe") }))
      .toBe("D:\\Apps\\Blender Foundation\\Blender 4.2\\blender.exe");
  });

  it("falls back to blender on PATH", () => {
    expect(findBlender({ env: { PATH: "/a:/b" }, platform: "linux", exists: only("/b/blender") })).toBe("/b/blender");
    expect(findBlender({ env: { Path: "C:\\a;C:\\b" }, platform: "win32", list: () => [], exists: only("C:\\b\\blender.exe") })).toBe("C:\\b\\blender.exe");
  });

  it("returns undefined when nothing is found", () => {
    expect(findBlender({ env: { PATH: "/a" }, platform: "linux", exists: none })).toBeUndefined();
    expect(findBlender({ env: {}, platform: "freebsd", exists: none })).toBeUndefined();
  });
});
