import type { Router } from './types';
import { type SchemaOptions } from './schema';
import { type SchemaSelectionResult } from './schema-selector';
export type SchemaExplorerOptions = {
    selectionDepth?: number | ((selector: string) => number);
    outlineDepth?: number;
    maxLines?: number;
};
export type SchemaExplorer = {
    select: (router: Router, selector: string) => SchemaSelectionResult;
    render: (router: Router, options: SchemaOptions) => string;
    outline: (router: Router) => string[];
    hint: (router: Router) => string | null;
    maxLines: number;
};
export declare function createDefaultSchemaExplorer(options?: SchemaExplorerOptions): SchemaExplorer;
