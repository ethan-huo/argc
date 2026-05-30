import type { HookDispatcher } from './hook';
import type { parseArgv } from './parser';
import type { Router, Schema } from './types';
export declare function expandHome(path: string): string;
export declare function readStdin(): Promise<string>;
export declare function formatRuntimeError(error: unknown): string;
export declare function runScriptMode(schema: Router, options: {
    globals?: Schema;
    context?: (globals: unknown) => unknown | Promise<unknown>;
}, handlers: Record<string, unknown>, parsed: ReturnType<typeof parseArgv>, appName: string, hookDispatcher: HookDispatcher): Promise<void>;
