# Input sources: `@file`, `-`, heredoc, and the two `@` meanings

Read when a command takes long free-text input (message body, script, document),
when agents keep JSON-escaping multi-line content, or when `@file` behaves
unexpectedly next to flags.

## The taxonomy

argc implements input sources at **command scope**:

```text
tool message.send "{ channel: '#eng', text: '…' }"   # object (agent default)
tool message.send @payload.json                       # whole input from JSON file
tool message.send -                                   # whole input from stdin
```

Anything past `--flag` is **field scope**, implemented by your handlers, not argc:

```text
tool message.send --text - <<'MD' … MD     # flag value from stdin
tool message.send --text @./body.md        # flag value from file
```

Agents routinely confuse these. `tool cmd --flags @body.md` looks like "use this
file" but argc reads bare `@path` as the **whole command input** and errors with
`TWO_INPUTS`. Field-level file refs must be the **value** of a flag
(`--text @body.md`), or you must rewrite argv in `main.ts` before `app.run`:

```typescript
// slack does this: bare @body.md after flags → --text @body.md
const argv = rewriteMessageBodyFileArgv(process.argv.slice(2))
await app.run({ handlers }, argv)
```

Leave `tool cmd @payload.json` (sole token) alone — that is the argc convention.

## Field-level resolution rules

For a long-text field named `text`/`body`/`code`:

| Value                          | Resolve to      | Rationale                         |
| ------------------------------ | --------------- | --------------------------------- |
| `'-'`                          | stdin (heredoc) | no escaping, composes with pipes  |
| `'@path'` where `exists(path)` | file contents   | humans think in files             |
| `'@path'` where not exists     | literal text    | `@README` must survive as content |
| anything else                  | literal text    | default                           |

The **existence check** is the disambiguator. Extension heuristics (`*.md` only)
or requiring `./` both leak: a file without the "right" extension is silently
sent as literal text, and path-like content is impossible to send. Reserve one
counter-example: values that carry their own domain syntax (`<@U…>` Slack
mentions, `@org/pkg` npm names) — keep a narrow guard for those before checking
existence.

Apply the same rule symmetrically to file-writing commands where output can be
`@path`. Keep the rule identical across commands; per-command dialects teach
agents the wrong grammar.

## Heredoc as the human/agent sweet spot

Multi-line free text belongs in heredoc, not in a JSON string:

```bash
tool message.send --channel '#eng' --text - <<'MD'
## Deploy complete

cc <@U0BHX4KAM52>
MD
```

This is what agents should see in `meta.examples` for body-bearing commands —
one example teaches the whole convention, no prose section needed. Object form
still works; reserve it for short one-liners or programmatic `@run`.

## Status output is disclosure, not a parse tree

Preflight commands (`tool status`) exist so an agent can orient before acting.
Design them as:

```yaml
authenticated: false # unauthenticated — nothing else
```

```yaml
authenticated: true # authenticated — flat identity + derived fields
user: { id: U…, name: ethan }
team: { id: T…, name: Celados }
channels:
  - { id: C…, name: eng, description: … }
users:
  - { id: U…, name: ethan, email: … }
```

Rules:

- No nested `auth.authenticated`; the flag lives at top level.
- Derived fields (roster, email, description) appear only when available — never
  emit placeholder nulls/empties an agent might act on.
- Omit internal machine state the CLI manages itself (token `expires_at` when
  refresh is automatic, lock files, cache paths).
- Lean rows (`id` + `name` + one orientation field) over raw upstream objects.

## Interactive vs non-interactive

Gate on `process.stdin.isTTY`:

| Caller            | Missing argument                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Human TTY         | prompt — masked input for secrets, select for enumerated values (e.g. `tool remove` with no ref shows installed choices) |
| Agent / pipe / CI | stable error naming the exact flag (`tool remove --repo owner/repo`)                                                     |

Never prompt non-TTY — a hung pipe is worse than an error. Never require env
vars for state the tool can persist (app config, credentials); env is the
headless/CI escape hatch documented as such, not the interactive login path.
