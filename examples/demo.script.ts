// Example script for argc scripting mode.
//
// Run:
//   bun examples/demo.ts --script examples/demo.script.ts -- alice
//
// Notes:
// - `argc.handlers` mirrors your schema structure, but every command is a function you can call.
// - `argc.globals` contains validated global options (e.g. --env, --verbose).
// - `argc.args` contains extra positionals after `--` (optional).

export default async function main(argc: any) {
	console.log('script: globals =', argc.globals)
	console.log('script: args =', argc.args)

	const name = (argc.args?.[0] as string | undefined) ?? 'alice'

	await argc.handlers.user.create({
		name,
		email: `${name}@example.com`,
		tags: ['script'],
	})

	await argc.call['db.migrate']({ step: 1, dryRun: true })
}

