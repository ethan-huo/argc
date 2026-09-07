export type InputSource = {
    kind: 'omitted';
} | {
    kind: 'inline';
    value: string;
} | {
    kind: 'file';
    path: string;
} | {
    kind: 'stdin';
} | {
    kind: 'object';
    value: Record<string, unknown>;
};
export type ParsedArgs = {
    raw: string[];
};
export declare function parseArgv(argv: string[]): ParsedArgs;
export declare function parseInputSource(token: string | undefined): InputSource;
