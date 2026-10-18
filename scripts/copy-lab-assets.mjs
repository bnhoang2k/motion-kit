import { cpSync, existsSync, mkdirSync } from "node:fs";

// The Lab's HTML, CSS and sample clips are not TypeScript, so tsc does not copy them.
mkdirSync("dist/lab", { recursive: true });
for (const f of ["index.html", "style.css"]) {
  if (existsSync(`lab/${f}`)) cpSync(`lab/${f}`, `dist/lab/${f}`);
}
if (existsSync("lab/assets")) cpSync("lab/assets", "dist/lab/assets", { recursive: true });
