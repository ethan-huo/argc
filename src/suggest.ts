// Damerau-Levenshtein edit distance for "Did you mean?" suggestions

const MAX_DISTANCE = 3
const MIN_SIMILARITY = 0.4

function editDistance(a: string, b: string): number {
	if (Math.abs(a.length - b.length) > MAX_DISTANCE) {
		return Math.max(a.length, b.length)
	}

	const d: number[][] = []

	for (let i = 0; i <= a.length; i++) {
		d[i] = [i]
	}
	for (let j = 0; j <= b.length; j++) {
		d[0]![j] = j
	}

	for (let j = 1; j <= b.length; j++) {
		for (let i = 1; i <= a.length; i++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1
			d[i]![j] = Math.min(
				d[i - 1]![j]! + 1, // deletion
				d[i]![j - 1]! + 1, // insertion
				d[i - 1]![j - 1]! + cost, // substitution
			)
			// transposition
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1)
			}
		}
	}

	return d[a.length]![b.length]!
}

export function suggestSimilar(word: string, candidates: string[]): string[] {
	if (!candidates || candidates.length === 0) return []

	const uniqueCandidates = [...new Set(candidates)]
	const similar: string[] = []
	let bestDistance = MAX_DISTANCE

	for (const candidate of uniqueCandidates) {
		if (candidate.length <= 1) continue

		const distance = editDistance(word.toLowerCase(), candidate.toLowerCase())
		const length = Math.max(word.length, candidate.length)
		const similarity = (length - distance) / length

		if (similarity > MIN_SIMILARITY) {
			if (distance < bestDistance) {
				bestDistance = distance
				similar.length = 0
				similar.push(candidate)
			} else if (distance === bestDistance) {
				similar.push(candidate)
			}
		}
	}

	similar.sort((a, b) => a.localeCompare(b))
	return similar
}

export function formatSuggestion(similar: string[]): string[] {
	if (similar.length === 0) return []

	const lines: string[] = []
	if (similar.length === 1) {
		lines.push(`The most similar command is`)
		lines.push(`        ${similar[0]}`)
	} else {
		lines.push(`The most similar commands are`)
		for (const s of similar) {
			lines.push(`        ${s}`)
		}
	}
	return lines
}
