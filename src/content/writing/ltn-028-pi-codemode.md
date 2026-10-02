---
id: LTN-028
title: 聊聊 Pi 的 Codemode：为什么代码执行可能比工具调用更靠谱？
subtitle: 从“抵制 MCP”到端侧沙箱，长程 Agent 的上下文算术与工程思考
category: research
status: exploring
confidence: 高
scope: 上下文工程 / Agent 架构
tags: [pi, codemode, mcp, context, architecture, quickjs]
published: 2026-10-02
updated: 2026-10-02
excerpt: 过去大半年做 Coding Agent，我最头疼的就是工具输出把上下文窗口迅速搞脏。Pi 最近在 1.0 里推的 Codemode 给了我很大启发：它用一个内嵌的 QuickJS 沙箱，让模型写 JS 来调工具、做过滤，而不是每一步都在聊天上下文里来回倒腾。这篇文章记录我追踪这个设计的过程、背后的 Cache 账本算术，以及我看到的几个现实局限。
minutes: 20
featured: true
tempLog:
  - { date: 2026-10-02, status: exploring }
notes:
  - { anchor: "Cache 账本", text: "省下来的 Token 不是模型写字变少了，而是后面几十轮不用反复通读前面堆积的工具废话。" }
  - { anchor: "沙箱放哪", text: "把 QuickJS 放在 Agent 宿主侧而不是工作区，既不污染磁盘代码，又能安全跑完临时过滤逻辑。" }
  - { anchor: "MCP 的痛点", text: "很多 MCP 工具把输出做成好看的 Markdown，反而在程序化处理时成了灾难。" }
---

在 [LTN-023](/writing/ltn-023-context-rot) 里我写过一句话：**上下文不是被用完的，是被稀释的。** 后来在 [LTN-025](/writing/ltn-025-context-rollover) 里，我又花了不少力气去折腾主动换窗（Context Rollover），试图在上下文变脏的时候给模型换个干净的新环境。

但老实说，换窗再好，本质上依然是在“收拾残局”。

做过 Coding Agent 的人都很熟悉这个场景：一个复杂任务跑到第 15 轮，窗口里往往已经塞满了 `cat` 出来的千行源码、几十条编译器报警，以及各种 API 吐出来的巨大 JSON。模型开始顾此失彼，反应变慢，账单飞涨。

每次看到这个画面，我都会忍不住想：**这些中间过程产生的临时数据，真的有必要一字不落全写进对话历史吗？**

最近几天，我一直在看终端 Coding Agent **Pi** 的新版本（0.99 和刚发的 1.0）。Pi 是由 Mario Zechner（写 libGDX 的那位）发起的，后来写 Flask 和 Sentry 的 Armin Ronacher（@mitsuhiko）也一起深度参与设计。他们在这次更新里拿出了一个核心功能叫 **Codemode**。

看完他们的实现细节和背后的思考，我挺有共鸣的。这篇文章就记录一下我对这套设计的理解、背后的账本算术，以及一些冷静下来的观察。

<div class="note idea">
<div class="note-label">CORE IDEA</div>

把工具调用当成“多轮聊天”，是目前大多数 Agent 变慢、变贵、变笨的主因。

Codemode 做的事情其实很朴素：**不要每调一次工具就跑一次大模型网络往返**。它把工具作为异步函数注入到本地一个微型的 JavaScript 沙箱（QuickJS WASM）里，让模型直接写一段代码，把循环、并发请求和数据清洗在本地一口气跑完，最后只把过滤好的干净结果交回给主对话。

</div>

---

## 1. 从“坚决不用 MCP”到 Codemode：发生了什么？

要讲清楚 Codemode，得先提一下大家对 MCP（Model Context Protocol）的态度。

过去一年 Anthropic 推出 MCP 之后，很多工具迅速接入，但也引来了不少开发者的抱怨。Pi 官方此前就一直挂着鲜明的“No MCP”旗帜。Mario 在 2025 年末写过一篇很有意思的长文《*What if you don't need MCP at all?*》，里面吐槽的几个点几乎句句戳中我的日常痛点：

1. **先交一笔昂贵的“入场税”**：MCP 的工具定义是放在提示词里的。像官方推荐的 Playwright MCP 挂了 21 个工具，一口气吃掉 13.7k tokens；Chrome DevTools MCP 更是占掉 18k tokens。开发者还没开口说第一句话，一两万 Token 的窗口额度就已经蒸发了。
2. **工具之间无法像管道一样串联**：我们在命令行里用 Unix 管道 `grep | awk | head` 顺手得不得了，但原生的 MCP 工具做不到。工具 A 吐出来几千行数据，必须原封不动扔回给大模型，等模型花几秒钟读一遍，再决定怎么调工具 B。
3. **既然能写代码，为什么还要造一套厚重协议？**：模型本身就很擅长写脚本。很多时候给它一个 Bash 终端或者写个小 Python 脚本，远比维护一套复杂的 RPC 协议来得轻快干净。

所以当 9 月底 Pi 宣布引入 MCP 并推出 Codemode 时，社区里不少极简主义者挺意外的，甚至有人开玩笑说 Mario 是不是“向潮流妥协了”。Mario 还在推特上发了条自嘲，说 Reddit 上有人觉得他做 Codemode 是背叛了极简初衷。

<div class="timeline-grid">
<div class="timeline-card">
<span class="timeline-date">2025.11 · 原初立场</span>
<div class="timeline-title">“What if you don't need MCP at all?”</div>
<ul class="timeline-list">
<li><strong>昂贵的入场税</strong>：挂两个常用 MCP 就吃掉 30k tokens，还没发问窗口先少了一大截</li>
<li><strong>割裂的工具链</strong>：工具之间没法用管道串联，中间数据无论多琐碎都得进对话</li>
<li><strong>极简主义主张</strong>：坚信写脚本跑 Bash 才是通用之道，反对为了调工具造厚重协议</li>
</ul>
</div>
<div class="timeline-card active">
<span class="timeline-date">2026.09 · 架构重塑</span>
<div class="timeline-title">Pi 0.99 / 1.0 · “You Said No MCP!”</div>
<ul class="timeline-list">
<li><strong>不是妥协，是换了打法</strong>：把所有 MCP 工具下沉到本地的轻量 WASM 沙箱里</li>
<li><strong>只留一个工具</strong>：顶层 Prompt 仅保留 <code>codemode</code>，静态 Schema 税彻底归零</li>
<li><strong>把胶水逻辑交给代码</strong>：模型写 JS 在本地把数据洗干净，只把最终结果交回对话</li>
</ul>
</div>
</div>

但当我把他们的技术博客和源码过了一遍之后，我的感觉截然相反：**这不是妥协，而是他们换了一种更聪明的方式来驯服 MCP。**

他们没有像常见客户端那样把所有工具参数一股脑堆到系统提示词里，而是做了一层端侧沙箱。既拿到了 MCP 生态里现成的工具库，又在源头上把中间垃圾挡在了上下文大门之外。

---

## 2. 传统单步调用的痛点：一个真实的糟糕循环

我们在做 Agent 时，经常能看到这样的执行轨迹：

<div class="note failed">
<div class="note-label">TYPICAL AGENT FAILURE LOOP</div>

- **第 1 轮**：模型想找某个路由文件，跑了个搜索命令，返回了 100 个文件路径，全部记入对话记录；
- **第 2 轮**：模型拿不准哪个是对的，连续读了其中 10 个文件，上万行代码涌入上下文；
- **第 3 轮**：模型在长长的代码堆里翻找一个函数定义，注意力开始被中间的无用代码干扰，找错了地方；
- **后续所有轮次**：从这一刻起，哪怕模型在做完全不相关的事情，前面的那上万行无用代码也会在每一次 API 请求中被反复打包发送，计费计数器疯狂跳动。

</div>

这种单步 ReAct（思考 -> 调一个工具 -> 看结果 -> 再思考）机制在简单问题上很好用，但遇到稍微复杂一点的工程任务，就会暴露出三个很让人头疼的问题：

### 2.1 中间数据一旦进入对话，就成了“不可撤销的历史”
在现有的对话模型里，任何进入消息记录的工具输出，都会变成后续所有思考的背景板。哪怕 Agent 只是想检查某个文件第 50 行的返回值，整个文件读出来的几百行代码也会一直躺在窗口里，成为接下来几十轮推理的包袱。

### 2.2 多轮往返实在太慢了
我们平时写代码，拿个列表做 `filter` 或 `map` 是几毫秒的事。但如果让 Agent 单步来做，每过滤一次就要发起一次大模型 API 调用，网络往返加模型生成，几秒甚至十几秒就过去了，体验极其迟钝。把本该由 CPU 几微秒搞定的确定性逻辑，变成了昂贵的网络聊天。

### 2.3 输出格式全成了自然语言废话
Mario 吐槽过一句很尖锐的话：很多 MCP 服务为了讨好人类直觉，喜欢把接口数据格式化成带 Emoji、带排版的 Markdown 文本。这种文本人类看着挺亲切，但如果想让 Agent 去批量处理，反倒成了噩梦，因为程序没法稳定地消费这种自然语言大杂烩。

---

## 3. Codemode 是怎么设计的？

针对上面这些问题，Pi 的思路是：**既然模型本来就会写代码，为什么不让它直接写一小段脚本来操控工具？**

### 3.1 把沙箱放到 Agent 宿主侧，而不是工作区
这是这套设计里最巧妙的一个细节。

通常如果让 Agent 写脚本（比如在 Bash 里写个 Python 脚本查文件），最容易遇到的问题是“把用户的项目弄脏”：工作区里多了一堆未命名的临时文件、环境里缺依赖报错、甚至不小心改坏了生产代码。

Pi 把执行环境做了一个清晰的分工：

| 维度 | 用户工作区环境 (Bash) | Agent 宿主环境 (Codemode) |
| :--- | :--- | :--- |
| **运行在哪** | 用户的真实机器、Docker 容器或云端环境 | Agent 程序本身的运行进程内 |
| **执行载体** | 系统的 Bash Shell | 内存里的 **QuickJS WASM 沙箱** |
| **产生的副作用** | 真实修改文件、运行测试、安装依赖 | 纯内存计算，跑完即释放，绝不留临时文件 |
| **数据生命周期** | 必须显式写进文件或留在终端日志里 | 局部变量随垃圾回收即时销毁，仅最终结果交回对话 |
| **适合做什么** | 真正的项目构建、提交代码、运行服务 | 临时的批量搜索、接口查询、数据清洗与聚合 |

以前让 Agent 在 Bash 里写脚本，最大的顾虑是副作用不可控；而 Codemode 跑在宿主侧的沙箱里，既安全又干净：

<figure class="diagram-figure">
<div class="diagram-container">
<div class="diagram-header">
<span class="diagram-eyebrow">01 · RUNTIME BOUNDARY</span>
<span class="diagram-title">Pi Codemode 运行时分层结构</span>
</div>

<div class="arch-flow">
<div class="arch-card arch-llm">
<div class="card-meta">
<span class="badge badge-accent">COGNITIVE PLANE</span>
<span class="card-role">Remote Model</span>
</div>
<div class="card-title">LLM 大脑核心</div>
<p class="card-desc">接收高层目标，生成包含循环、条件判断与并发工具调用的 JavaScript 编排脚本</p>
</div>

<div class="flow-arrow">
<svg width="16" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
<path d="M12 5v14M19 12l-7 7-7-7"></path>
</svg>
<span class="arrow-label">生成执行脚本（Code as Action）</span>
</div>

<div class="arch-card arch-host">
<div class="card-meta">
<span class="badge badge-host">HOST RUNTIME</span>
<span class="card-role">Pi Harness 宿主进程</span>
</div>
<div class="card-title">Pi Harness 执行底座</div>

<div class="arch-subcard arch-sandbox">
<div class="subcard-header">
<span class="badge badge-sandbox">SANDBOX CORE</span>
<span class="subcard-title">QuickJS WASM 沙箱</span>
<span class="subcard-pill">内存隔离 · 无原生外网/磁盘权限</span>
</div>
<div class="subcard-grid">
<div class="subcard-col">
<span class="col-label">注入的受控异步接口</span>
<ul class="col-list">
<li><code>await read(path)</code></li>
<li><code>await bash(cmd)</code></li>
<li><code>await mcp.server.call(...)</code></li>
<li><code>await models.classify(...)</code></li>
</ul>
</div>
<div class="subcard-col">
<span class="col-label">内存级流式计算与清洗</span>
<p class="col-text">在沙箱内存中跑并发 <code>Promise.all</code>、正则过滤和数据统计。海量中间文本不写盘、不进对话历史，跑完由 GC 即时回收。</p>
</div>
</div>
<div class="subcard-footer">
<span class="distill-tag">⚡ 端侧清洗</span>
<code>return results; // 仅向主对话交回提炼后的干净切片</code>
</div>
</div>
</div>

<div class="flow-arrow flow-arrow-accent">
<svg width="16" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
<path d="M12 5v14M19 12l-7 7-7-7"></path>
</svg>
<span class="arrow-label highlight">仅返回结构化提炼结果</span>
</div>

<div class="arch-card arch-context">
<div class="card-meta">
<span class="badge badge-teal">ACTIVE CONTEXT</span>
<span class="card-role">Working Memory</span>
</div>
<div class="card-title">顶层会话历史</div>
<p class="card-desc">仅沉淀清洗后的核心数据；没有中间几十次工具调用的原始输出噪音，窗口始终保持高信噪比</p>
</div>
</div>
</div>
<figcaption>图 1：Codemode 的执行边界。工具的运行权从远程提示词下沉到了宿主内的 QuickJS WASM 沙箱，原始数据在沙箱内存里过滤完毕并即时回收，只有最终洗干净的结果才会写入主历史。</figcaption>
</figure>

Pi 选用了经过 WebAssembly 编译的极简 **QuickJS**：
- **微秒级冷启动**，几乎感觉不到沙箱初始化的延迟；
- **天然的物理安全**：默认完全没有原生磁盘或网络权限；
- **受控注入**：沙箱内部能够调用的能力，由 Pi Harness 精确桥接（比如受控的 `read()`、`bash()` 或 `mcp.*()`）。

### 3.2 在内存里把数据洗干净
模型在 Codemode 下写出的不是零碎的工具指令，而是一小段完整的工作流代码。

比如想找某些超过 300 行且包含特定导出的文件：

```javascript
// 在 Pi 的本地 QuickJS 沙箱中执行
const files = await glob('src/routes/**/*.ts');
const results = [];

await Promise.all(files.map(async (file) => {
  const content = await read(file);
  const lines = content.split('\n');
  if (lines.length > 300) {
    // 在沙箱里用正则匹配，根本不需要让大模型去肉眼阅读每一个文件
    const matches = [...content.matchAll(/export\s+const\s+(\w+Route)/g)];
    results.push({
      file,
      lineCount: lines.length,
      routes: matches.map(m => m[1])
    });
  }
}));

return results; // 只有最后提炼出的简短 JSON 会进入主上下文！
```

在这个过程中，被读取的几十个文件内容全部在沙箱的内存里流转，任务一结束，垃圾回收器就把它们清理得干干净净。

最后真正回到大模型主上下文的，只有最后的 `results` 数组。**把杂质过滤在端侧，主窗口的信噪比自然就能维持得很健康。**

### 3.3 把所有工具收敛成一个：`codemode.mode: only`
Pi 还提供了一个很硬核的配置选项：

```json
{
  "codemode": {
    "mode": "only"
  }
}
```

开启这个选项后，大模型在系统提示词里看到的可用工具，**只剩下 `codemode` 这一个**。

不管你外接了多少个庞大的 MCP 服务、挂了多少个本地函数，所有复杂的参数 Schema 全都不用塞进提示词。模型需要用到什么，可以在沙箱内部按需查询。原本占掉几万 Token 的静态 Schema，在第一轮对话里直接降到了几乎为零。

### 3.4 调度本地小模型与多模态
Armin 在演示里还展示了在沙箱内调用轻量分类模型（比如 Jev）的例子。很多低门槛的琐碎任务（比如快速判断几十条用户反馈是正面还是负面），完全可以让沙箱去并行调度一个小模型处理，主模型根本不需要亲自去通读每一条文本：

```javascript
// 在沙箱里并发批处理，主模型根本不需要逐条看每条评论
const comments = await mcp.linear.getRecentComments();
const frustrated = await Promise.all(comments.map(async c => ({
  user: c.author,
  score: await models.classify({ model: "jev", text: c.body })
})));
return frustrated.filter(f => f.score > 0.8).slice(0, 20);
```

主对话模型不再事必躬亲，它更像是一个编写胶水代码的系统架构师。

---

## 4. 账本上的算术：为什么能省下 75% 的 Token？

技术的构想再好，最后还得看实际跑起来的数据。

前几天独立开发者 Geo Qiao（@geoqiao）做了一个很详细的对照实验：用同一个长程任务（完整重构一套自研博客系统的主题与样式），分别用原生单步工具调用和 Pi 的 Codemode 各跑了一遍。

<div class="stat-grid">
<div class="stat-card">
<div class="stat-val">-75%</div>
<div class="stat-label">总 Token 消耗</div>
<div class="stat-desc">原生工具链消耗为其 4 倍，大量中间冗余被拦截在沙箱内</div>
</div>
<div class="stat-card">
<div class="stat-val accent">-64%</div>
<div class="stat-label">API 账单费用</div>
<div class="stat-desc">原生成本为其 3 倍，绝大部分节省来自 Cache Read 的降温</div>
</div>
<div class="stat-card">
<div class="stat-val blue">-42%</div>
<div class="stat-label">模型请求轮次</div>
<div class="stat-desc">多步操作在本地流式完成，网络往返次数直接腰斩</div>
</div>
<div class="stat-card">
<div class="stat-val">10×</div>
<div class="stat-label">额度耐用度体感</div>
<div class="stat-desc">在 Claude 官方配额限制下，高频调用的时长明显大幅增加</div>
</div>
</div>

| 评估指标 | 原生 Tool Calling | Pi + Codemode | 变化幅度 | 为什么会有这个差异？ |
| :--- | :--- | :--- | :--- | :--- |
| **累计总 Token 消耗** | 100% (基准) | **25%** (减少到 1/4) | <span class="delta-tag">-75.0%</span> | 避免了中间几十次工具输出对历史记录的无限累加 |
| **API 账单估算费用** | 100% (基准) | **36%** (减少到 1/3) | <span class="delta-tag">-64.0%</span> | 规避了后续轮次对海量废弃输出的重复 Cache Read 计费 |
| **模型请求轮次 (Turns)** | 100% (基准) | **58%** | <span class="delta-tag">-42.0%</span> | 循环、过滤与聚合在本地沙箱里一次性搞定 |
| **单次请求平均上下文** | 142k Tokens | **48k Tokens** | <span class="delta-tag">-66.2%</span> | 活动工作记忆全程维持在高信噪比区间 |

刚看到这个数据时，有些人可能会纳闷：在代码模式下，模型不仅要写工具参数，还要写逻辑代码，输出的 Token 明明更多了，怎么总账单反而便宜了这么多？

其实只要算一笔细账，道理非常简单：

<div class="note decision">
<div class="note-label">THE CACHE MATH</div>

在长程工程任务中，决定你花多少钱的，从来不是模型当次吐出来的几十个 Completion Token，而是**历史上下文在每一轮请求中的重复读取费用（Cache Read）**。

</div>

我们来做个简单的算术题：
- 假设一个复杂任务需要调用 40 次工具。
- **在传统模式下**：前 5 步工具吐出来的 50,000 Token 代码和日志，在接下来的第 6 轮、第 7 轮……一直到第 40 轮，每次发起请求都得作为历史上下文被重新读一遍。这就像去超市买瓶水，每次结账都非要把过去一个月买过的所有小票重新让收银员通读一遍一样荒谬。
- **而在 Codemode 下**：这 40 次工具调用在本地沙箱里被折叠成了三四次代码执行。那 50,000 Token 的中间文本在本地用完就丢掉了，进入历史的只有几十行提取好的干净结果。
- **省下来的那大几十万 Token，全是在后面几十轮里不用再反复通读的“历史垃圾税”。**

这也是为什么很多人反馈，原本在 Claude 官方配额下跑半天就耗尽的额度，用 Codemode 后感觉耐用了好几倍。

---

## 5. 冷静下来看：它目前有哪些真实痛点？

聊完优点，我也想聊聊这套方案目前在实际使用中暴露出的几个明显问题。它肯定不是什么万能药。

### 5.1 对模型编写代码的要求极高（小模型很容易翻车）
这是目前最现实的一个门槛。Mario 自己也坦诚提到了这点：

写出语法正确、能妥善处理异步 Promise、做好异常捕获的 JavaScript 代码，对模型的推理和编码能力要求相当高。
- 像 Opus 5.5 或者 GPT-6 这种主力旗舰模型，写这类带有并发控制和异常处理的胶水代码已经非常稳定；
- 但如果换成参数量较小的开源端侧模型，翻车概率依然居高不下。

小模型一旦在沙箱里写出了死循环、未捕获的异常或者语法错误，沙箱报错丢回上下文，模型就得花好几轮来给自己找 Bug。一旦陷入这种“本地调试死循环”，节省 Token 的优势不仅荡然无存，任务还会彻底卡死。

### 5.2 简单的短任务没有必要用
如果任务只是“帮我看一眼 config.json 里的某一行配置”，那原生的单步工具调用其实最直接、最快。Codemode 真正大显身手的地方，是**需要批量处理、多次循环、多文件过滤的长链条复杂任务**。杀鸡用牛刀不仅不会变快，反而徒增沙箱启动和代码生成的开销。

### 5.3 很多 MCP 工具的输出格式依然不适合程序化处理
这是目前我觉得最别扭的地方。

Codemode 要好用，一个基本前提是：工具返回的数据必须是结构化的、机器友好的 JSON。但现实中，很多社区开发的 MCP Server 都习惯把输出排版成适合人类阅读的 Markdown 格式（带着标题、列表甚至 Emoji）。

这导致模型在沙箱里拿到数据后，还得写一堆复杂的正则表达式去切字符串、抠字段。这不仅容易写错，而且非常脆弱。

Mario 提出了一个设想：**下一代 MCP 协议应该支持“双通道”（Dual Channels）**——一条通道专门输出面向人类和纯聊天场景的自然语言，另一条通道输出严格类型的结构化数据供沙箱代码消费。如果工具生态不能往这个方向演进，代码模式在很多现成工具上的体验就会大打折扣。

---

## 6. 一点体会：让代码做代码擅长的事

把这些细节串起来看，Pi 的 Codemode 给我的最大启示是：**我们过去可能把大模型放错了位置。**

在过去两年的很多 Agent 框架里，大家习惯把模型当成全知全能的调度员，任何一个变量过滤、一个循环判断，都要让模型在对话里“思考”一下。这种做法不仅浪费算力，而且极易引入随机性错误。

其实在计算机世界里，循环、过滤、并发、聚合，本来就是传统代码几十年来看家本领。大模型最擅长的是理解人类模糊的意图并写出逻辑，而不是充当一台肉身解释器。

正如 Mario 那句传神的话：

> **“Codemode is structured bash. Almost powershelly.”**

让模型写代码，让沙箱跑代码，把干净的结果交回上下文。这条路走通了，上下文就会清爽很多，系统的确定性也会高得多。

这篇先记到这里。接下来我打算把自己平时用的几个本地 Agent 工具也试着改造成沙箱执行的模式，看看在日常重构项目时的真实手感怎么样，有了新结论再来更新。

---

### 参考资料与延伸记录

1. **Mario Zechner**, *What if you don't need MCP at all?*, mariozechner.at, Nov 2025.
2. **Earendil Engineering**, *“You Said No MCP!”*, earendil.com/posts/you-said-no-mcp/, Sep 2026.
3. **Earendil Engineering**, *Pi 1.0*, earendil.com/posts/pi-1-0/, Oct 2026.
4. **Geo Qiao**, *Is Code Mode the Future? 64% Lower Cost on a Long-Running Task*, geoqiao.me, Sep 2026.
5. **LowTemp Notes**, *[LTN-023: 我如何理解 Context Rot](/writing/ltn-023-context-rot)* & *[LTN-025: 上下文换窗](/writing/ltn-025-context-rollover)*.
