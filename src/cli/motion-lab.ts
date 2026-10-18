#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { labApi } from "../lab-server/api.ts";

// Built layout: dist/src/cli/motion-lab.js serves dist/lab/.
const root = fileURLToPath(new URL("../../lab/", import.meta.url));
const cwd = process.cwd();

const server = await createServer({
  root,
  configFile: false,
  logLevel: "info",
  server: { open: true, fs: { allow: [root, cwd, path.join(cwd, "node_modules")] } },
  plugins: [labApi(cwd)],
});
await server.listen();
server.printUrls();
