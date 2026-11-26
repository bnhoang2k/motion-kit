import { existsSync } from "node:fs";
import path from "node:path";
import { MotionConfigError, resolve } from "../core/merge.js";
import { motionPath, readOverrides, writeOverrides } from "./save.js";
const MOMENT_FILES = ["motion-lab.moments.ts", "motion-lab.moments.js"];
function send(res, status, body) {
    if (res.headersSent || res.writableEnded || res.destroyed)
        return;
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
}
async function body(req) {
    let s = "";
    for await (const chunk of req)
        s += String(chunk);
    return s;
}
/** Pulls `overrides` (the new motion.json contents) out of a POST body. Returns problems instead of throwing. */
function readBody(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch (e) {
        return { problems: [`body is not valid JSON: ${e.message}`] };
    }
    if (typeof parsed !== "object" || parsed === null || !Object.hasOwn(parsed, "overrides")) {
        return { problems: ['body: expected {"overrides": <motion.json contents>}'] };
    }
    const overrides = parsed.overrides;
    if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) {
        return { problems: ["overrides: must be a JSON object"] };
    }
    return { overrides: overrides };
}
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** True when the request has no Origin header, or its Origin is this machine. */
function localOrigin(req) {
    const origin = req.headers.origin;
    if (origin === undefined)
        return true;
    try {
        return LOCAL_HOSTS.has(new URL(origin).hostname);
    }
    catch {
        return false;
    }
}
const isJson = (req) => (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase() === "application/json";
/** The Lab's two routes as a connect-style handler. Save never commits; the user commits motion.json. */
export function labMiddleware(cwd) {
    return (req, res, next) => {
        if (req.url === "/api/project" && req.method === "GET") {
            try {
                const moments = MOMENT_FILES.map((f) => path.join(cwd, f)).find((p) => existsSync(p));
                send(res, 200, {
                    name: path.basename(cwd),
                    motionPath: motionPath(cwd),
                    overrides: readOverrides(cwd),
                    momentsUrl: moments ? `/@fs${moments}` : null,
                });
            }
            catch (e) {
                send(res, 500, { ok: false, problems: [e.message] });
            }
            return;
        }
        if (req.url === "/api/save" && req.method === "POST") {
            // Any web page can POST to localhost. Refuse other origins and non-JSON bodies (a form cannot send JSON).
            if (!localOrigin(req))
                return send(res, 403, { ok: false, problems: ["origin not allowed"] });
            if (!isJson(req))
                return send(res, 415, { ok: false, problems: ["content-type must be application/json"] });
            body(req).then((text) => {
                try {
                    const read = readBody(text);
                    if ("problems" in read) {
                        send(res, 400, { ok: false, problems: read.problems });
                        return;
                    }
                    // The Lab sends only overrides, so what is written is exactly what the person set. Check before writing.
                    resolve(read.overrides, motionPath(cwd));
                    send(res, 200, { ok: true, path: writeOverrides(cwd, read.overrides), overrides: read.overrides });
                }
                catch (e) {
                    const problems = e instanceof MotionConfigError ? e.problems : [e.message];
                    send(res, 400, { ok: false, problems });
                }
            }, 
            // The client closed the socket mid-body. Nothing was parsed, so nothing is written.
            () => send(res, 400, { ok: false, problems: ["request aborted"] }));
            return;
        }
        next();
    };
}
export function labApi(cwd) {
    return {
        name: "motion-lab-api",
        configureServer(server) {
            server.middlewares.use(labMiddleware(cwd));
        },
    };
}
