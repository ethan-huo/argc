import type { Router } from './types'
import { isCommand, isGroup } from './types'

export function getRouterChildren(router: Router): { [key: string]: Router } {
	if (isCommand(router)) return {}
	if (isGroup(router)) return router['~argc.group'].children
	return router
}

export function findHandler(
	path: string[],
	handlers: Record<string, unknown>,
): ((opts: unknown) => Promise<void> | void) | null {
	const joined = path.join('.')
	if (joined in handlers && typeof handlers[joined] === 'function') {
		return handlers[joined] as (opts: unknown) => Promise<void> | void
	}

	let current: unknown = handlers

	for (const segment of path) {
		if (
			typeof current === 'object' &&
			current !== null &&
			segment in current
		) {
			current = (current as Record<string, unknown>)[segment]
		} else {
			return null
		}
	}

	if (typeof current === 'function') {
		return current as (opts: unknown) => Promise<void> | void
	}

	return null
}
