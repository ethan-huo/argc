# argc 7 中文介绍稿

argc 7 是一次 breaking redesign：它把 CLI 入口收敛为 path command + one
structured input token。不要再讲 v1 的 flags、positionals、`--input` 或
`--schema`。

## 结构

1. 开场：argc 是为 agent 设计的 schema-first CLI。
2. 最小示例：`c.input(...)`、`cli(commands)`、handler return value。
3. 调用模型：`tool user.create "{ name: 'alice' }"`、`@file`、`-`。
4. Agent 合同：`@schema`、`@run`、`@completions`。
5. 输出合同：return value 到 stdout；日志和进度到 stderr；默认 YAML。

## 示例

```typescript
import { toStandardJsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'
import { c, cli } from 'argc'

const s = toStandardJsonSchema

const commands = {
	greet: c
		.meta({
			description: 'Greet someone',
			examples: ['hello greet "{ name: \'World\', loud: true }"'],
		})
		.input(
			s(
				v.object({
					name: v.string(),
					loud: v.optional(v.boolean(), false),
				}),
			),
		),
}

await cli(commands, { name: 'hello', version: '7.0.0' }).run({
	handlers: {
		greet: ({ input }) => ({
			message: input.loud ? `HELLO, ${input.name}!` : `Hello, ${input.name}!`,
		}),
	},
})
```

调用：

```bash
hello greet "{ name: 'World', loud: true }"
```

输出：

```yaml
message: HELLO, World!
```

## Agent 段落

`@schema` 是 agent 的入口：

```bash
hello @schema
hello @schema .greet
hello @schema .greet.input
```

复杂输入直接传对象字面量：

```bash
tool deploy "{ target: 'prod', tags: ['api'], db: { host: 'localhost', port: 5432 } }"
tool deploy @payload.json
printf "{ target: 'prod' }" | tool deploy -
```

`@run` 用来让 agent 编排多个命令：

```bash
tool @run "const user = await user.create({ name: 'alice' }); user" --json
```

核心收束句：argc 7 不再把 shell flags 伪装成类型系统。shell 只负责定位
命令和传递一个结构化值；schema 负责验证，handler 负责返回结果。
