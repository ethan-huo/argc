export type ParsedArgs = {
    flags: Record<string, unknown>;
    positionals: string[];
    raw: string[];
};
export declare function parseArgv(argv: string[]): ParsedArgs;
