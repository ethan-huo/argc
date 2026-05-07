import { directive } from './directive'

const content = {
	...directive.content,
	fromDirective: directive.content.from,
}

export { content, directive }
export type {
	AudioContent,
	Content,
	ContentHandlers,
	ContentSpan,
	DirectiveAttrs,
	DirectiveHydratableValue,
	DirectiveHydratedValue,
	DirectiveHydrateOptions,
	DirectiveToken,
	FileContent,
	ImageContent,
	PrimitiveDirectiveAttr,
	UnknownContent,
	VideoContent,
} from './directive'
