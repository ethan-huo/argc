import type { Router } from './types';
export type SelectorStep = {
    type: 'key';
    name: string;
} | {
    type: 'wildcard';
} | {
    type: 'set';
    names: string[];
} | {
    type: 'recursive';
};
export type SelectorMatch = {
    path: string[];
    node: Router;
};
export type SchemaSelectionOptions = {
    depth?: number;
};
export type SchemaSelectionResult = {
    selector: string;
    steps: SelectorStep[];
    matches: SelectorMatch[];
    schema: Router;
    empty: boolean;
};
export declare function parseSchemaSelector(input: string): SelectorStep[];
export declare function matchSchemaSelector(schema: Router, steps: SelectorStep[]): SelectorMatch[];
export declare function buildSchemaSubset(schema: Router, matches: SelectorMatch[], depth: number): Router;
export declare function selectSchema(schema: Router, selector: string, options?: SchemaSelectionOptions): SchemaSelectionResult;
export declare function sliceRouter(router: Router, depth: number): Router;
