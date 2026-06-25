import type { AnyCommand, Router, Schema } from './types';
export type SchemaOptions = {
    name: string;
    description?: string;
    context?: Schema;
};
type JSONSchema = Record<string, unknown>;
export type ParamInfo = {
    name: string;
    type: string;
    optional: boolean;
    default?: unknown;
    description?: string;
};
export type FieldKind = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'unknown';
export type FieldDescriptor = {
    name: string;
    required: boolean;
    kind: FieldKind;
    item?: FieldDescriptor;
    enum?: unknown[];
    default?: unknown;
    description?: string;
    rawSchema: JSONSchema;
};
export declare function isValidIdentifier(name: string): boolean;
export declare function extractCliInputParamsDetailed(schema: Schema): ParamInfo[];
export declare function extractInputFieldDescriptors(schema: Schema | undefined): FieldDescriptor[];
export declare function extractOutputParamsDetailed(schema: Schema): ParamInfo[];
export declare function getInputTypeHint(schema: Schema): string;
export declare function buildCommandInputExample(command: AnyCommand): string;
export declare function buildSurfaceExamples(schema: Router, options: SchemaOptions): string[];
export declare function generateSchema(schema: Router, options: SchemaOptions): string;
export declare function countSchemaCommands(schema: Router): number;
export declare function generateSchemaOutline(schema: Router, depth?: number): string[];
export declare function generateSchemaHintExample(schema: Router): string | null;
export {};
