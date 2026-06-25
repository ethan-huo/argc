import type { AnyCommand, Router, Schema } from './types';
export declare function showHelp(schema: Router, options: {
    name: string;
    version: string;
    description?: string;
    context?: Schema;
}): void;
export declare function renderNamespaceCommands(router: Router, prefix: string[]): string[];
export declare function showCommandHelp(command: AnyCommand, commandPath: string[], options: {
    name: string;
}): void;
