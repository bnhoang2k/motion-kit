export interface KnobSpring {
    visualDuration: number;
    bounce: number;
}
export interface KnobValue {
    value: number | KnobSpring;
    bar: string | null;
}
export interface KnobBaseInfo {
    base: KnobValue;
    bars: KnobValue[];
}
/** Base value and every bar's value, by "kind.field". */
export declare const KNOB_VALUES: Record<string, KnobBaseInfo>;
