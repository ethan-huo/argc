import { toStandardJsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'

import { c, cli, group } from '../src/index'

const s = toStandardJsonSchema

// Programmatically generated so `@schema` reliably exceeds the fold threshold
// (default maxLines 1000) and demonstrates the compact outline + selector
// guidance. 24 namespaces x 4 services x 8 commands = 768 commands.
const NAMESPACES = [
	'compute',
	'storage',
	'network',
	'identity',
	'billing',
	'monitoring',
	'logging',
	'queue',
	'cache',
	'search',
	'registry',
	'secrets',
	'dns',
	'cdn',
	'database',
	'analytics',
	'pipeline',
	'scheduler',
	'notifications',
	'workflows',
	'containers',
	'functions',
	'gateway',
	'audit',
]
const SERVICES = ['core', 'admin', 'data', 'events']
const VERBS = [
	'list',
	'get',
	'create',
	'update',
	'remove',
	'search',
	'archive',
	'sync',
]
const INPUTS = [
	v.object({ id: v.string() }),
	v.object({
		name: v.string(),
		region: v.optional(v.picklist(['us', 'eu', 'ap'])),
	}),
	v.object({ limit: v.optional(v.number()), cursor: v.optional(v.string()) }),
	v.object({ tags: v.optional(v.array(v.string())) }),
]

const schema: Record<string, ReturnType<typeof group>> = {}
const handlers: Record<
	string,
	(args: { input: unknown; meta: { command: string } }) => unknown
> = {}

for (const ns of NAMESPACES) {
	const services: Record<string, ReturnType<typeof group>> = {}
	for (const svc of SERVICES) {
		const cmds: Record<string, ReturnType<typeof c.input>> = {}
		VERBS.forEach((verb, i) => {
			cmds[verb] = c
				.meta({ description: `${verb} ${svc} in ${ns}` })
				.input(s(INPUTS[i % INPUTS.length]!))
			handlers[`${ns}.${svc}.${verb}`] = ({ input, meta }) => ({
				command: meta.command,
				input,
			})
		})
		services[svc] = group({ description: `${ns} ${svc}` }, cmds)
	}
	schema[ns] = group({ description: `${ns} resources` }, services)
}

const app = cli(schema, {
	name: 'large',
	version: '7.0.0',
	description: 'Large schema demo (768 commands)',
})

// Generated schema → handler shape can't be statically derived; cast for the demo.
await app.run({ handlers: handlers as never })
