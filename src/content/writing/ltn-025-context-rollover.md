---
id: LTN-025
title: 上下文换窗：工作记忆与持久层的解耦
subtitle: 从 Codex 的 new_context 到长程 Agent 的控制流重构
category: research
status: tested
temperature: 7.4
confidence: 高
scope: 上下文工程
tags: [context, agent, codex, engineering, llm]
published: 2026-09-04
updated: 2026-10-18
excerpt: 当上下文被稀释到临界点，传统的压缩摘要试图把历史压成浓缩液，却常把噪声和推断固化成事实。换窗（Rollover）提供了一条相反的路径：重置活动窗口，只留证据分级的交接备忘录，把全量历史退回持久取证层。
minutes: 22
featured: true
tempLog:
  - { date: 2026-09-04, status: draft }
  - { date: 2026-09-04, status: exploring }
  - { date: 2026-10-18, status: tested }
notes:
  - { anchor: "误判固化", text: "换窗机制本身没有丢信息，它忠实地把错误推断也继承下来了——这直接催生了四分栏证据分级。" }
  - { anchor: "锚点设计", text: "不需要在架构里新造 window_id，canonical session_id + message_uuid 就是天然的时空坐标。" }
  - { anchor: "Prompt Cache", text: "换窗打断了 KV Cache 前缀，在 API 计费上是一次冷启动。但长程任务中绝对 Token 的腰斩完全能覆盖这点损失。" }
---

在 [LTN-023](/writing/ltn-023-context-rot) 里我提过一个判断：**上下文不是被用完的，是被稀释的。**

当一个长程 Agent 在复杂的代码库中探索，几十轮工具调用、编译器输出、Git Diff 和终端报错会迅速填满上下文窗口。过去一年，工程界的主流应对方案高度趋同：**压缩摘要（Compaction）**——当窗口使用率达到 80%，让模型或后台小模型将历史概括成一段 Markdown Summary，丢弃原始消息，在同一段上下文里带着摘要继续执行。

这套容量驱动的方案在真实任务中常常暴露出严重的系统性退化。摘要是一种不可逆的有损压缩；更致命的是，它重构了模型的注意力地形，把早期的模糊推断固化为既定事实。

近期从 OpenAI Codex 的 `new_context` 实现，到开源社区基于 Obelisk 打造的 DSH 上下文换窗插件，展现了一条截然不同的控制流范式：**不做摘要的上下文换窗（Context Rollover）**。

<div class="note idea">
<div class="note-label">CORE IDEA</div>

把长程任务维持在高浓度的最好方式，不是在同一个容器里反复搅拌残渣，而是将「活动工作记忆（Active Working Memory）」与「持久取证底座（Forensic Substrate）」彻底解耦。

模型主动换窗，新窗口只继承一份面向未来的四分栏交接备忘录（Handoff）；旧历史完整归档至外部存储，缺细节时定点取证。

</div>

---

## 1. 压缩摘要的穷途：实测数据与结构性失效

为什么摘要压缩在 Coding Agent 场景下格外脆弱？

在软件工程中，真实状态是图结构的（文件依赖、调用链、环境状态），而不是线性的聊天历史。当窗口面临压力时，压缩摘要暴露了三个无法修补的缺陷：

### 1.1 细节不可逆丢失与注意力稀释
编译器报错中的具体行号、偶发网络超时的精确堆栈、第三方依赖库返回的特异参数，在经过摘要压缩后往往只剩下一句“某些测试未能通过”。这些细节一旦丢失，模型在后续窗口中就永远失去了对原初现场的感知，只能重新猜测。同时，摘要本身会随着轮次不断追加与再压缩（Accretion Bloat），体积从几千字符逐步膨胀到两万字符以上，注意力依然被严重稀释。

### 1.2 推断被固化为事实（Error Cascade）
这是破坏力最强的问题。模型在探索初期为了推进任务，往往会提出假设（例如：“该项目似乎缺少 X 环境变量”）。经过一次 Compaction 后，这个未经证实的推断被摘要提炼为 `Primary Request` 或“已确认架构”，下游的所有执行窗口便坚不可摧地沿着这个虚构的需求不断试错，陷入深度幻觉。

### 1.3 实测基准对照（A/B Pilot）

在针对同一个 200K 声明窗口、高难度复杂长程任务的对照实验中，Compaction 与 Rollover 的表现呈现出断层式的差距：

| 评估指标 | 压缩摘要（Compaction） | 上下文换窗（Rollover） | 差异幅度 |
| :--- | :--- | :--- | :--- |
| **总耗时** | 74.3 min | 57.6 min | **-22.5%** |
| **主 Session 执行步数** | 477 步 | 341 步 | **-28.5%** |
| **主 Session Provider Tokens** | 52.9 M | 26.8 M | **-49.4%** |
| **上下文边界触发次数** | 6 次摘要 | 6 次主动 Handoff | 持平 |
| **Fallback / 强制切窗次数** | — | 0 次 | 极其平稳 |
| **工具调用错误次数** | **8 次** | **0 次** | **彻底消除** |

数据显示，Compaction 组多消耗了近一倍的 Token 和 136 个步数，并且发生了 8 次工具调用错误。排查排查调用链后发现，这 8 次错误全部发生在上半场压缩之后——由于窗口中充斥着又长又混杂的陈旧摘要，模型的指令遵循能力与参数提取精度出现了明显衰退（Lost-in-the-middle）。

---

## 2. 架构转向：双平面解耦模型

换窗模式之所以能把 Token 消耗砍半并消除工具错误，其理论底座在于：**工作区本身在物理磁盘上，代码库才是第一真理源。**

Agent 不需要把所有探索过的代码都塞在记忆中，它只需要知道“下一步修改哪里”。因此，系统应该明确划分为两个平面：

```
+-------------------------------------------------------------------+
|  活动认知平面 (Active Surface / Working Memory)                   |
|  - 极低熵、超高信号浓度                                           |
|  - 仅包含: 基础 System Prompt + 本轮 Handoff + 关键相关文件指针   |
+-------------------------------------------------------------------+
                                  │
                  [ 触发 new_context 换窗交接 ]
                                  ▼
+-------------------------------------------------------------------+
|  持久取证平面 (Forensic Substrate / Durable Storage)              |
|  - 全量 Append-only Event Log / SQLite + FTS5 全文索引            |
|  - 拥有 canonical session_id 与 message_uuid                      |
|  - 仅在遇到特定疑难参数、特定崩溃现场时，提供单次定点回查能力      |
+-------------------------------------------------------------------+
```

### 锚点机制的减法：不造新抽象
在设计换窗存储时，容易下意识地给系统设计一套复杂的 `window_id`、`transition_id` 状态机。但这其实是多余的负担。

因为 UUID 在时间上是不可排序的，所谓的“Window 区间查询”是个伪概念。模型在物理上真正需要的时空锚点只有两个：
1. **`session_id`**：用于将检索范围严格限定在当前任务上下文内，防止全局召回污染；
2. **`message_uuid`**：指向触发换窗的那一条 Assistant 工具调用消息。

换窗后，新窗口收到的第一条消息长这样：

```markdown
Previous context is available in durable storage.
session_id: 20260904_task_engine_x9
message_uuid: msg_tool_call_new_context_8f12

<handoff>
[模型撰写的四分栏自然语言备忘录]
</handoff>

<related_files>
- src/core/budget.ts (implementation) - 预算阈值判断逻辑待修复
- tests/budget.test.ts (test) - 覆盖 hardLimit 溢出的单元测试
</related_files>
```

字段名完全对齐底层检索接口的入参。模型可见的上下文里没有任何多余的内部实现黑话，干净直接。

---

## 3. 换窗控制流的最小正确协议

如何把这套机制工程化落地？宿主（Host）不能只是机械地提供一个 `clear_screen()` 工具，而必须建立一套包含**三段预算、两阶段安全提交、与证据分级**的严密协议。

### 3.1 纯函数式的三段预算管理
不能放任模型凭感觉切窗，宿主必须依据实际 Token 计量建立三层驱动：

```ts
// 预算纯函数计算逻辑 (context-window-budget.ts)
export function evaluateBudget(state: BudgetState): BudgetAction {
  const hardLimit = state.contextWindow - state.outputReserveTokens;
  const baseLimit = hardLimit - state.fallbackReserveTokens;
  const remaining = baseLimit - state.currentTokens;

  // 1. 模型已主动完成交接
  if (state.explicitRolloverDeclared) return { type: 'rollover', reason: 'model' };

  // 2. 突破硬死线，触发宿主强制换窗（防死锁）
  if (state.currentTokens >= hardLimit) return { type: 'rollover', reason: 'hard-limit' };

  // 3. 突破基准预算且已经给过 Fallback 采样机会
  if (state.currentTokens >= baseLimit && state.fallbackClaimed) {
    return { type: 'rollover', reason: 'hard-limit' };
  }

  // 4. 突破基准预算，进入 Fallback 阶段（硬裁剪）
  if (state.currentTokens >= baseLimit) return { type: 'fallback' };

  // 5. 逼近临界点，单次注入提醒
  if (remaining <= state.reminderThreshold && !state.reminderClaimed) {
    return { type: 'remind' };
  }

  return { type: 'continue' };
}
```

* **Layer 1: Guidance（持续引导）**：System Prompt 中明确告知模型维护交接的责任。
* **Layer 2: Near-limit reminder（单次注入提醒）**：剩余 Token 触及阈值（如 15K）时，在最新一轮采样前插入一次性系统通知，提醒模型收尾并换窗。
* **Layer 3: Fallback reserve（宿主硬约束）**：当预算突破 `baseLimit`，宿主介入进行**工具面硬裁剪（Tool Surface Pruning）**——只给模型保留 `new_context` 工具（或底层通信 transport），并在执行层直接拦截其他任何操作。这是非常关键的工程决断：**不要指望 Prompt 软约束能拦住濒临溢出的模型，必须由宿主硬性剥夺其他工具的调用权。**

### 3.2 两阶段提交与安全边界（Pre-step Commit）
**永远不要在工具的 Handler 回调内部直接清空上下文。**

工具调用执行在 LLM 输出流（Stream）调度阶段。此时可能存在并行的兄弟工具调用（Parallel tool calls），或者流连接尚未收到最终完成信号。如果在工具执行体内直接操作历史，会造成上下文状态断裂。

正确的架构是两阶段机制：
1. **意图阶段（Intent Declaration）**：模型调用 `new_context`，Handler 仅校验参数，在持久事件流中追加一条意图标记，返回确认文本，**活动上下文保持原样**。
2. **提交阶段（Safety Boundary Commit）**：直到本轮所有工具执行 settled、下一次模型请求尚未派生历史的公开安全缝隙（`Pre-step` 钩子），宿主才执行物理替换：写入 Prune 扣账记录、注入 Replacement 消息、并 Flush 持久化。

```
[ 模型生成 Tool Call ] ──> Handler 仅写意图 ──> [ 并发工具全部执行完毕 ]
                                                          │
                                         [ Pre-step 安全边界 ]
                                                          │
                        物理替换 Surface 历史 <────────────┘
                                  │
                        [ 发起新窗口推理 ]
```

### 3.3 证据分级（Evidence Tiering）
如前所述，换窗机制忠实地保留了上下文，但如果不做约束，它同样会忠实地把错误认知代际传承。

为了解决这个问题，Handoff 必须建立四分栏证据契约：

```markdown
### 1. SPEC-CONFIRMED REQUIREMENTS (已确认规格事实)
- 用户明确提出或规范文件中写明的内容。每一项必须引用 user/spec/source。

### 2. AGENT INFERENCES (Agent 自身推断)
- 模型在排查过程中产生的假设或技术判断。
- 规则：严禁写为“已锁定设计”，也不允许因为跨窗口重复而自动升级为确认事实！

### 3. UNRESOLVED CONFLICTS (未决冲突)
- 当前遇到且尚未解决的代码断言崩溃或架构冲突。

### 4. UNVERIFIED ACCEPTANCE CRITERIA (未验证项)
- 下一步行动清单与尚未跑通的测试集。
```

同时，`related_files` 必须保持结构化数组，因为宿主需要负责对文件路径进行工作区合法性校验（防止逃逸），并原样沉淀文件角色（`spec` / `test` / `implementation`），而无需动用昂贵的 AST 去二次解析自然语言。

---

## 4. 认知盲区辩驳：模型不知道上一窗有什么，会不会陷入无谓翻查？

在评估这套系统时，一个极具杀伤力的架构质疑是：

> *“模型新窗口启动后，并不知道自己丢失了什么。如果它频繁调用历史检索工具却查不到东西（Tool Thrashing），难道不比带着一份粗糙的摘要直接重新跑一次命令更糟吗？”*

实测与工程推演给出的结论是：**新窗口模式不仅不会陷入空查，反而极大地规避了重跑带来的灾难。**

### 4.1 编程任务的第一真理源在磁盘，不在 Transcript
真人高级工程师在交接项目时，从不会通读前任所有的聊天记录。他们会看交接 Readme（Handoff），然后直接打开 IDE 查阅工作区文件、运行当前单元测试。

代码库是强状态系统。新窗口通过 `related_files` 拿到关键文件后，调用 `view_file` 看的是磁盘上的最新代码，调用 `run_command` 拿到的是最新的编译器反馈。**90% 以上的任务推进根本不需要触碰历史日志。**

### 4.2 “重新跑一次”的隐形代价极其致命
在单窗口压缩模式下，当细节丢失时，模型往往会试图“重新跑一遍构建”或“重新跑一次爬虫”。但真实工程的命令通常带有不可逆的副作用（Side Effects）：数据库 Migration 已被执行、测试容器端口冲突、Git 工作区残留脏文件。

更可怕的是，**重新运行产生的海量新日志，会瞬间再次撑爆刚刚压缩过的脆弱上下文**，立刻触发下一次压缩（Compaction Death Spiral）。这也是为什么在 Pilot 对照中，压缩组的 Token 消耗迅速失控翻倍。

### 4.3 检索防火墙：单次定向取证纪律
为了彻底防止模型陷入“盲目查历史”的怪圈，系统在 Prompt 和工具端设立了硬性防线：
* **针对性检索**：模型只在遇到具体、偶发的丢失信息时才允许回查（例如：“Handoff 中提到了一个特定的加密密钥，请在当前 session 历史中检索包含 `SECRET_KEY` 的消息”）；
* **快速失败原则（Fail-Fast）**：Prompt 明确规定，历史检索**单次未命中即判定为信息失效**，禁止遍历搜索历史，必须立刻退回到工作区通过最小可运行测试重新获取状态。

---

## 5. 还没想清楚的部分与工程权衡

<div class="note open">
<div class="note-label">OPEN QUESTION</div>

### 1. Prompt Cache（KV Cache）的经济学平衡
大模型 API 服务商（如 Anthropic、DeepSeek、OpenAI）对命中前缀缓存（Prompt Cache）的输入 Token 通常提供高达 75%~90% 的折扣。
连续对话虽然臃肿，但只要前缀不变，每一步的 Cache 命中率极高；而换窗操作会主动切断历史前缀，新窗口的第一轮请求必须支付一次全量的写入/冷启动成本。
虽然在 Pilot 中，换窗减少的绝对 Token 量（从 52.9M 降到 26.8M）完全压过了缓存折扣损失，但在任务较短或切窗过于频繁的边界场景下，两者是否存在一个微妙的成本平衡拐点？

### 2. 多代传递漂移（Multi-Generation Drift）
如果一个超长任务经历了 8 次甚至 15 次切窗，Handoff 就会经历类似“传话筒游戏（Chinese Whispers）”的代际更迭。
第四代模型撰写 Handoff 时，依据的是第三代留下来的备忘录，而非最原始的用户输入。随着代际增加，最初始的用户意图与特殊约束是否会发生隐式漂移？是否需要在每一个新窗口中，始终以只读方式置顶钉住最原始的 `Turn 1 User Spec`？

</div>

---

## 结语

在构建自主 Agent 的过程中，我们很容易陷入一种把模型当作神祇的误区，试图用不断膨胀的上下文窗口去包容一切历史。

但工程的本色从来都是克制。代码应该留在文件系统里，事件应该留在持久化日志里，而运行中的大模型，只需要一间保持低温、安静、光线充足的房间。

**在噪声退去之后，留在终端里的不应该是厚重的历史包袱，而应该是一个干净的窗口、一个明确的下一步，以及磁盘上已经改对的代码。**
