export declare const ansi: {
    readonly black: '\u001B[30m';
    readonly red: '\u001B[31m';
    readonly green: '\u001B[32m';
    readonly yellow: '\u001B[33m';
    readonly blue: '\u001B[34m';
    readonly magenta: '\u001B[35m';
    readonly cyan: '\u001B[36m';
    readonly white: '\u001B[37m';
    readonly gray: '\u001B[90m';
    readonly bold: '\u001B[1m';
    readonly dim: '\u001B[2m';
    readonly italic: '\u001B[3m';
    readonly underline: '\u001B[4m';
    readonly inverse: '\u001B[7m';
    readonly strikethrough: '\u001B[9m';
};
export declare function formatAnsi(code: string, value: string, enabled: boolean): string;
/**
 * Terminal formatting utilities.
 *
 * @example
 * 	;```ts
 * 	import { fmt } from 'argc/terminal'
 *
 * 	console.log(fmt.success('Done!')) // ✓ Done!
 * 	console.log(fmt.error('Failed')) // ✗ Failed
 * 	console.log(fmt.red('danger')) // red text
 * 	```
 */
export declare const fmt: {
    black: (s: string) => string;
    red: (s: string) => string;
    green: (s: string) => string;
    yellow: (s: string) => string;
    blue: (s: string) => string;
    magenta: (s: string) => string;
    cyan: (s: string) => string;
    white: (s: string) => string;
    gray: (s: string) => string;
    bold: (s: string) => string;
    dim: (s: string) => string;
    italic: (s: string) => string;
    underline: (s: string) => string;
    inverse: (s: string) => string;
    strikethrough: (s: string) => string;
    isColorSupported: boolean;
    success: (s: string) => string;
    error: (s: string) => string;
    warn: (s: string) => string;
    info: (s: string) => string;
    command: (s: string) => string;
    arg: (s: string) => string;
    option: (s: string) => string;
};
/**
 * Get visible width of string (excluding ANSI escape codes, handling wide
 * chars)
 */
export declare function visibleWidth(str: string): number;
/** Pad string to specified visible width */
export declare function padEnd(str: string, width: number): string;
export type TableColumn = {
    key: string;
    label: string;
    width?: number;
};
export type TableRow = Record<string, string>;
/**
 * Print a table with proper ANSI color support. Unlike console.table, this
 * correctly aligns columns with colored text.
 *
 * @example
 * 	;```ts
 * 	import { printTable, fmt } from 'argc/terminal'
 *
 * 	printTable(
 * 		[
 * 			{ key: 'name', label: 'NAME' },
 * 			{ key: 'status', label: 'STATUS' },
 * 		],
 * 		[{ name: 'foo', status: fmt.green('ok') }],
 * 	)
 * 	```
 */
export declare function printTable(columns: TableColumn[], rows: TableRow[]): void;
