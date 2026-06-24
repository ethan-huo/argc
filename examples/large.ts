import { toStandardJsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'

import { c, cli, group } from '../src/index'

const s = toStandardJsonSchema

function service(name: string) {
	return group(
		{ description: `${name} service` },
		{
			list: c.input(s(v.object({ region: v.optional(v.string()) }))),
			get: c.input(s(v.object({ id: v.string() }))),
			create: c.input(s(v.object({ name: v.string(), region: v.string() }))),
		},
	)
}

const schema = {
	compute: group(
		{ description: 'Compute resources' },
		{
			alpha: service('alpha compute'),
			beta: service('beta compute'),
		},
	),
	storage: group(
		{ description: 'Storage resources' },
		{
			bucket: service('bucket'),
			object: service('object'),
		},
	),
}

const app = cli(schema, {
	name: 'large',
	version: '7.0.0',
	description: 'Large schema demo',
})

function handler(path: string) {
	return ({ input }: { input: Record<string, unknown> }) => ({ path, input })
}

await app.run({
	handlers: {
		compute: {
			alpha: {
				list: handler('compute.alpha.list'),
				get: handler('compute.alpha.get'),
				create: handler('compute.alpha.create'),
			},
			beta: {
				list: handler('compute.beta.list'),
				get: handler('compute.beta.get'),
				create: handler('compute.beta.create'),
			},
		},
		storage: {
			bucket: {
				list: handler('storage.bucket.list'),
				get: handler('storage.bucket.get'),
				create: handler('storage.bucket.create'),
			},
			object: {
				list: handler('storage.object.list'),
				get: handler('storage.object.get'),
				create: handler('storage.object.create'),
			},
		},
	},
})
