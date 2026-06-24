import type { AnyCommand } from './types';
import { type InputSource } from './parser';
export type HumanParseResult = {
    input: Record<string, unknown>;
    context?: InputSource;
};
type HumanParseOptions = {
    commandPath: string[];
};
export declare function parseHumanArgs(command: AnyCommand, argv: string[], options: HumanParseOptions): HumanParseResult;
export {};
