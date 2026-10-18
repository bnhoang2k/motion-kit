import type { Feel, MoveName, Reduced } from "../src/core/types.ts";
import type { EditPath } from "../src/lab-server/state.ts";
export interface EditorState {
    feelName: string;
    feel: Feel;
    move: MoveName;
    editable: boolean;
    motionPath: string;
}
/** Sets one value on the feel. The caller updates `s.feel` in place before it returns. */
export type OnEdit = (path: EditPath, value: number | Reduced) => void;
/** Sliders for one feel and move. After every edit it redraws from `s.feel`, so a control never shows a value the config does not hold. */
export declare function mountEditor(root: HTMLElement, s: EditorState, onEdit: OnEdit, onCopy: (text: string) => void): void;
