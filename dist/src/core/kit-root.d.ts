/**
 * The kit's own folder: the nearest folder above this file whose package.json is named
 * motion-kit. It is the same from src/ and from dist/, and in an installed copy. The CLI and the
 * kind gate read the kit's files (bars/, kinds/) from here, never from the working folder.
 */
export declare function kitRoot(): string;
/** The text of a file, or undefined when the path is missing or is not a file (a folder). */
export declare function readTextFile(p: string): string | undefined;
