type PrimitiveDirectiveAttr = string | number | boolean;
type DirectiveAttrs = Record<string, PrimitiveDirectiveAttr | null | undefined>;
type DirectiveToken = {
    kind: 'directive';
    name: string;
    attrs: Record<string, PrimitiveDirectiveAttr>;
    raw: string;
    range?: {
        start: number;
        end: number;
    };
};
type ImageContent = {
    type: 'image';
    url: string;
    mime?: string;
    filename?: string;
    width?: number;
    height?: number;
    size?: number;
    alt?: string;
};
type VideoContent = {
    type: 'video';
    url: string;
    mime?: string;
    filename?: string;
    width?: number;
    height?: number;
    duration?: number;
    size?: number;
    poster?: string;
};
type AudioContent = {
    type: 'audio';
    url: string;
    mime?: string;
    filename?: string;
    duration?: number;
    size?: number;
};
type FileContent = {
    type: 'file';
    url: string;
    mime?: string;
    filename?: string;
    size?: number;
};
type UnknownContent = {
    type: 'unknown';
    name: string;
    attrs: Record<string, PrimitiveDirectiveAttr>;
    raw: string;
};
type Content = ImageContent | VideoContent | AudioContent | FileContent | UnknownContent;
type ContentSpan = {
    content: Content;
    raw: string;
    range: {
        start: number;
        end: number;
    };
};
type ContentHandlers<TResult> = {
    [K in Content['type']]: (item: Extract<Content, {
        type: K;
    }>) => TResult;
};
type DirectiveHydratableValue = string | number | boolean | null | DirectiveHydratableValue[] | {
    [key: string]: DirectiveHydratableValue;
};
type DirectiveHydratedValue<TDirective = DirectiveToken> = TDirective | string | number | boolean | null | DirectiveHydratedValue<TDirective>[] | {
    [key: string]: DirectiveHydratedValue<TDirective>;
};
type DirectiveHydrateOptions<TDirective = DirectiveToken> = {
    map?: (token: DirectiveToken) => TDirective;
};
declare function encodeDirective(name: string, attrs: DirectiveAttrs): string;
declare function decodeDirective(text: string): DirectiveToken | null;
declare function scanDirectives(text: string): DirectiveToken[];
declare function image(attrs: Omit<ImageContent, 'type'>): string;
declare function video(attrs: Omit<VideoContent, 'type'>): string;
declare function audio(attrs: Omit<AudioContent, 'type'>): string;
declare function file(attrs: Omit<FileContent, 'type'>): string;
declare function fromDirective(token: DirectiveToken): Content;
declare function scanContent(text: string): ContentSpan[];
declare function matchContent<TResult>(item: Content, handlers: ContentHandlers<TResult>): TResult;
declare function hydrateDirectives<TDirective = DirectiveToken>(value: DirectiveHydratableValue, options?: DirectiveHydrateOptions<TDirective>): DirectiveHydratedValue<TDirective>;
declare const directive: {
    encode: typeof encodeDirective;
    decode: typeof decodeDirective;
    scan: typeof scanDirectives;
    hydrate: typeof hydrateDirectives;
    content: {
        image: typeof image;
        video: typeof video;
        audio: typeof audio;
        file: typeof file;
        from: typeof fromDirective;
        scan: typeof scanContent;
        match: typeof matchContent;
    };
};
export { directive, type AudioContent, type Content, type ContentHandlers, type ContentSpan, type DirectiveAttrs, type DirectiveHydratableValue, type DirectiveHydratedValue, type DirectiveHydrateOptions, type DirectiveToken, type FileContent, type ImageContent, type PrimitiveDirectiveAttr, type UnknownContent, type VideoContent, };
