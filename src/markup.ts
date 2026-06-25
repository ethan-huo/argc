import { stringify } from 'yaml'

import { ansi, formatAnsi } from './terminal'

type ColorStream = {
	isTTY?: boolean
}

const NO_COLOR_FLAG = '--no-color'

function color(stream: ColorStream): boolean {
	// Framework-rendered contracts must stay byte-plain whenever captured.
	return (
		!!stream.isTTY &&
		!process.env.NO_COLOR &&
		!process.argv.includes(NO_COLOR_FLAG)
	)
}

function dim(value: string, enabled: boolean): string {
	return formatAnsi(ansi.dim, value, enabled)
}

function bold(value: string, enabled: boolean): string {
	return formatAnsi(ansi.bold, value, enabled)
}

function cyan(value: string, enabled: boolean): string {
	return formatAnsi(ansi.cyan, value, enabled)
}

function yellow(value: string, enabled: boolean): string {
	return formatAnsi(ansi.yellow, value, enabled)
}

function red(value: string, enabled: boolean): string {
	return formatAnsi(ansi.red, value, enabled)
}

function styleInlineCode(line: string, enabled: boolean): string {
	return line.replaceAll(/`([^`]+)`/g, (_match, code: string) =>
		yellow(`\`${code}\``, enabled),
	)
}

function styleFrontmatterLine(line: string, enabled: boolean): string {
	const match = /^([A-Za-z_$][A-Za-z0-9_$-]*:)(.*)$/.exec(line)
	if (!match) return line
	const key = match[1]!
	const value = match[2]!
	const styledValue =
		key === 'program:' || key === 'command:' ? bold(value, enabled) : value
	return `${dim(key, enabled)}${styledValue}`
}

function styleMarkdownBodyLine(line: string, enabled: boolean): string {
	if (line.startsWith('## ')) return bold(cyan(line, enabled), enabled)
	if (line.startsWith('- ')) {
		return `${dim('- ', enabled)}${styleInlineCode(line.slice(2), enabled)}`
	}
	return styleInlineCode(line, enabled)
}

export function renderOkfMarkdown(
	frontmatter: Record<string, unknown>,
	body: string,
	stream: ColorStream = process.stdout,
): string {
	const normalizedBody = body.endsWith('\n') ? body : `${body}\n`
	const source = `---\n${stringify(frontmatter, { lineWidth: 0 })}---\n${normalizedBody}`
	return colorizeOkfMarkdown(source, stream)
}

export function colorizeOkfMarkdown(
	source: string,
	stream: ColorStream = process.stdout,
): string {
	const enabled = color(stream)
	if (!enabled) return source
	let frontmatter = false
	let markerCount = 0
	return source
		.split('\n')
		.map((line) => {
			if (line === '---' && markerCount < 2) {
				markerCount++
				frontmatter = markerCount === 1
				return dim(line, enabled)
			}
			if (frontmatter) return styleFrontmatterLine(line, enabled)
			return styleMarkdownBodyLine(line, enabled)
		})
		.join('\n')
}

export function colorizeSchema(
	source: string,
	stream: ColorStream = process.stdout,
): string {
	const enabled = color(stream)
	if (!enabled) return source
	let frontmatter = false
	let markerCount = 0
	return source
		.split('\n')
		.map((line) => {
			if (line === '---' && markerCount < 2) {
				markerCount++
				frontmatter = markerCount === 1
				return dim(line, enabled)
			}
			if (frontmatter) return styleFrontmatterLine(line, enabled)
			if (line.startsWith('//')) return dim(line, enabled)
			return line.replace(
				/^(type\s+)([A-Za-z_$][A-Za-z0-9_$]*)(\s*=)/,
				(_match, prefix: string, name: string, suffix: string) =>
					`${prefix}${bold(name, enabled)}${suffix}`,
			)
		})
		.join('\n')
}

export function colorizeError(
	source: string,
	stream: ColorStream = process.stderr,
): string {
	const enabled = color(stream)
	if (!enabled) return source
	return source
		.split('\n')
		.map((line) => {
			const errorMatch = /^(error: )(.*)$/.exec(line)
			if (errorMatch) {
				return `${dim(errorMatch[1]!, enabled)}${bold(red(errorMatch[2]!, enabled), enabled)}`
			}
			const keyMatch = /^([A-Za-z_$][A-Za-z0-9_$-]*:)(.*)$/.exec(line)
			if (keyMatch) return `${dim(keyMatch[1]!, enabled)}${keyMatch[2]!}`
			return line
		})
		.join('\n')
}
