import type { AnyCommand, Router, Schema } from './types';
export declare function normalizeArgName(name: string): string;
export declare function getArgInfo(args?: {
    name: string;
}[]): {
    names: Set<string>;
    display: Map<string, string>;
};
export declare function showHelp(options: {
    name: string;
    version: string;
    description?: string;
    globals?: Schema;
}, commandPath: string[], router: Router): void;
export declare function showValidationError(appName: string, commandPath: string[], command: AnyCommand, errorFields: Set<string>, errorMessages: Record<string, string>): void;
