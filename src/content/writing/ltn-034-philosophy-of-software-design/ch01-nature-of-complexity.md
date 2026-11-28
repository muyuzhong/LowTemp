---
id: LTN-034-01
seriesOf: LTN-034
chapter: 1
chapterLabel: "CH.01"
title: "复杂度的本质与“战术龙卷风”的算力通胀"
subtitle: "读第 1–3 章：复杂度的三大症状、两大根因，以及为什么大模型天生是一台每秒百 Token 的战术龙卷风"
category: engineering
status: exploring
confidence: 中高
scope: 软件设计 / AI 工程
tags: [software-design, complexity, ai-coding, refactoring]
published: 2026-11-28
excerpt: "《软件设计哲学》开篇将复杂度拆解为“依赖”与“模糊性”，并批判了只求跑通当下的“战术编程”。当我们把这套视角投射到 AI Coding 现场会发现：大模型天生就是一台拥有无限算力的“战术龙卷风”，而代码的认知负荷正直接转化为 Agent 的上下文腐烂（Context Rot）。"
tempLog:
  - { date: 2026-11-28, status: exploring }
notes:
  - { anchor: "Tactical Tornado", text: "书中第 3 章经典概念“战术龙卷风”：指那些产出速度极快、用大量临时拼凑把功能跑通，却在身后留下一地烂摊子让队友擦屁股的程序员。" }
  - { anchor: "增量复杂度", text: "Ousterhout 强调复杂度从来不是由某一个致命错误造成的，而是由成百上千个看似无害的微小妥协累加而成。" }
---

翻开《软件设计哲学》的前三章（*第 1 章 绪论*、*第 2 章 复杂度的本质*、*第 3 章 能跑的代码是不够的*），John Ousterhout 并没有急着抛出任何一条具体的代码规范，而是先给所有软件工程下了一个极其冷酷的判词：

> 编写软件最大的限制，不是计算机的硬件性能，而是**人类理解自己所创造系统的能力**。

在手写代码的年代，这句话听起来像一句温和的劝诫；但在经历了一年多与 Coding Agent 高强度贴身协作、亲眼看着几个代码库如何在几天之内膨胀成难以直视的“AI Slop”（见 [LTN-033](/writing/ltn-033-ai-coding-quality/)）之后，重读这前三章，几乎每一段话都能在当下的 AI 开发流里找到惊人的对应物。

---

## 一、重新理解复杂度公式：当代码的“第一读者”变成了 Agent

在第 2 章开头，Ousterhout 给出了全书对<strong>复杂度（Complexity）</strong>的核心定义：

> 复杂度是与软件系统结构相关的、使系统难以理解和修改的一切因素。

紧接着，他给出了一个非常符合直觉的加权公式——系统的总体复杂度 `C`，等于每个部分 `p` 的局部复杂度 `c_p` 乘以开发者在该部分上花费的时间比例 `t_p`：

```text
C = Σ (c_p × t_p)
```

这个公式揭示了一个至关重要的工程事实：<strong>一个模块写得多复杂并不完全致命，致命的是它既复杂、又暴露在所有人都必须频繁触碰和阅读的热路径（高 `t_p`）上</strong>。反过来说，如果你能把一段极其复杂的底层逻辑死死封锁在一个几乎不需要别人翻开的黑盒里（令 `t_p → 0`），那么它在系统层面的有效复杂度就趋近于零。

在 AI Coding 时代，这个公式里的 `t_p` 有了一个全新的物理度量衡：**上下文 Token 曝光率**。

在过去，`t_p` 只代表人类程序员花在阅读和修改模块 `p` 上的工时；而在今天，每当你让 Coding Agent 去排查一个 Bug 或开发一个新特性时，Agent 需要在代码库里做 `grep`、读文件、顺着调用链往上下文窗口里装载代码。

<div class="note idea">
<div class="note-label">CORE IDEA</div>

在 AI 时代，代码的“读者”是一个二元体：**人类审查者的大脑工作记忆** + **Coding Agent 有限的上下文窗口**。

Ousterhout 公式里的权重 `t_p`，在今天直接对应某个模块被读入 Agent 上下文窗口的频次与体积。把复杂度隔离在低 `t_p` 的黑盒里，不仅是在给人类减负，更是在给 Agent 节省宝贵的注意力预算。

</div>

---

## 二、复杂度的三大症状与两大根因：AI Slop 的病理切片

很多人看 AI 写出的烂代码，第一直觉是觉得它“啰嗦”或者“不优雅”。但“不优雅”是一个无法用来做 Code Review 的主观形容词。Ousterhout 在第 2 章里把复杂度拆解成了**三个可观测的外部症状**与**两个底层根因**，恰好为我们提供了一把极其锋利的解剖刀。

### 1. 复杂度的三大症状在 AI 现场如何爆发？

1. <strong>变更放大（Change Amplification）</strong>：
   一个看似简单的需求改动，却需要在散落各处的十几个文件里同步修改代码。
   - **AI 现场映射**：大模型其实非常擅长做机械的多文件批量修改，这反而掩盖了“变更放大”的恶臭——在古法编程时代，改一个字段要联动改 8 个文件，人敲键盘敲到第 3 个文件就会觉得烦躁并停下来重构；而 Agent 可以在 10 秒内毫无怨言地帮你改完 7 个文件，然后**悄无声息地漏掉第 8 个文件**，直接留下一颗运行时才炸的隐蔽暗雷。
2. <strong>认知负荷（Cognitive Load）</strong>：
   开发者为了安全地完成一次修改，脑子里必须同时装下多少背景知识。Ousterhout 特别指出：**有时候用更少的代码行数写成的小聪明代码，反而比多写几行但逻辑直白的代码带来更高的认知负荷。**
   - **AI 现场映射**：对人类而言，高认知负荷会直接诱发我在 [LTN-033](/writing/ltn-033-ai-coding-quality/) 中所说的<strong>“认知投降”</strong>——当你打开 PR 看到模型改了 1,200 行、牵扯到五六个状态机时，人脑瞬间过载，只能闭着眼睛点 Approve；而对 Agent 而言，高认知负荷的直接后果就是 <strong>[LTN-023](/writing/ltn-023-context-rot/) 讨论过的上下文腐烂（Context Rot）</strong>——为了改一行逻辑，Agent 被迫把十几个关联文件共两万 Token 的代码读进上下文，注意力被中间噪声严重稀释，开始遗忘最初在 `AGENTS.md` 里定下的架构红线。
3. <strong>未知的未知（Unknown Unknowns，最危险的症状）</strong>：
   你必须修改某段代码，或者必须遵守某个隐性不变量，但**代码库里没有任何线索告诉你这件事的存在**，直到上线炸锅你才知道。
   - **AI 现场映射**：这是所有 Coding Agent 的绝对死穴。人类老员工还可能靠“当年喝咖啡时听前任提过一嘴”的部落记忆避坑；而每次新开会话（Fresh Context）的 Agent 只有代码现场这一份输入。如果系统里存在“改了 A 处配置必须手动重置 B 处缓存，但两者之间没有任何显式类型或接口约束”的隐性约定，Agent 踩雷的概率是 100%。

### 2. 两大底层根因：依赖（Dependencies）与模糊性（Obscurity）

为什么会出现上面三个症状？书中归结为两个根因：
- <strong>依赖（Dependencies）</strong>：一段代码无法被独立理解和修改，必须牵扯其他代码（直接导致**变更放大**与高**认知负荷**）；
- <strong>模糊性（Obscurity）</strong>：重要的信息在代码和设计中并不明显（直接导致**未知的未知**与高**认知负荷**）。

<figure class="fig" data-no-focus>
<div class="fig-scroll">
<svg viewBox="0 0 720 264" role="img" aria-label="Ousterhout 复杂度两大根因、三大症状与 AI Coding 失效模式的映射图">
<defs><marker id="f1-ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path class="ah" d="M1 1.5 L8 5 L1 8.5"/></marker></defs>
<text x="0" y="16" class="t0 b">1 · 两大底层根因</text>
<text x="236" y="16" class="t0 b">2 · 三大表征症状（Ousterhout）</text>
<text x="488" y="16" class="t0 b">3 · AI Coding 现场崩塌形态</text>
<rect class="bx sa" x="0.5" y="34.5" width="184" height="86" rx="5"/>
<rect class="bar-a" x="0.5" y="34.5" width="3" height="86"/>
<text x="16" y="58" class="t0 b">依赖（Dependencies）</text>
<text x="16" y="78" class="s t2">代码无法被孤立理解或修改，</text>
<text x="16" y="96" class="s t2">跨文件/跨模块隐式耦合</text>
<rect class="bx sb" x="0.5" y="148.5" width="184" height="86" rx="5"/>
<rect class="bar-b" x="0.5" y="148.5" width="3" height="86"/>
<text x="16" y="172" class="t0 b">模糊性（Obscurity）</text>
<text x="16" y="192" class="s t2">关键契约、副作用与不变量</text>
<text x="16" y="210" class="s t2">无法从接口与命名直接看出</text>
<path class="ln sa" d="M185 62 L232 56" marker-end="url(#f1-ar)"/>
<path class="ln sa" d="M185 88 L232 128" marker-end="url(#f1-ar)"/>
<path class="ln sb" d="M185 174 L232 140" marker-end="url(#f1-ar)"/>
<path class="ln sb" d="M185 202 L232 212" marker-end="url(#f1-ar)"/>
<rect class="bx" x="234.5" y="30.5" width="204" height="54" rx="5"/>
<text x="248" y="53" class="t0 b">① 变更放大</text>
<text x="248" y="71" class="s t2">Change Amplification</text>
<rect class="bx" x="234.5" y="106.5" width="204" height="54" rx="5"/>
<text x="248" y="129" class="t0 b">② 认知负荷过高</text>
<text x="248" y="147" class="s t2">Cognitive Load</text>
<rect class="bx sr" x="234.5" y="182.5" width="204" height="54" rx="5"/>
<text x="248" y="205" class="cr b">③ 未知的未知</text>
<text x="248" y="223" class="s t2">Unknown Unknowns</text>
<path class="ln" d="M439 57 H484" marker-end="url(#f1-ar)"/>
<path class="ln" d="M439 133 H484" marker-end="url(#f1-ar)"/>
<path class="ln sr" d="M439 209 H484" marker-end="url(#f1-ar)"/>
<rect class="bx" x="486.5" y="30.5" width="233" height="54" rx="5"/>
<text x="500" y="52" class="t0 b">Agent 批量改 7 处漏第 8 处</text>
<text x="500" y="70" class="s t2">多 Agent 并行写触发隐性冲突</text>
<rect class="bx sa" x="486.5" y="106.5" width="233" height="54" rx="5"/>
<text x="500" y="128" class="ca b">Context Rot + 人类认知投降</text>
<text x="500" y="146" class="s t2">翻阅十几个文件耗尽注意力预算</text>
<rect class="bx sr" x="486.5" y="182.5" width="233" height="54" rx="5"/>
<text x="500" y="204" class="cr b">新会话 Agent 100% 踩中隐性雷</text>
<text x="500" y="222" class="s t2">只能靠叠打防御补丁掩盖症状</text>
</svg>
</div>
<figcaption><b>图 1</b>《软件设计哲学》第 2 章复杂度病理链条在 AI 时代的投影。底层“依赖”与“模糊性”通过三大症状传导，最终在 AI 协作中演变为漏改暗雷、上下文腐烂（Context Rot）与补丁堆叠。</figcaption>
</figure>

---

## 三、第 3 章的暴击：大模型天生是一台每秒百 Token 的“战术龙卷风”

如果说前两章是在建立概念，那么读到第 3 章 *《能跑的代码是不够的（Working Code Isn't Enough）》* 时，我几乎有一种被正面击中的感觉。

Ousterhout 在这一章里对比了两种截然不同的编程心态：
- <strong>战术编程（Tactical Programming）</strong>：核心注意力放在“怎么让眼前的需求或 Bug 尽快跑通”。只要测试变绿、功能交付，任务就算完成；至于为了跑通顺手加的那两个全局标志位、多嵌的那一层特殊分支，总是安慰自己“以后有空再重构”。
- <strong>战略编程（Strategic Programming）</strong>：认识到“代码能跑”只是最低门槛，核心目标是**产出一个干净、可长期演进的系统设计**。哪怕眼前多花 10%~20% 的时间去理顺抽象，也绝不为了赶进度往系统里倾倒未来难以清理的复杂度垃圾。

接着，Ousterhout 刻画了一个每个研发团队都见过的典型人物——<strong>“战术龙卷风（Tactical Tornado）”</strong>：

> 几乎每个组织里都有至少一个极端的战术程序员，我们称之为“战术龙卷风”。他们产出代码的速度远超常人，任何功能都能在极短时间内给你拼凑出来，因此甚至常常被管理层当作高产英雄；但在他们身后，留下的是一地支离破碎的补丁与隐性耦合，所有后续接手维护的工程师都要为他们擦屁股。

读到这里停下来想一想：<strong>今天我们每天在终端和 IDE 里调用的 Coding Agent，不就是一台被强化学习训练出来的、每秒能吐出上百 Token 的超级“战术龙卷风”吗？</strong>

这不是模型“笨”，而是由大模型的训练目标与交互范式在底层决定的：

1. <strong>奖励函数的“近视性（Myopia）”</strong>：
   目前主流代码模型在后训练（Post-Training / RLVR）阶段，核心奖励信号大多来自“生成的补丁能否让当前失败的单元测试变绿（如 SWE-bench）”。在强化学习的激励下，模型最稳妥的得分策略，就是<strong>沿着阻力最小的路径（Path of Least Resistance）打一个局部补丁</strong>，绝不去动底层的数据结构或抽象边界——因为动底层结构改动面大，短期挂掉其他单测的风险高；而在原函数末尾加一个 `if (specialCase)` 特判，最容易立刻让当前测试变绿。
2. <strong>会话无状态导致的“零长期痛感”</strong>：
   人类程序员哪怕再倾向于战术编程，想到下个月还是自己来维护这坨代码，心里多少还会有一点忌惮；而每次被唤醒的 Agent 会话是一个没有长期痛感的临时工——它只对当前这一轮 Prompt 负责，只要在这一轮交付时给你端出一份“Working Code”，它就会在结束时关闭会话，把所有增量复杂度留给代码库和下一个会话。

<div class="note failed">
<div class="note-label">FAILED ATTEMPT / 01 · 放任“AI 战术龙卷风”自由修 Bug</div>

在 [LTN-033](/writing/ltn-033-ai-coding-quality/) 提到的 Seamline（断点续传流式代理）开发早期，我曾犯过一个典型的错误：当发现“消息型游标”在遇到大模型输出半截工具调用 JSON 时会解析崩溃，我直接把报错堆栈丢给 Agent 说“修好它”。

Agent 完美演绎了什么是“战术龙卷风”：它没有去质疑“消息型游标本身是否适合原生流式传输”，而是在消息拼接逻辑外面专门套了一层正则与括号配对补丁来兜底半截 JSON，并在 30 秒内让报错消失了。紧接着遇到多路工具调用交错，它又开始准备往外砌第二层状态补丁——如果当时没有人工强行叫停，整个传输核心在三天之内就会被这台“战术龙卷风”砌成一座谁也拆不动的补丁危楼。

</div>

---

## 四、基于第 1–3 章，我们在 AI 时代该如何落地“战略编程”？

看清了“大模型天生是战术龙卷风”，很多人的第一反应是走向另一个极端：既然模型喜欢临时打补丁，那我在写第一行代码之前，先花两天时间和模型写出几万字的完美 Spec 文档，不就是“战略编程”了吗？

我在 [LTN-033](/writing/ltn-033-ai-coding-quality/) 里已经证伪过这种做法：在你还没有亲手踩过领域坑之前，对着空白文档憋出来的宏大 Spec 只是一种自我感动，你根本不知道真正的 Trade-off 藏在哪里。

其实仔细读 Ousterhout 的第 3 章就会发现，他推崇的<strong>战略编程（Strategic Programming）</strong>，从来不是“瀑布式地预先憋出全套完美图纸”，而是**将 10%~20% 的设计投资，切碎并持续注入到每一次日常开发与重构迭代中**。

结合前三章的思想，我把 AI 时代的“战略编程”收敛为三条立即可用的工程纪律：

<div class="note decision">
<div class="note-label">ENGINEERING DECISION // AI 时代的战略编程三原则</div>

1. <strong>用“战术速度”探路，用“战略重构”落盘（分离探路态与入库态）</strong>：
   充分利用 AI 战术龙卷风的高速度去跑通第一版粗糙原型——但**绝不把第一版跑通的原型当成交付物**。原型跑通的唯一目的，是帮我们把第 2 章里最可怕的“未知的未知（Unknown Unknowns）”逼出来；一旦看清了真正的冲突点，立刻切回战略模式，对代码做减脂、抽离底层抽象，必要时推倒重写。
2. <strong>禁止 Agent 在同一抽象层连续打两次补丁（对应“只复审一次”熔断律）</strong>：
   Ousterhout 指出，复杂度是由几百个微小妥协累加出来的。当 Agent 为了修一个 Bug 往原有函数里塞特殊 `if` 分支或额外包装层时，如果一次修改没按住、或者明显增加了跨文件依赖（Dependencies）与模糊性（Obscurity），立刻触发熔断。要求它退回上一层，重新审视数据结构和模块边界，而不是继续往上糊补丁。
3. <strong>把“是否降低了 `c_p × t_p`”作为 Code Review 的唯一硬标尺</strong>：
   不再用“代码能不能跑”作为验收终点。每次合并前只问三个问题：这次改动有没有让别人（以及下一轮 Agent）调用它时需要知道更多内部细节（提升了 `t_p`）？有没有引入跨模块的隐式耦合（增加了 Dependencies）？有没有把本该在底层消解的复杂度推给了调用方？

</div>

<div class="note open">
<div class="note-label">OPEN QUESTION</div>

当团队里每个人都握着一台每秒百 Token 的 AI 战术龙卷风时，组织层面的考核依然偏向“功能交付速度（能跑的代码）”。除了靠工程师个人的审美与克制外，我们能否在 CI 或 Agent Harness（如 [LAB-003](/projects/#lab-003)）中设计出可量化的“增量复杂度阻尼器”，在 PR 阶段自动拦截那些虽然测试全绿、但显著恶化了模块依赖与认知负荷的提交？

</div>

---

### 本章读书小结与下一章预告

读完前 3 章，最核心的收获是把心里对“AI Slop”那种模糊的厌恶感，落成了清晰的工程坐标系：<strong>依赖（Dependencies）+ 模糊性（Obscurity）→ 变更放大 + 认知负荷 + 未知的未知</strong>；而应对之道，是管住手里这台“AI 战术龙卷风”，把省下来的敲键盘时间抽出 20% 投进持续的战略设计里。

那么，具体到代码结构上，什么样的模块才算“战略级的好设计”？在接下来的第 4–7 章里，Ousterhout 将祭出全书最核心的架构武器——<strong>深模块（Deep Modules）与信息隐藏</strong>。读完那几章后，我们再来聊聊为什么“深模块”恰好是 Coding Agent 最理想的上下文防火墙。
