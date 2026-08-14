import { describe, expect, test } from 'bun:test'
import { Writable } from 'node:stream'

import { writeOutput } from './render'

describe('writeOutput', () => {
	test('waits until the stream accepts the complete result', async () => {
		let completed = false
		const stream = new Writable({
			write(_chunk, _encoding, callback) {
				setTimeout(() => {
					completed = true
					callback()
				}, 5)
			},
		})

		await writeOutput(stream, 'result')

		expect(completed).toBe(true)
	})

	test('treats a downstream EPIPE as a completed write', async () => {
		const stream = new Writable({
			write(_chunk, _encoding, callback) {
				const error = Object.assign(new Error('closed'), { code: 'EPIPE' })
				callback(error)
			},
		})

		await expect(writeOutput(stream, 'result')).resolves.toBeUndefined()
	})
})
