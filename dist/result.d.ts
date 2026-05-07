import { directive } from './directive';
declare const content: {
    image: (attrs: Omit<import("./directive").ImageContent, 'type'>) => string;
    video: (attrs: Omit<import("./directive").VideoContent, 'type'>) => string;
    audio: (attrs: Omit<import("./directive").AudioContent, 'type'>) => string;
    file: (attrs: Omit<import("./directive").FileContent, 'type'>) => string;
    from: (token: import("./directive").DirectiveToken) => import("./directive").Content;
    scan: (text: string) => import("./directive").ContentSpan[];
    match: <TResult>(item: import("./directive").Content, handlers: import("./directive").ContentHandlers<TResult>) => TResult;
    fromDirective: (token: import("./directive").DirectiveToken) => import("./directive").Content;
};
export { content, directive };
export type { AudioContent, Content, ContentHandlers, ContentSpan, DirectiveAttrs, DirectiveHydratableValue, DirectiveHydratedValue, DirectiveHydrateOptions, DirectiveToken, FileContent, ImageContent, PrimitiveDirectiveAttr, UnknownContent, VideoContent, } from './directive';
