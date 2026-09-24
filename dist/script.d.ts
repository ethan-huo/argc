import type { HookDispatcher } from './hook';
import type { Router } from './types';
export declare function readStdin(): Promise<string>;
type ScriptFn = (input?: unknown) => Promise<unknown>;
type ScriptHandlers = ScriptFn | {
    [key: string]: ScriptHandlers;
};
export type ScriptAPI = {
    handlers: ScriptHandlers;
    call: Record<string, ScriptFn>;
    context: unknown;
    args: string[];
    raw: string[];
};
type RunSource = {
    kind: 'stdin';
} | {
    kind: 'inline';
    code: string;
} | {
    kind: 'module';
    path: string;
};
export type ScriptRunOptions = {
    source: RunSource;
    json: boolean;
    args: string[];
    raw: string[];
    context: unknown;
    appName: string;
};
export declare function parseRunSource(token: string | undefined): RunSource;
export declare function runScriptMode(schema: Router, handlers: Record<string, unknown>, hookDispatcher: HookDispatcher, options: ScriptRunOptions): Promise<void>;
export declare function readTextInput(path: string): Promise<string>;
export {};
