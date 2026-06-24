import { toStandardJsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'

import { c, cli, group } from '../src/index'

const s = toStandardJsonSchema

const schema = {
	user: group(
		{ description: 'User commands' },
		{
			list: c
				.meta({ description: 'List users' })
				.input(
					s(v.object({ format: v.optional(v.picklist(['yaml', 'json'])) })),
				),
			create: c
				.meta({ description: 'Create a user' })
				.input(
					s(v.object({ name: v.string(), email: v.optional(v.string()) })),
				),
		},
	),
	config: {
		get: c.input(s(v.object({ key: v.string() }))),
		set: c.input(s(v.object({ key: v.string(), value: v.string() }))),
	},
}

const app = cli(schema, {
	name: 'demo',
	version: '7.0.0',
	description: 'argc 7 demo',
	context: s(v.object({ env: v.optional(v.picklist(['dev', 'prod']), 'dev') })),
})

await app.run({
	handlers: {
		user: {
			list: ({ input, context }) => [
				{
					id: 1,
					name: 'alice',
					format: input.format ?? 'yaml',
					env: context.env,
				},
			],
			create: ({ input, context }) => ({
				id: 1,
				name: input.name,
				email: input.email,
				env: context.env,
			}),
		},
		config: {
			get: ({ input }) => ({ key: input.key, value: 'demo' }),
			set: ({ input }) => ({
				key: input.key,
				value: input.value,
				updated: true,
			}),
		},
	},
})
