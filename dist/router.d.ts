import type { Router } from './types';
export declare function getRouterChildren(router: Router): {
    [key: string]: Router;
};
export declare function findHandler(path: string[], handlers: Record<string, unknown>): ((opts: unknown) => Promise<void> | void) | null;
