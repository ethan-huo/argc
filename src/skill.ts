import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'

function fail(message: string): never {
	// Macro failures surface as an unreadable AST coerce; this line is the
	// only channel a `bun build` / transpile error has.
	console.error(`[argc/skill] ${message}`)
	throw new Error(message)
}

function toPosix(relative: string): string {
	return relative.split(sep).join('/')
}

function readUtf8(abs: string, key: string): string {
	const buf = readFileSync(abs)
	if (!Buffer.from(buf.toString('utf8'), 'utf8').equals(buf)) {
		fail(`file is not valid UTF-8: ${key}`)
	}
	return buf.toString('utf8')
}

export function pickFiles(
	root: string,
	include: string[],
): Record<string, string> {
	if (!existsSync(root) || !statSync(root).isDirectory()) {
		fail(`skill root does not exist or is not a directory: ${root}`)
	}

	const files: Record<string, string> = {}
	for (const pattern of include) {
		// scanSync order is not deterministic; sort (code-unit order — locale
		// collation varies by build host) so compiled binaries don't churn.
		const matches = [...new Bun.Glob(pattern).scanSync({ cwd: root })].sort()
		for (const match of matches) {
			const key = toPosix(match)
			const abs = join(root, match)
			if (!statSync(abs).isFile()) continue
			files[key] = readUtf8(abs, key)
		}
	}
	return files
}

export function ensureTrailingNewline(text: string): string {
	return text.endsWith('\n') ? text : `${text}\n`
}

export function formatBareSkill(
	body: string,
	vfsKeys: string[],
	appName: string,
): string {
	const files = vfsKeys.filter((key) => key !== 'SKILL.md').sort()
	const skill = ensureTrailingNewline(body)
	if (files.length === 0) return skill
	return `${skill}\n---\n\nfiles:\n${files.join('\n')}\n\nread: ${appName} @skill <path>\n`
}
