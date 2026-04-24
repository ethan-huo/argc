export function kebabCase(name: string): string {
	return name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}
