/*
Large CLI demo for agent schema exploration.

Usage:
  bun examples/large.ts --schema
  bun examples/large.ts --schema=.compute
  bun examples/large.ts --schema=.compute.alpha
  bun examples/large.ts --schema=.compute.alpha.list
  bun examples/large.ts --schema=..create

Selector (jq-like):
  .a.b            path
  .a.*            wildcard (one level)
  .a.{b,c}        set selection
  ..name          recursive descent (match any depth)

Input (JSON):
  bun examples/large.ts compute alpha create --input '{"name":"x","region":"us-east-1"}'
  echo '{"name":"x"}' | bun examples/large.ts compute alpha create --input
  bun examples/large.ts compute alpha create --input @payload.json
*/

import { toStandardJsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'

import { c, cli, group, type Router } from '../src'

const s = toStandardJsonSchema

const topGroups = ['compute', 'storage', 'network', 'iam', 'database', 'analytics']
const subGroups = ['alpha', 'beta', 'gamma', 'delta']
const commands = ['list', 'get', 'create', 'update', 'delete']

function makeCommand(description: string) {
	return c
		.meta({ description })
		.input(
			s(
				v.object({
					region: v.optional(v.string()),
					name: v.optional(v.string()),
					dryRun: v.optional(v.boolean(), false),
				}),
			),
		)
}

function makeSubGroup(parent: string, sub: string): Router {
	const children: Record<string, Router> = {}
	for (const cmd of commands) {
		children[cmd] = makeCommand(`${parent} ${sub} ${cmd}`)
	}
	return group({ description: `${parent} ${sub} operations` }, children)
}

const schema: Record<string, Router> = {}
for (const top of topGroups) {
	const children: Record<string, Router> = {}
	for (const sub of subGroups) {
		children[sub] = makeSubGroup(top, sub)
	}
	schema[top] = group({ description: `${top} services` }, children)
}

const app = cli(schema, {
	name: 'gclude',
	version: '0.0.1',
	description: 'Large demo CLI with 120 commands for agent schema exploration',
	schemaMaxLines: 100,
	globals: s(
		v.object({
			env: v.optional(v.picklist(['dev', 'staging', 'prod']), 'dev'),
			verbose: v.optional(v.boolean(), false),
		}),
	),
})

// This example is meant for schema exploration. For execution, provide real handlers.
app.run({
	handlers: {} as Record<string, never>,
})
