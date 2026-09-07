export type TerminalStream = {
    isTTY?: boolean;
};
/**
 * Add light terminal styling while preserving the Markdown source verbatim
 * whenever output is captured.
 */
export declare function renderMarkdown(source: string, stream?: TerminalStream): string;
export declare function renderOkfMarkdown(frontmatter: Record<string, unknown>, body: string, stream?: TerminalStream): string;
export declare function colorizeOkfMarkdown(source: string, stream?: TerminalStream): string;
export declare function colorizeSchema(source: string, stream?: TerminalStream): string;
export declare function colorizeError(source: string, stream?: TerminalStream): string;
