// Example script for argc scripting mode.
//
// Run:
//   bun examples/demo.ts @run @examples/demo.script.ts -- alice
//
// Notes:
// - `argc.handlers` mirrors your schema structure, but every command is a function you can call.
// - `argc.context` contains validated context (e.g. --context / ARGC_CTX).
// - `argc.args` contains extra positionals after `--` (optional).

export default async function main(argc: any) {
	console.log('script: context =', argc.context)
	console.log('script: args =', argc.args)

	const name = (argc.args?.[0] as string | undefined) ?? 'alice'

	await argc.handlers.user.create({
		name,
		email: `${name}@example.com`,
	})

	return await argc.handlers.user.list({ format: 'json' })
}
