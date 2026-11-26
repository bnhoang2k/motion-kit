export interface IndexBar {
  slug: string;
  kinds: string[];
  moments: string[];
  rung: number | [number, number];
  feel: string;
  fits: string;
  wrongFor: string;
  superseded?: string;
}
export interface Moment {
  name: string;
  meaning: string;
}
export const MAX_PER_MOMENT: number;
export const HEADER: string;
export const EMPTY: string;
export const SHIPPED_FILES: string[];
export function readBars(root?: string): IndexBar[];
export function readMoments(root?: string): Moment[];
export function render(bars: IndexBar[], moments: Moment[]): string;
export function listedSlugs(text: string): string[];
export function missingBarFiles(root?: string): string[];
