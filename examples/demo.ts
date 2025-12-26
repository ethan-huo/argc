import { toStandardJsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'

import { c, cli, group } from '../src'

// Valibot requires this wrapper to add JSON Schema support.
// Zod and ArkType don't need this - they natively implement StandardJSONSchemaV1.
const s = toStandardJsonSchema

// Define schema with group meta
const schema = {
	user: group(
		{ description: 'User management commands' },
		{
			list: c.meta({ description: 'List all users', aliases: ['ls'] }).input(
				s(
					v.object({
						all: v.optional(v.boolean(), false),
						format: v.optional(v.picklist(['json', 'table']), 'table'),
					}),
				),
			),

			create: c.meta({ description: 'Create a new user' }).input(
				s(
					v.object({
						name: v.pipe(v.string(), v.minLength(3), v.maxLength(8)),
						email: v.optional(
							v.pipe(v.string(), v.email(), v.description('user email')),
						),
					}),
				),
			),
		},
	),

	config: group(
		{ description: 'Configuration management' },
		{
			get: c
				.meta({
					description: 'Get a config value',
					aliases: ['g'],
					examples: ['demo config get DATABASE_URL', 'demo config g API_KEY'],
				})
				.args('key')
				.input(s(v.object({ key: v.string() }))),

			set: c
				.meta({
					description: 'Set a config value',
					aliases: ['s'],
				})
				.args('key', 'value')
				.input(
					s(
						v.object({
							key: v.string(),
							value: v.string(),
						}),
					),
				),

			// Test deprecated
			reset: c
				.meta({
					description: 'Reset all config (use "config clear" instead)',
					deprecated: true,
					aliases: ['r'],
				})
				.input(s(v.object({}))),

			// Test hidden
			debug: c
				.meta({
					description: 'Debug config internals',
					hidden: true,
				})
				.input(s(v.object({}))),

			// New replacement command
			clear: c
				.meta({ description: 'Clear all config values' })
				.input(s(v.object({ force: v.optional(v.boolean(), false) }))),
		},
	),

	// More test cases
	db: group(
		{ description: 'Database operations' },
		{
			migrate: c
				.meta({
					description: 'Run database migrations',
					examples: ['demo db migrate --step 1', 'demo db migrate --dry-run'],
				})
				.input(
					s(
						v.object({
							step: v.optional(v.pipe(v.number(), v.minValue(1)), 1),
							dryRun: v.optional(v.boolean(), false),
						}),
					),
				),

			seed: c
				.meta({ description: 'Seed the database' })
				.args('file')
				.input(
					s(
						v.object({
							file: v.pipe(
								v.string(),
								v.endsWith('.json'),
								v.transform((it) => Bun.file(it).json()),
								v.description('JSON seed file'),
							),
							truncate: v.optional(v.boolean(), false),
						}),
					),
				),
		},
	),

	// Deeply nested
	deploy: group(
		{ description: 'Deployment commands' },
		{
			aws: group(
				{ description: 'AWS deployment' },
				{
					lambda: c.meta({ description: 'Deploy to AWS Lambda' }).input(
						s(
							v.object({
								region: v.optional(
									v.picklist(['us-east-1', 'us-west-2', 'eu-west-1']),
									'us-east-1',
								),
								memory: v.optional(
									v.pipe(v.number(), v.minValue(128), v.maxValue(10240)),
									512,
								),
							}),
						),
					),
					s3: c
						.meta({ description: 'Deploy to S3' })
						.args('bucket')
						.input(
							s(
								v.object({
									bucket: v.pipe(v.string(), v.minLength(3)),
									prefix: v.optional(v.string(), '/'),
								}),
							),
						),
				},
			),
			vercel: c.meta({ description: 'Deploy to Vercel' }).input(
				s(
					v.object({
						prod: v.optional(v.boolean(), false),
					}),
				),
			),
		},
	),
}

// Create CLI
const app = cli(schema, {
	name: 'demo',
	version: '0.1.0',
	description: 'A demo CLI built with argc',
	globals: s(
		v.object({
			env: v.optional(v.picklist(['dev', 'staging', 'prod']), 'dev'),
			verbose: v.optional(v.boolean(), false),
		}),
	),
})

// Run
app.run({
	context: (globals) => ({
		env: globals.env,
		verbose: globals.verbose,
		log: (msg: string) => {
			if (globals.verbose) console.log(`[${globals.env}]`, msg)
		},
	}),

	handlers: {
		user: {
			list: ({ input, context }) => {
				context.log('Listing users...')
				console.log('Users:', { all: input.all, format: input.format })
			},

			create: ({ input, context }) => {
				context.log('Creating user...')
				console.log('Created user:', input.name, input.email ?? '(no email)')
			},
		},

		config: {
			get: ({ input, context }) => {
				context.log(`Getting config: ${input.key}`)
				console.log(`${input.key} = some_value`)
			},

			set: ({ input, context }) => {
				context.log(`Setting config: ${input.key}`)
				console.log(`Set ${input.key} = ${input.value}`)
			},

			reset: ({ context }) => {
				context.log('Resetting config...')
				console.log('Config reset (deprecated, use "config clear" instead)')
			},

			debug: ({ context }) => {
				context.log('Debug mode')
				console.log('Internal config state: {...}')
			},

			clear: ({ input, context }) => {
				context.log('Clearing config...')
				console.log('Config cleared', { force: input.force })
			},
		},

		db: {
			migrate: ({ input, context }) => {
				context.log(`Running migration...`)
				console.log('Migration:', { step: input.step, dryRun: input.dryRun })
			},

			seed: async ({ input, context }) => {
				context.log(`Seeding database...`)
				console.log('Seed file:', await input.file, {
					truncate: input.truncate,
				})
			},
		},

		deploy: {
			aws: {
				lambda: ({ input, context }) => {
					context.log('Deploying to Lambda...')
					console.log('Lambda:', { region: input.region, memory: input.memory })
				},
				s3: ({ input, context }) => {
					context.log('Deploying to S3...')
					console.log('S3:', { bucket: input.bucket, prefix: input.prefix })
				},
			},
			vercel: ({ input, context }) => {
				context.log('Deploying to Vercel...')
				console.log('Vercel:', { prod: input.prod })
			},
		},
	},
})
