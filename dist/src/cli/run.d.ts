export interface CliIo {
    cwd: string;
    out(s: string): void;
    err(s: string): void;
    /** Returns undefined when the file does not exist. */
    read(path: string): string | undefined;
    write(path: string, data: string): void;
}
/** Exit codes: 0 ok, 1 invalid config, 2 usage or file error. */
export declare function run(args: string[], io: CliIo): number;
