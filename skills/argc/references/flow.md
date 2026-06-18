# Command Flow: Mutations, Prompts, Dangerous Ops

Stateless `--schema`-driven query commands need almost none of this — they parse
input, do one thing, emit a YAML summary, exit. This file is for the other half:
commands that **write** something (a file, a remote resource, a config), and so
have a time axis the agent and the user both have to follow.

The rules below assume you've already absorbed the SKILL.md basics (stdout =
result, stderr = diagnostics, descriptions are imperative). They cover what the
README and `references/output.md` deliberately skip: the **shape of one
execution**.

## The 7-Step Shape

Every mutation command moves through these phases. They don't all need to be
visible — small commands collapse half of them — but the order is fixed.

1. **Orient.** Print what the command is acting on (resolved target: project,
   path, environment). One line on stderr is enough; skip if argv is the whole story.
2. **Detect.** Surface inferred state that changes the next decision (existing
   record found, framework auto-detected, default branch). Don't print state just
   to prove you resolved it — only if it affects what comes next.
3. **Decide.** Ask only for values you couldn't infer and that have no flag.
   See *Prompt Discipline* below.
4. **Preview.** Before risky or broad mutations, show the planned change as a
   compact YAML block on stderr. The user / agent gets a chance to abort.
5. **Mutate.** Do the work. If it takes more than a beat, emit a spinner or a
   status line on stderr — never on stdout.
6. **Confirm.** On stdout, write the durable result: resource ID, URL, written
   path, count. This is what the agent will quote back. Use the YAML summary +
   `$hints` shape from `references/output.md`.
7. **Continue.** When there's an obvious next command, name it in `$hints`.
   "Run `myapp inspect <id>` to see status." Concrete commands the agent can copy,
   not advice.

A copy tweak isn't enough if the order is wrong. If you find yourself rewording
a prompt, check whether the prompt should fire at all — or whether the resolved
state should land before it.

## Prompt Discipline

Prompt only when **all** of these hold:

- stdin is a TTY (`process.stdin.isTTY === true`)
- the value can't be inferred from cwd, env, or a config file
- no flag, positional, or `--input` field already provides it
- asking meaningfully reduces ambiguity or risk

Treat the explicit invocation as the user's intent. Never ask "Do you want to
add this?" — they ran the command, the answer is yes. Ask for the **smallest
missing value** with a concrete noun: `Project?`, `Environment?`, not
`What would you like to do?`.

Show defaults inline (`Branch [main]:`) and let `--yes` accept them.

## Non-Interactive Contract

When stdin is not a TTY, **or** `--non-interactive` is set, **or** the
environment looks like CI (`CI=true`):

- Never prompt. Not even once.
- Never trigger an interactive OAuth / browser flow.
- If a required value is missing, exit non-zero with an error that **names the
  exact flag or `--input` field** that would have unblocked it.

```text
Missing --team. In non-interactive mode the team must be provided explicitly.
  myapp deploy --team acme
```

This is the contract that makes the tool usable from an agent loop, a script,
or a cron job without surprise.

## Errors: 3-Part Structure

Every error message says, in this order:

1. **What failed.** One line, plain.
2. **The rule or constraint that was broken.** Why it's a failure, not a glitch.
3. **How to fix it.** A concrete next action — flag, command, file edit.

Put the most actionable line **last** so it's the line that survives in a
truncated terminal or a captured agent log.

```text
Couldn't add domain example.com.
Domain names must be lowercase ASCII with no spaces.
Try: myapp domain add my-app.example.com
```

Choose the verb deliberately:

- `Failed to …` — system, network, build, or upstream API failure. Pair with a
  stable ID (`Request ID`, `Deployment ID`) when one exists.
- `Couldn't …` / `Can't …` — user-state or validation failure (bad input,
  missing permission, conflicting state). Don't attach internal IDs to these —
  they leak structure across tenant boundaries and don't help the user.

Never:

- dump a stack trace unless `--debug` is set
- print the raw upstream JSON / error object — translate it into your tool's
  voice
- write `An error occurred` or `Something went wrong` as the only line

## Dangerous Actions

A mutation is *dangerous* if it deletes data, rewrites production, rotates
secrets, or makes a billing/permission change. Extra rules apply:

- **`--yes` and `--force` are not synonyms.** `--yes` accepts low-risk defaults
  (skip a confirmation prompt). `--force` re-runs/overwrites something that's
  already there. Don't conflate them.
- **TTY: typed confirmation.** A y/N prompt isn't enough. Make the user type the
  resource name to proceed:

  ```text
  Type the project name to confirm deletion: _
  ```

  Default the y/N fallback to **No** (`y/N`), never `Y/n`.
- **Non-interactive: a dedicated proof flag.** `--yes` alone must not delete a
  project. Require something specific like `--confirm-name <name>` whose value
  matches the resource. This stops "agent passed `--yes` blindly" from turning
  into data loss.
- **Distinguish no-op from completed.** If the resource was already gone /
  already at the target state, say so explicitly (`! example.com is already
  removed.`) — don't print a fake success row.

## Exit Codes

argc handles most of this for you, but the convention to follow:

- `0` — success
- `1` — operational failure (network, validation, remote refused, mutation rolled back)
- `2` — usage error (unknown flag, malformed `--input`, missing required arg)

Don't invent more codes for one-off cases. An agent only looks at success vs.
not-success; richer state belongs in the YAML summary or `$hints`.
