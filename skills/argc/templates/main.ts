#!/usr/bin/env bun

import { toStandardJsonSchema } from '@valibot/to-json-schema'
import { c, cli } from 'argc'
import * as v from 'valibot'

import packageJson from '../package.json' with { type: 'json' }

const s = toStandardJsonSchema

const schema = {
	hello: c
		.meta({
			description: 'Say hello',
			examples: ['{{APP_NAME}} hello --name world --loud'],
		})
		.input(
			s(
				v.object({
					name: v.pipe(v.string(), v.minLength(1)),
					loud: v.optional(v.boolean(), false),
				}),
			),
		),
}

const app = cli(schema, {
	name: '{{APP_NAME}}',
	version: packageJson.version,
	description: 'Describe what {{APP_NAME}} does in one line.',
})

await app.run({
	handlers: {
		hello: ({ input }) => {
			const msg = `Hello, ${input.name}!`
			console.log(input.loud ? msg.toUpperCase() : msg)
		},
	},
})
