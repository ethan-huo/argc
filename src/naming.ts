export function kebabCase(name: string): string {
	return name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

export function camelCase(name: string): string {
	return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}
