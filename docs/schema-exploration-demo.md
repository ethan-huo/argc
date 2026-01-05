# Schema Exploration Demo (examples/demo.ts)

This document explores proposed `--schema` behavior for agents using the schema in `examples/demo.ts`.
It assumes:
- `--schema` stays as-is when output <= `maxLines` (default 100).
- If output > `maxLines`, `--schema` prints a compact outline + hints.
- `--schema=<selector>` uses jq-like selectors and returns one level under the selected node.
- `--schema=<selector>` can target a command node to get the full type declaration for that command.

---

## Behavior A: naive agent runs root schema

Command:

```bash
$ demo --schema
```

Proposed output (compact DSL outline + hints):

```
Schema too large (estimated 150+ lines). Showing compact outline.

user{list,create}
config{get,set,connect,reset,debug,clear}
db{migrate,seed}
deploy{aws{lambda,s3},vercel}

hint: use --schema=.user
hint: use --schema=.deploy.aws
hint: use --schema=.user.create
```

Notes:
- This outline is intentionally single-line per group to keep line count low.
- Hidden commands (e.g. `config.debug`) are still shown here (current behavior).

---

## Behavior B: agent explores a group (one level)

Command:

```bash
$ demo --schema=.user
```

Proposed output (one level under `user`):

```
CLI Syntax:
  arrays:  --tag a --tag b             → tag: ["a", "b"]
  objects: --user.name x --user.age 1  → user: { name: "x", age: 1 }

type Demo = {
  // User management commands
  user: {
    // List all users
    list(all?: boolean = false, format?: "json" | "table" = "table")
    // Create a new user
    // $ demo user create --name john --email john@example.com
    // $ demo user create --name john --tags admin --tags dev
    create(name: string, email?: string, tags?: string[] = [])
  }
}
```

---

## Behavior C: agent requests full type for a command

Command:

```bash
$ demo --schema=.user.create
```

Proposed output (full decl for the command path):

```
CLI Syntax:
  arrays:  --tag a --tag b             → tag: ["a", "b"]
  objects: --user.name x --user.age 1  → user: { name: "x", age: 1 }

type Demo = {
  // User management commands
  user: {
    // Create a new user
    // $ demo user create --name john --email john@example.com
    // $ demo user create --name john --tags admin --tags dev
    create(name: string, email?: string, tags?: string[] = [])
  }
}
```

---

## Behavior D: agent explores a deeper group

Command:

```bash
$ demo --schema=.deploy
```

Proposed output (one level under `deploy`):

```
CLI Syntax:
  arrays:  --tag a --tag b             → tag: ["a", "b"]
  objects: --user.name x --user.age 1  → user: { name: "x", age: 1 }

type Demo = {
  // Deployment commands
  deploy: {
    // AWS deployment
    aws: {
      // Deploy to AWS Lambda
      lambda(region?: "us-east-1" | "us-west-2" | "eu-west-1" = "us-east-1", memory?: number = 512)
      // Deploy to S3
      s3(bucket: string, prefix?: string = "/")
    }
    // Deploy to Vercel
    vercel(prod?: boolean = false)
  }
}
```

---

## Behavior E: agent uses selector sets for quick compare

Command:

```bash
$ demo --schema=.config.{get,set}
```

Proposed output (subset under `config`):

```
CLI Syntax:
  arrays:  --tag a --tag b             → tag: ["a", "b"]
  objects: --user.name x --user.age 1  → user: { name: "x", age: 1 }

type Demo = {
  // Configuration management
  config: {
    // Get a config value
    // $ demo config get DATABASE_URL
    // $ demo config g API_KEY
    get(key: string)
    // Set a config value
    set(key: string, value: string)
  }
}
```

---

## Behavior F: agent explores a leaf command with nested input

Command:

```bash
$ demo --schema=.config.connect
```

Proposed output:

```
CLI Syntax:
  arrays:  --tag a --tag b             → tag: ["a", "b"]
  objects: --user.name x --user.age 1  → user: { name: "x", age: 1 }

type Demo = {
  // Configuration management
  config: {
    // Connect to database
    // $ demo config connect --db.host localhost --db.port 5432 --db.name mydb
    connect(db: { host: string, port: number, name: string })
  }
}
```

---

## Behavior G: agent drills down on db commands

Command:

```bash
$ demo --schema=.db
```

Proposed output:

```
CLI Syntax:
  arrays:  --tag a --tag b             → tag: ["a", "b"]
  objects: --user.name x --user.age 1  → user: { name: "x", age: 1 }

type Demo = {
  // Database operations
  db: {
    // Run database migrations
    // $ demo db migrate --step 1
    // $ demo db migrate --dry-run
    migrate(step?: number = 1, dryRun?: boolean = false)
    // Seed the database
    seed(file: string, truncate?: boolean = false)
  }
}
```

---

## Notes for review

- The examples above assume selector output is still in TS-like format and scoped to the selected node.
- The compact DSL outline is optimized for low line count and low width to avoid tool truncation.
- If a selector matches multiple branches, output includes only those branches (no unrelated siblings).

