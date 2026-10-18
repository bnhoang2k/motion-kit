export interface DialEntry {
  knob: string;
  value: number | { visualDuration: number; bounce: number };
  unit: string;
  bar: string;
  path: string | string[];
  row: string;
  base?: boolean;
  from?: Record<string, number>;
  convert?: string;
}
export const HEADER: string;
export function readDials(root?: string): DialEntry[];
export function clean<T extends number | Record<string, number>>(value: T): T;
export function render(dials: DialEntry[]): string;
