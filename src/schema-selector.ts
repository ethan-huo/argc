import type { Router } from './types'
import { isCommand, isGroup } from './types'
import { group } from './command'

export type SelectorStep =
	| { type: 'key'; name: string }
	| { type: 'wildcard' }
	| { type: 'set'; names: string[] }
	| { type: 'recursive' }

const IDENT_RE = /[A-Za-z0-9_-]/

export type SelectorMatch = {
	path: string[]
	node: Router
}

export function parseSchemaSelector(input: string): SelectorStep[] {
	if (!input) {
		throw new Error('Selector is empty')
	}
	if (input[0] !== '.') {
		throw new Error('Selector must start with "."')
	}

	const steps: SelectorStep[] = []
	let i = 0

	while (i < input.length) {
		if (charAt(input, i) !== '.') {
			throw new Error(`Unexpected character "${charAt(input, i)}" at ${i}`)
		}

		if (charAt(input, i + 1) === '.') {
			// Recursive descent
			i += 2
			steps.push({ type: 'recursive' })

			if (i >= input.length) break
			if (charAt(input, i) === '.') continue

			const parsed = parseSegment(input, i)
			steps.push(parsed.step)
			i = parsed.nextIndex
			continue
		}

		// Single dot
		i += 1
		if (i >= input.length) {
			if (input.length === 1 && steps.length === 0) break
			throw new Error(`Expected identifier at ${i}`)
		}

		const parsed = parseSegment(input, i)
		steps.push(parsed.step)
		i = parsed.nextIndex
	}

	return steps
}

export function matchSchemaSelector(
	schema: Router,
	steps: SelectorStep[],
): SelectorMatch[] {
	if (steps.length === 0) {
		return [{ path: [], node: schema }]
	}

	let current: SelectorMatch[] = [{ path: [], node: schema }]

	for (const step of steps) {
		if (step.type === 'recursive') {
			const expanded: SelectorMatch[] = []
			for (const match of current) {
				collectDescendants(match, expanded)
			}
			current = expanded
			continue
		}

		const next: SelectorMatch[] = []
		for (const match of current) {
			const children = getChildren(match.node)
			if (!children) continue

			if (step.type === 'key') {
				const child = children[step.name]
				if (child) {
					next.push({ path: [...match.path, step.name], node: child })
				}
				continue
			}

			if (step.type === 'wildcard') {
				for (const [name, child] of Object.entries(children)) {
					next.push({ path: [...match.path, name], node: child })
				}
				continue
			}

			if (step.type === 'set') {
				for (const name of step.names) {
					const child = children[name]
					if (child) {
						next.push({ path: [...match.path, name], node: child })
					}
				}
			}
		}
		current = next
	}

	return current
}

export function buildSchemaSubset(
	schema: Router,
	matches: SelectorMatch[],
	depth: number,
): Router {
	if (matches.length === 0) return {}
	if (matches.some((match) => match.path.length === 0)) {
		return sliceRouter(schema, depth)
	}

	const root: Record<string, Router> = {}
	for (const match of matches) {
		insertPath(schema, root, match.path, depth)
	}
	return root
}

export function sliceRouter(router: Router, depth: number): Router {
	if (isCommand(router)) return router

	if (isGroup(router)) {
		if (depth <= 0) {
			return group(router['~argc.group'].meta, {})
		}
		const children: Record<string, Router> = {}
		for (const [name, child] of Object.entries(router['~argc.group'].children)) {
			children[name] = sliceRouter(child, depth - 1)
		}
		return group(router['~argc.group'].meta, children)
	}

	if (depth <= 0) return {}
	const children: Record<string, Router> = {}
	for (const [name, child] of Object.entries(router)) {
		children[name] = sliceRouter(child, depth - 1)
	}
	return children
}

function parseSegment(input: string, start: number): {
	step: SelectorStep
	nextIndex: number
} {
	const ch = charAt(input, start)

	if (ch === '*') {
		return { step: { type: 'wildcard' }, nextIndex: start + 1 }
	}

	if (ch === '{') {
		let i = start + 1
		const names: string[] = []

		i = skipSpaces(input, i)
		if (charAt(input, i) === '}') {
			throw new Error('Selector set cannot be empty')
		}
		while (i < input.length) {
			const nameStart = i
			while (i < input.length && IDENT_RE.test(charAt(input, i))) i += 1
			if (nameStart === i) {
				throw new Error(`Expected identifier at ${i}`)
			}
			names.push(input.slice(nameStart, i))

			i = skipSpaces(input, i)
			if (charAt(input, i) === ',') {
				i += 1
				i = skipSpaces(input, i)
				continue
			}
			if (charAt(input, i) === '}') {
				i += 1
				break
			}
			throw new Error(`Expected "," or "}" at ${i}`)
		}

		if (names.length === 0) {
			throw new Error('Selector set cannot be empty')
		}

		return { step: { type: 'set', names }, nextIndex: i }
	}

	if (!IDENT_RE.test(ch)) {
		throw new Error(`Expected identifier at ${start}`)
	}

	let i = start + 1
	while (i < input.length && IDENT_RE.test(charAt(input, i))) i += 1

	return { step: { type: 'key', name: input.slice(start, i) }, nextIndex: i }
}

function skipSpaces(input: string, i: number): number {
	while (i < input.length && charAt(input, i) === ' ') i += 1
	return i
}

function charAt(input: string, i: number): string {
	return i < input.length ? input[i]! : ''
}

function getChildren(router: Router): Record<string, Router> | null {
	if (isCommand(router)) return null
	if (isGroup(router)) return router['~argc.group'].children
	return router
}

function collectDescendants(match: SelectorMatch, out: SelectorMatch[]): void {
	out.push(match)
	const children = getChildren(match.node)
	if (!children) return
	for (const [name, child] of Object.entries(children)) {
		collectDescendants({ path: [...match.path, name], node: child }, out)
	}
}

function insertPath(
	schema: Router,
	outRoot: Record<string, Router>,
	path: string[],
	depth: number,
): void {
	let currentOrig: Router = schema
	let currentOut: Record<string, Router> = outRoot

	for (let i = 0; i < path.length; i += 1) {
		const name = path[i]!
		const origChildren = getChildren(currentOrig)
		if (!origChildren) return
		const origNode = origChildren[name]
		if (!origNode) return

		const isLast = i === path.length - 1
		if (isLast) {
			currentOut[name] = sliceRouter(origNode, depth)
			return
		}

		const nextOut = ensureOutputNode(currentOut, name, origNode)
		const nextChildren = getChildren(nextOut)
		if (!nextChildren) return
		currentOut = nextChildren
		currentOrig = origNode
	}
}

function ensureOutputNode(
	parent: Record<string, Router>,
	name: string,
	originalNode: Router,
): Router {
	const existing = parent[name]
	if (existing) return existing

	let created: Router
	if (isGroup(originalNode)) {
		created = group(originalNode['~argc.group'].meta, {})
	} else if (isCommand(originalNode)) {
		created = originalNode
	} else {
		created = {}
	}

	parent[name] = created
	return created
}
