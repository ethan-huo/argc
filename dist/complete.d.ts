import type { Router, Schema } from './types';
export type CompletionContext = {
    words: string[];
    current: number;
};
export type SupportedShell = 'bash' | 'zsh' | 'fish';
export declare function complete(router: Router, globals: Schema | undefined, ctx: CompletionContext): string[];
export declare function detectCurrentShell(): SupportedShell | null;
export declare function getCompletionInstallPath(shell: SupportedShell, programName: string): string | null;
export declare function installCompletionScript(shell: SupportedShell, programName: string): Promise<string>;
export declare function getCompletionReloadHint(shell: SupportedShell, path: string): string;
export declare function generateCompletionScript(shell: string, programName: string): string | null;
