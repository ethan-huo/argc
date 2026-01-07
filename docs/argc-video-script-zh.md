# argc 介绍视频：中文大纲与脚本

> 目标：面向开发者与 AI/agent 用户，先讲“人类/开发者”的使用方式，再讲“agent 友好”的 schema/selector 体系。
> 时长建议：10–15 分钟（可按需裁剪）。

---

## 一、视频结构大纲

1. 开场（30s）
   - 一句话定义：Schema-first CLI for agents
   - 为什么做 argc：CLI 不只是给人用，更要给 agent 用

2. 基本使用（3–5min）
   - 安装与最小示例
   - `c.input(...)` + `cli(schema)` + `app.run()`
   - 示例：参数解析、默认值、数组、嵌套对象

3. 设计理念（1–2min）
   - Schema-first：schema 即 CLI 定义
   - 类型 & 运行时校验一体化
   - 可生成 AI-friendly `--schema`

4. Agent 使用（核心，5–7min）
   - `--schema` 输出与逐级探索
   - selector 语法（jq-like）：`.a.b`、`*`、`{a,b}`、`..name`
   - large.ts 演示：如何用 selector 找到目标命令
   - `--input` JSON 输入（string / stdin / @file）
   - `--input` 摘要显示规则

5. 结尾（30s）
   - 适用场景（agent 自动化/脚本化/复杂工具集）
   - 下一步：欢迎试用/贡献/反馈

---

## 二、视频脚本（中文口播稿）

### 1) 开场（30s）

大家好，今天介绍一个为 agent 设计的命令行框架：**argc**。
一句话概括：**Schema-first CLI**——你定义一个 schema，就同时得到类型安全的 handler、参数校验，以及 agent 可以理解的 `--schema` 输出。
传统 CLI 更多是为人类设计，而 argc 直接把 agent 当成第一用户。

---

### 2) 基本使用（3–5min）

先看最小示例：

```ts
import { toStandardJsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'
import { c, cli } from 'argc'

const s = toStandardJsonSchema

const schema = {
  greet: c
    .meta({ description: 'Greet someone' })
    .input(s(v.object({
      name: v.string(),
      loud: v.optional(v.boolean(), false),
    }))),
}

cli(schema, { name: 'hello', version: '1.0.0' }).run({
  handlers: {
    greet: ({ input }) => {
      const msg = `Hello, ${input.name}!`
      console.log(input.loud ? msg.toUpperCase() : msg)
    },
  },
})
```

调用方式：

```
hello greet --name World --loud
```

argc 会自动：
- 解析参数
- 应用默认值
- 进行类型校验
- 在 handler 里拿到强类型输入

它支持数组参数，比如：

```
--tags a --tags b
```

也支持嵌套对象：

```
--db.host localhost --db.port 5432
```

---

### 3) 设计理念（1–2min）

argc 的核心是 **Schema-first**。
Schema 不是文档，而是命令本身：
- schema 决定了 CLI 的参数结构
- schema 决定了输入校验
- schema 还能生成 AI-friendly 输出

这意味着你不需要写两套系统：一套给人用、一套给 AI 用。

---

### 4) Agent 使用（核心，5–7min）

这里是 argc 的重点：**让 agent 探索和使用 CLI**。

#### 4.1 `--schema` 输出
直接运行：

```
cli --schema
```

会输出 TypeScript-like 的类型声明，让 agent 读懂整个 CLI。

如果命令太多，`--schema` 会自动切换成 compact outline：

```
compute{alpha{list,get,create,update,delete},...}
storage{...}
```

并提示你用 selector 深入探索。

#### 4.2 selector 语法（jq-like）
selector 是 jq 风格的路径语法，用来逐级探索命令树：

- `.a.b` 路径
- `.a.*` 一层通配
- `.a.{b,c}` 多选
- `..name` 递归下降

比如：

```
--schema=.compute
--schema=.compute.alpha
--schema=..create
```

这样 agent 就能像“浏览文件夹”一样逐级探索。

#### 4.3 用 large.ts 演示
我们看 `examples/large.ts`，这里有 120 个命令，模拟复杂 CLI：

```
bun examples/large.ts --schema
```

输出是 compact outline。
然后我们逐级探索：

```
bun examples/large.ts --schema=.compute
bun examples/large.ts --schema=.compute.alpha
```

再定位到具体命令：

```
bun examples/large.ts --schema=.compute.alpha.create
```

这个过程非常 agent-friendly。

#### 4.4 JSON 输入（--input）
agent 往往会生成 JSON，argc 支持直接输入：

```
cli user set --input '{"name":"alice","role":"admin"}'
```

也支持 stdin：

```
echo '{"name":"alice"}' | cli user set --input
```

还可以从文件读取：

```
cli user set --input @payload.json
```

注意：使用 `--input` 时，不能再混用其他 flags/positionals。

#### 4.5 Input 摘要显示
在 `-h` 里，Input 会显示“顶层摘要”，比如：

```
Input:
  --input <{ user: string, role?: enum, tags?: string[] }>
```

- key 不会丢
- value 会压缩（object → object，枚举 → enum）

这保证 agent 看到的是“结构摘要”，而不是完整细节。

---

### 5) 结尾（30s）

总结一下：
- argc 把 CLI 设计成 schema-first
- 对开发者友好，对 agent 更友好
- `--schema` + selector 让 agent 可以逐级探索复杂工具集
- `--input` 让 agent 能直接执行 JSON 任务

如果你想构建大型、agent-friendly 的工具集，argc 是一个很实用的选择。

感谢观看。

---

## 三、演示命令清单（便于录屏）

```bash
# 基本 schema 输出
bun examples/large.ts --schema

# 逐级探索
bun examples/large.ts --schema=.compute
bun examples/large.ts --schema=.compute.alpha
bun examples/large.ts --schema=.compute.alpha.create

# 递归下降
bun examples/large.ts --schema=..create

# JSON 输入
bun examples/large.ts compute alpha create --input '{"name":"x","region":"us-east-1"}'

echo '{"name":"x"}' | bun examples/large.ts compute alpha create --input

bun examples/large.ts compute alpha create --input @payload.json
```
