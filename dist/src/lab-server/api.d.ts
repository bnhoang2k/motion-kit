import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
type Next = (err?: unknown) => void;
/** The Lab's two routes as a connect-style handler. Save never commits; the user commits motion.json. */
export declare function labMiddleware(cwd: string): (req: IncomingMessage, res: ServerResponse, next: Next) => void;
export declare function labApi(cwd: string): Plugin;
export {};
