import type { HookErrorData, HookTransport } from './types';
export type HookDispatcher = {
    createCall: (path: string[], command: string) => HookCall;
    drain: () => Promise<void>;
};
export type HookCall = {
    callId: string;
    emit: (data: unknown) => void;
    error: (error: unknown) => void;
    end: (ok: boolean) => void;
};
export type HookDispatcherOptions = {
    app: string;
    hook?: false | HookTransport;
    hookUrl?: string;
    timeoutMs: number;
};
export declare function createUlid(now?: number): string;
export declare function sanitizeHookData(data: unknown): unknown;
export declare function formatHookError(error: unknown): HookErrorData;
export declare function createHookDispatcher(options: HookDispatcherOptions): HookDispatcher;
