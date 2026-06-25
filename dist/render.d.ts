export type ErrorIssue = {
    at?: string;
    message: string;
};
export type ErrorEnvelope = {
    error: 'INVALID_INPUT' | 'INVALID_CONTEXT' | 'UNKNOWN_COMMAND' | 'NOT_A_COMMAND' | 'BAD_PATH' | 'BAD_SELECTOR' | 'BAD_INPUT_JSON' | 'TWO_INPUTS' | 'RUN_DISABLED' | 'RUNTIME_ERROR';
    [key: string]: unknown;
};
export declare class ArgcError extends Error {
    envelope: ErrorEnvelope;
    constructor(envelope: ErrorEnvelope);
}
export declare function normalizeValue(value: unknown): unknown;
export declare function renderResult(value: unknown, mode?: 'yaml' | 'json'): string;
export declare function renderError(envelope: ErrorEnvelope): string;
export declare function withStdoutRerouted<T>(fn: () => Promise<T>): Promise<T>;
export declare function formatRuntimeError(error: unknown): string;
