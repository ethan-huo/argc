type ColorStream = {
    isTTY?: boolean;
};
export declare function renderOkfMarkdown(frontmatter: Record<string, unknown>, body: string, stream?: ColorStream): string;
export declare function colorizeOkfMarkdown(source: string, stream?: ColorStream): string;
export declare function colorizeSchema(source: string, stream?: ColorStream): string;
export declare function colorizeError(source: string, stream?: ColorStream): string;
export {};
