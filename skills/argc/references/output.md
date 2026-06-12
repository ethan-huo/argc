# Output: Summaries, Not Raw Data

stdout is the agent's context budget — every byte you print is a byte it pays to
read. The job of a command's stdout is *disclosure*: say what happened, hand back
the numbers that matter, and point to where the bulk lives. Not to dump the bulk.

## Two kinds of tools

Classify the tool before you design its output.

**Stateless (output-driven).** The result *is* the output; nothing is persisted
between runs. A formatter, a calculator, a one-shot query. Emit a YAML summary to
stdout; add `--json` on data commands for `jq` pipes.

**Stateful (data-driven).** The tool fetches, scrapes, or accumulates bulk data
(documents, query results, large payloads). It needs a state dir. Write the bytes
to `cwd/.<tool>/` and let stdout carry **only** a summary plus the path to re-read.
The agent reads the file on demand with Read / `jq` / `rg` — on its own schedule,
not forced into context the moment the command runs.

Decision rule: if a command can emit more than a screenful, or the agent will want
to slice/query the result, it is stateful → persist to disk, summarize to stdout.

```
cwd/.myapp/
  fetch-001.json     # bulk payload, agent re-reads on demand
  cache/...
```

(Add `.myapp/` to the user's `.gitignore` guidance in the tool's own skill.)

## Why YAML — not JSON, not TOON

For stdout *summaries*, prefer YAML:

- **Readable as disclosure.** A YAML mapping is a clean KV block — the natural
  shape for "here's what happened" — and every agent parses it natively without a
  tool call. Bare JSON-as-default is noisier to skim and invites the agent to
  treat stdout as data rather than a summary.
- **TOON is the wrong fit here.** TOON optimizes token density for *uniform
  tabular* records. CLI summaries are heterogeneous — counts, paths, prose, the
  occasional snippet — which is exactly what YAML mappings model and TOON does
  not. Reserve TOON (if ever) for shipping a large uniform table; even then,
  `--json` + `jq` is the better escape hatch.

Raw data is the exception, not the default: expose it behind `--json` so the agent
can pipe it through `jq`, and keep the default human/agent-facing path as a summary.

## Serializing: use the `yaml` library, not `Bun.YAML`

```typescript
import { stringify } from 'yaml'   // npm: yaml (eemeli/yaml), the js-yaml successor

process.stdout.write(stringify(value))
```

Why not `Bun.YAML.stringify`: its native serializer never emits `|` literal-block
scalars — multi-line strings come out as double-quoted with escaped `\n`
(`preview: "<div>\n  ..."`). That is intentional and test-locked in Bun through
1.4, not a version gap that will close (the `|`/`>` support in Bun's YAML docs is
**parse-only**). The `yaml` library emits proper block scalars by default, which
keeps any multi-line value in a summary readable:

```yaml
lines: 2000
preview: |
  <div>
    hello
  </div>
"@hints":
  - Re-run with --json to stream raw records to a pipe
```

Add it to the tool: `bun add yaml`. It is a tiny, dependency-free package and the
de-facto standard. (Multi-line previews this large usually still belong in
`.<tool>/`, not stdout — but when a short multi-line value does land in a summary,
block scalars are why it stays legible.)

## `@`-keys — the tool→agent signal channel

`@`-prefixed keys are a reserved convention: an out-of-band channel for the tool
(or system) to speak *to the agent*, kept separate from the command's data payload.
A plain key is data the agent asked for; an `@`-key is the tool talking back. The
`@` prefix sorts these meta keys visually apart from data and reads as "not part of
the result" (YAML quotes the key — harmless). Two established members:

- **`@hints`** — what the agent should consider doing *next*, grounded in what just
  happened (the real path written, the real count truncated). It rides on top of
  the skill: the skill teaches general usage; `@hints` are runtime-specific nudges.
  Make them actionable and concrete — a command the agent can copy, not advice.
- **`@notification`** — a system notice the agent should surface or react to, even
  though it didn't ask: a daemon's state change, a deprecation, a quota warning, a
  background job that finished. Common in long-running / daemon-style tools where
  the tool needs to push something at the agent between commands.

```yaml
records: 2000
written: .myapp/fetch-001.json
bytes: 98123
"@hints":
  - "Full records at .myapp/fetch-001.json — slice with: jq '.[0:10]' .myapp/fetch-001.json"
  - Re-run with --json to stream raw records to a pipe
  - See the myapp skill references/process-data.md for the record shape
"@notification": "watcher daemon restarted at 12:04 — re-run `myapp status` to resync"
```

The set is open: coin a new `@`-key when the tool needs a distinct channel, but
keep them few and predictable, and document any you invent in the tool's own skill.

## A stateful command, end to end

```typescript
import { stringify } from 'yaml'
import { mkdir } from 'node:fs/promises'

// handler for `myapp fetch`
async fetch({ input }) {
  const records = await fetchAll(input.url)            // bulk
  const path = `.myapp/fetch-${stamp}.json`
  await mkdir('.myapp', { recursive: true })
  await Bun.write(path, JSON.stringify(records))       // persist bulk to state dir

  if (input.json) {                                    // --json: raw to the pipe
    process.stdout.write(JSON.stringify(records))
    return
  }

  process.stdout.write(stringify({                     // default: summary to stdout
    records: records.length,
    written: path,
    '@hints': [
      `Records at ${path} — slice with: jq '.[0:10]' ${path}`,
      'Re-run with --json to stream raw records to a pipe',
    ],
  }))
}
```

Progress and diagnostics during the fetch go to **stderr** via `argc/terminal`
(`console.error(fmt.info('Fetching…'))`) — never interleaved with the stdout
summary. See `references/terminal.md`.
