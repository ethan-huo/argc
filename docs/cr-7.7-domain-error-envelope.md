---
type: Change Request
title: argc 7.7 — domain errors get an envelope code instead of collapsing to RUNTIME_ERROR
status: accepted
version: 0.2
timestamp: 2026-07-21
description: >
  A consumer CLI's own error vocabulary currently has no envelope-level representation.
  Every domain failure a handler throws surfaces as `error: RUNTIME_ERROR` with the real
  code buried in a `detail` string prefix, so an agent must parse prose to learn what
  happened. Add a `DOMAIN_ERROR` envelope variant carrying a consumer-owned `code` field,
  plus a public constructor, keeping consumer vocabulary in a separate namespace from
  argc's own framework-level codes.
---

# CR 7.7 — domain error envelope

> **Status:** accepted — shipped in **v7.7.0**.
> **0.2:** implementation review confirmed that the human and agent paths already
> converge on the same envelope renderer, so no second human-rendering branch was added.

## Problem

argc's error envelope has one bucket for everything a handler throws.
`src/cli.ts:96` catches `ArgcError` and renders its envelope; anything else
becomes:

```yaml
error: RUNTIME_ERROR
detail: <formatRuntimeError(error)>
```

A consumer CLI with its own error vocabulary therefore cannot express it. The
real-world case that surfaced this is `celados/slack` v5.3.0, which defines 14
codes in `src/cli-error.ts` (`auth_required`, `invalid_input`, `missing_scope`,
`focus_not_found`, …) and documents them in its agent-facing skill as "stable
failures". None of them is stable at the envelope level. Observed:

```console
$ slack channel.info "{ channel: 'eng' }"
error: RUNTIME_ERROR
detail: 'invalid_input: Channel must be a Slack ID (C…) or #name, not "eng". Example: "#eng".'
```

The consumer's workaround is a `<code>: <message>` string prefix. So the
agent-facing contract is "read `detail`, split on the first colon" — parsing
prose to recover structure, which is the exact failure mode the envelope exists
to prevent.

`ArgcError` is `export`ed from `src/render.ts` but is **not** re-exported from
`src/index.ts`, so importing from the package cannot reach it. There is no
supported seam.

## Why not just export `ArgcError`

That is the smaller change, and it is wrong.

argc's existing envelope codes are all **framework-level** — `INVALID_INPUT`,
`BAD_SELECTOR`, `UNKNOWN_COMMAND`, `BAD_INPUT_JSON`, `TWO_INPUTS`,
`NOT_A_COMMAND`, `BAD_PATH`, `RUN_DISABLED`, `INVALID_CONTEXT`,
`RUNTIME_ERROR`. They all mean _something about this invocation is malformed_.

A consumer's codes mean the opposite: the invocation was well-formed and the
domain refused it. `focus_not_found` is not a bad call; it is a good call
about a message that no longer exists.

That distinction is **actionable**, which is why it should survive into the
envelope:

| Envelope                           | What an agent should do                        |
| ---------------------------------- | ---------------------------------------------- |
| `INVALID_INPUT`, `BAD_SELECTOR`, … | the call itself is wrong — fix it and retry    |
| `DOMAIN_ERROR`                     | the call was right — do not retry it unchanged |

If consumers mint codes into the same `error` field, that distinction is lost
and every consumer independently re-invents a convention for signalling it.

## Proposed change

### 1. Envelope variant

`src/render.ts` — extend `ErrorEnvelope['error']` with `'DOMAIN_ERROR'`, and
render an accompanying `code`:

```yaml
error: DOMAIN_ERROR
code: focus_not_found
detail: Focus message 1784559053.114759 was not returned by Slack.
```

`code` is an **opaque consumer-owned string**. argc does not validate the
vocabulary, own a registry, or interpret the value — it only requires that it
is present and non-empty. Consumers document their own codes.

### 2. Public constructor

Export a constructor so consumers never touch `ArgcError` directly:

```ts
import { domainError } from 'argc'

throw domainError(
	'focus_not_found',
	'Focus message … was not returned by Slack.',
	{
		// optional extra envelope fields, same freedom ErrorEnvelope already allows
	},
)
```

The optional fields cannot reuse the reserved `error`, `code`, or `detail`
keys; construction rejects those collisions so metadata cannot rewrite the
stable envelope prefix.

Re-export from `src/index.ts`. Whether `ArgcError` itself also becomes public
is a separate decision — this CR does not need it, and keeping it internal
leaves the envelope shape under argc's control.

### 3. `finalizeEnvelope`

`src/cli.ts` currently attaches the command `$schema` to `INVALID_INPUT`
envelopes, on the invariant that a malformed call should be shown the shape it
should have had. **`DOMAIN_ERROR` must not get that treatment** — the call was
well-formed, so echoing the schema is noise that implies the caller made a
shape error.

### 4. Human path

The human path converges on the same `CLI.run` catch and `renderError` call as
structured input. `renderError` already preserves arbitrary envelope fields, so
`code` appears without a `src/human.ts` change. A human-path regression test is
required; a second renderer would create drift without adding behavior.

### 5. Exit code

`DOMAIN_ERROR` exits non-zero like every other error envelope. A domain refusal
is still a failed invocation; nothing about shell semantics changes. Flagging
it explicitly because "the call was valid" could be misread as "exit 0".

## Non-goals

- **No registry of domain codes in argc.** The vocabulary belongs to the
  consumer. argc carries the string.
- **No automatic mapping** of thrown consumer errors to `DOMAIN_ERROR`. argc
  cannot tell a deliberate domain refusal from a genuine crash; a crash must
  keep surfacing as `RUNTIME_ERROR`. Consumers opt in explicitly by throwing
  `domainError(...)`.
- **No change to existing envelope codes.** Purely additive; nothing that
  renders today renders differently after this CR.

## Consumer migration (informative)

`celados/slack` is the driving consumer and would migrate like this — included
so the shape can be sanity-checked against a real case, not as work required by
this CR:

- `SlackCliError` keeps its 14-code union as the internal type.
- The top-level handler maps `SlackCliError` → `domainError(err.code, err.message, err.details)`.
- The `<code>: <message>` string prefix disappears from `detail`.
- Its skill's "Stable failures" section becomes literally true — those codes
  land in `code`, where they can be matched instead of parsed.

## Verification

- [x] `domainError('x', 'msg')` renders `error: DOMAIN_ERROR`, `code: x`,
      `detail: msg`, exit non-zero.
- [x] `DOMAIN_ERROR` envelopes carry **no** `$schema`, while `INVALID_INPUT`
      still does.
- [x] An ordinary `throw new Error('boom')` in a handler still renders
      `RUNTIME_ERROR` — opt-in, not automatic.
- [x] Empty or missing `code` is rejected at construction, not silently
      rendered.
- [x] `domainError` is importable from the package root.
- [x] Human path prints `code`.
- [x] Existing error-rendering tests in `src/v7.test.ts` remain green — this
      CR adds a variant and alters nothing that renders today.

## Context for whoever implements this

Discovered while landing `slack read --url` (celados/slack v5.3.0). The new
`focus_not_found` and `thread_not_found` codes were specified as stable,
machine-matchable errors, and could not be delivered as such. That is recorded
in that repo's `.agents/backlog.md` under **read custom-error envelope**.

The finding generalizes past that feature: the gap applies to all 14 of the
consumer's codes and has existed for as long as its error vocabulary has.
Nothing in `slack` is blocked on this — the codes are reachable via the
`detail` prefix today — so this can land on argc's own schedule. When it does,
the consumer migration above is a single mapping function plus deleting a
string prefix.
