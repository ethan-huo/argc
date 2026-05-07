type JsonPrimitive = string | number | boolean | null;
type JsonObject = {
    [key: string]: JsonValue;
};
type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
type DirectivePayload = Record<string, JsonValue>;
type DirectiveEncodeInput = {
    type: string;
} & Record<string, JsonValue | undefined>;
type DirectiveObject<TType extends string = string, TPayload extends DirectivePayload = DirectivePayload> = {
    type: TType;
} & TPayload;
type ImageDirective = DirectiveObject<'image', {
    url: string;
    mime?: string;
    filename?: string;
    width?: number;
    height?: number;
    size?: number;
    alt?: string;
}>;
type VideoDirective = DirectiveObject<'video', {
    url: string;
    mime?: string;
    filename?: string;
    width?: number;
    height?: number;
    duration?: number;
    size?: number;
    poster?: string;
}>;
type AudioDirective = DirectiveObject<'audio', {
    url: string;
    mime?: string;
    filename?: string;
    duration?: number;
    size?: number;
}>;
type FileDirective = DirectiveObject<'file', {
    url: string;
    mime?: string;
    filename?: string;
    size?: number;
}>;
type ContentDirective = ImageDirective | VideoDirective | AudioDirective | FileDirective;
type DirectiveSpan<TDirective = DirectiveObject> = {
    directive: TDirective;
    raw: string;
    range: {
        start: number;
        end: number;
    };
};
type DirectiveHydratableValue = JsonValue | {
    [key: string]: DirectiveHydratableValue;
} | DirectiveHydratableValue[];
type DirectiveHydratedValue<TDirective = DirectiveObject> = TDirective | JsonPrimitive | DirectiveHydratedValue<TDirective>[] | {
    [key: string]: DirectiveHydratedValue<TDirective>;
};
type DirectiveHydrateOptions<TDirective = DirectiveObject> = {
    map?: (directive: DirectiveObject) => TDirective;
};
declare function encodeDirective(value: DirectiveEncodeInput): string;
declare function decodeDirective(text: string): DirectiveObject | null;
declare function scanDirectives(text: string): DirectiveSpan[];
declare function hydrateDirectives<TDirective = DirectiveObject>(value: DirectiveHydratableValue, options?: DirectiveHydrateOptions<TDirective>): DirectiveHydratedValue<TDirective>;
declare function isDirective(value: unknown): value is DirectiveObject;
declare function isContentDirective(value: unknown): value is ContentDirective;
declare const directive: {
    encode: typeof encodeDirective;
    decode: typeof decodeDirective;
    scan: typeof scanDirectives;
    hydrate: typeof hydrateDirectives;
    is: typeof isDirective;
    isContent: typeof isContentDirective;
};
export { directive, type AudioDirective, type ContentDirective, type DirectiveEncodeInput, type DirectiveHydratableValue, type DirectiveHydratedValue, type DirectiveHydrateOptions, type DirectiveObject, type DirectivePayload, type DirectiveSpan, type FileDirective, type ImageDirective, type JsonObject, type JsonPrimitive, type JsonValue, type VideoDirective, };
