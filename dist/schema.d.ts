import type { Router, Schema } from './types';
export type SchemaOptions = {
    name: string;
    description?: string;
    globals?: Schema;
};
type ParamInfo = {
    name: string;
    type: string;
    optional: boolean;
    default?: unknown;
    description?: string;
};
declare function extractInputParamsDetailed(schema: Schema): ParamInfo[];
export declare function getInputTypeHint(schema: Schema): string;
export { extractInputParamsDetailed, type ParamInfo };
export declare function generateSchema(schema: Router, options: SchemaOptions): string;
export declare function generateSchemaOutline(schema: Router, depth?: number): string[];
export declare function generateSchemaHintExample(schema: Router): string | null;
