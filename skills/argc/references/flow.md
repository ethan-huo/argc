# Command Flow: Mutations, Prompts, Dangerous Ops

Stateless `@schema`-driven query commands need almost none of this: they parse
one object input, do one thing, return a compact YAML value, and exit. This file
is for commands that write files, mutate remote state, or change config.

## The 7-Step Shape

Every mutation command moves through these phases. Small commands can collapse
steps, but the order should not move.

1. **Orient.** On stderr, name the resolved target if it matters.
2. **Detect.** Surface inferred state only when it changes the next decision.
3. **Decide.** Ask only for values that cannot be inferred and are absent from
   input.
4. **Preview.** Before risky mutations, show the planned change on stderr.
5. **Mutate.** Do the work. Progress and logs stay on stderr.
6. **Confirm.** Return the durable result on stdout as YAML.
7. **Continue.** Put obvious next commands in `$hints`.

Handler return values are stdout. `console.log` and `process.stdout.write`
inside handlers are redirected to stderr by argc, but write intentional progress
to stderr yourself.

## Prompt Discipline

Prompt only when all of these hold:

- stdin is a TTY
- the value cannot be inferred from cwd, env, config, or remote state
- the value is absent from the structured input object
- asking reduces ambiguity or risk

Treat the explicit invocation as intent. Do not ask whether to do the command
the user already ran; ask for the smallest missing value.

For *how* to render a prompt — `@clack/prompts` on stderr, searchable vs plain
selection by list size, and treating a cancelled prompt as an abort — see
`references/concurrency.md`.

## Non-Interactive Contract

When stdin is not a TTY, `--non-interactive` is modeled in the command input, or
`CI=true`:

- Never prompt
- Never start interactive OAuth or browser flows
- Return a non-zero error that names the exact missing input field

```text
Missing team. In non-interactive mode pass it in input:
  myapp deploy "{ team: 'acme' }"
```

## Errors

argc framework errors are YAML envelopes on stderr. For domain errors, follow
the same shape when practical:

```yaml
error: DEPLOYMENT_REFUSED
message: Deployment target is locked
issues:
  - path: environment
    message: prod requires confirmName
```

Every error should say what failed, which rule was broken, and how to fix it.
Avoid raw upstream JSON and stack traces unless a debug mode explicitly asks
for them.

## Dangerous Actions

A mutation is dangerous if it deletes data, rewrites production, rotates
secrets, or changes billing/permissions.

- `yes` and `force` are different input fields. `yes` accepts confirmations;
  `force` overwrites existing state.
- In a TTY, require typed confirmation for destructive operations.
- In non-interactive mode, require a proof field such as `confirmName`.
- Distinguish no-op from success. If the resource was already absent, say so.

## Exit Codes

Use the simple contract:

- `0` success
- `1` operational or domain failure
- `2` usage error

Put richer state in the YAML result or error envelope, not custom exit codes.
