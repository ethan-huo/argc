import type { Writable } from 'node:stream';
export type ErrorIssue = {
    at?: string;
    message: string;
};
type FrameworkErrorCode = 'INVALID_INPUT' | 'INVALID_CONTEXT' | 'UNKNOWN_COMMAND' | 'NOT_A_COMMAND' | 'BAD_PATH' | 'BAD_SELECTOR' | 'BAD_INPUT_JSON' | 'TWO_INPUTS' | 'RUN_DISABLED' | 'RUNTIME_ERROR';
export type ErrorEnvelope = {
    error: FrameworkErrorCode;
    [key: string]: unknown;
} | {
    error: 'DOMAIN_ERROR';
    code: string;
    [key: string]: unknown;
};
export declare class ArgcError extends Error {
    envelope: ErrorEnvelope;
    constructor(envelope: ErrorEnvelope);
}
export declare function domainError(code: string, detail: string, fields?: Record<string, unknown>): Error;
export declare function normalizeValue(value: unknown): unknown;
export declare function renderResult(value: unknown, mode?: 'yaml' | 'json'): string;
export declare function renderError(envelope: ErrorEnvelope): string;
export declare function writeOutput(stream: Writable, value: string): Promise<void>;
export declare function withStdoutRerouted<T>(fn: () => Promise<T>): Promise<T>;
export declare function formatRuntimeError(error: unknown): string;
export {};
