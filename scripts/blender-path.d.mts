export function standardPaths(platform?: string, env?: Record<string, string | undefined>, list?: (dir: string) => string[]): string[];
export function findBlender(options?: {
  env?: Record<string, string | undefined>;
  platform?: string;
  exists?: (file: string) => boolean;
  list?: (dir: string) => string[];
}): string | undefined;
