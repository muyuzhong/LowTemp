# LowTemp Notes · Agent 发文与维护规范

本仓库是 **低温笔记（LowTemp Notes）** 博客站点。所有 Coding Agent（Antigravity / Claude Code / Codex 等）在本仓库发布或维护文章、项目与日志时，必须遵守以下硬性规则。详细字段、SVG 类名表与模板说明见 [使用文档.md](./使用文档.md)，视觉与设计原则见 [design.md](./design.md) 与 [rule.md](./rule.md)。

---

## 1. 内容目录、编号与命名

- **文章**（`src/content/writing/`）：
  - 先检查 `src/content/writing/` 当前最大 `LTN-xxx` 编号并加一，严禁与已有编号重复。
  - 文件名统一为 `ltn-xxx-english-slug.md`（决定线上 URL `/writing/ltn-xxx-english-slug/`）。
  - **连载系列（读一章写一章）**：系列总序文件设 `series: true`（可选 `syllabus` 预置章节规划），各章作为独立 `.md` 放入同名子目录 `src/content/writing/ltn-xxx-slug/ch01-....md`，并在 frontmatter 填 `id: LTN-xxx-01`、`seriesOf: LTN-xxx`、`chapter: 1`。子章节不会刷屏首页与 `/writing/` 主列表，点击系列主入口即可进入章节目录级。
- **项目**（`src/content/projects/`）：
  - 编号 `LAB-xxx`（最大编号加一），文件名 `lab-xxx-english-slug.md`。
- **日志**（`src/content/log/`）：
  - 一日一档 `YYYY-MM-DD.md`；条目格式 `- HH:MM [分类] 内容`（关键节点用 `- * HH:MM [分类] 内容`），也可用 `npm run log "..."` 录入。

---

## 2. 温度系统规则（核心）

1. **严禁手写 `temperature` 数字**：
   - 除非用户明确口头指定强制覆盖某个具体度数，否则 frontmatter 中**绝不要写 `temperature`**（文章与项目皆同）。
   - 单篇温度由构建期多维物理校准算法（`src/lib/temp.ts`）自动计算到 `0.1°C`，并随站内双链、日志提及、修订与附注自动演化。
2. **必须如实填写定性评估 `status` 与 `confidence`**：
   - `status`（决定物态温区；系统绝不自动跨相态）：
     - `draft`（`17.0–19.8°C`，雾）：尚在形成的初稿或片段。注意：`draft` 会正常公开发布，不想公开的草稿不要放入 `src/content/`。
     - `exploring`（`11.0–16.8°C`，液态）：有方向的探索，未定型（**新文章最常用**）。
     - `tested`（`6.6–10.8°C`，结晶中）：已经真实项目或实验验证。
     - `stable`（`3.2–6.4°C`，结晶）：长期沉淀、未遇反例、可依赖。
     - `deprecated`（`—°C`，升华）：观点已改变，仅归档**不删文**，并在文中指向新判断。
   - `confidence`：**必须填写** `'低' | '中' | '中高' | '高'`。切勿省略，也切勿盲目一律填 `'高'`——随感、迷茫或初步假设填 `'低'` 或 `'中'`；具备完整工程论证、实验或代码实证时填 `'中高'` 或 `'高'`。
3. **演化记录 `tempLog` 与 `updated`**：
   - 发新文时，`tempLog` 记入第一行：`- { date: YYYY-MM-DD, status: <初始status> }`。
   - 后续**只有发生跨相态变更 `status` 时**才追加新行；若只是对旧文做实质内容修订，更新 `updated: YYYY-MM-DD` 即可。
4. **其余核心 frontmatter 字段**：
   - 必填：`id`、`title`、`category`（`engineering | research | buildlog | reflection`）、`status`、`confidence`、`published`（`YYYY-MM-DD`）、`excerpt`（两行以内，写判断而非广告）。
   - 建议：`subtitle`、`tags`（不超过 4 个）、`minutes`、`scope`。
   - 项目（`LAB-xxx`）：如实维护 `status`、`system` 模块列表与 `next` 待验证问题，同样不手写 `temperature`。

---

## 3. 正文结构、排版与双链

- **语义块（按内容实质使用，不要硬凑）**：
  - 核心观点：`<div class="note idea"><div class="note-label">CORE IDEA</div> ... </div>`
  - 工程判断：`<div class="note decision"><div class="note-label">ENGINEERING DECISION</div> ... </div>`
  - 失败记录：`<div class="note failed"><div class="note-label">FAILED ATTEMPT / 01</div> ... </div>`
  - 未决问题：`<div class="note open"><div class="note-label">OPEN QUESTION</div> ... </div>`
  - 注意：`<div class="note-label">...</div>` 与正文之间保留空行以便 Markdown 解析；其中 `.note.open` 会温和升温，`.note.decision` / `.note.failed` 与 `.fig` 会温和降温（代码块内的示例 HTML 会自动跳过）。
- **插图规范（`.fig` 内联 SVG）**：
  - 严格采用 `<figure class="fig" data-no-focus><div class="fig-scroll"><svg viewBox="0 0 720 ..." role="img" aria-label="...">...</svg></div><figcaption><b>图 N</b>...</figcaption></figure>`（完整类名见 `使用文档.md`）。
  - `<figure>` 块内部**绝不能有空行**，否则会提前结束 HTML 块导致整张图渲染碎裂。
  - 颜色只使用语义 class（如 `ca`/`cb`/`ct`/`cr`/`cm`/`bx`/`ln`/`sa`），**禁止写 `var(...)` 属性或硬编码深浅主题色**。
  - 宽度固定 `viewBox="0 0 720 ..."`，箭头 `marker` 的 `id` 整页唯一（如 `f1-ar`），SVG 文本中的 `<`、`&` 必须转义为 `&lt;`、`&amp;`。
- **中文引号旁的加粗陷阱**：
  - 在 CommonMark 下，`**` 紧贴中文引号或全角标点（如 `**“关键词”**`）容易解析失败并露出裸 `**`。尽量避免在引号边缘直接套 `**`，必要时在星号外留空、改写句式，或直接使用 `<strong>...</strong>`。
- **自然建立双链**：
  - 若文章或日志延续、印证或反驳了站内既有笔记/项目，在正文中自然提及对应编号（如 `LTN-023`、`LAB-003`）或站内链接（如 `/writing/ltn-023-context-rot/`），让双向链接与旧文自然降温机制生效。

---

## 4. 文风红线

- 保持冷静、克制、诚实的一线研究者与工程师口吻：先提出问题、亮明判断、说明理由、展示取舍、记录失败尝试并交代适用边界。
- **禁用营销与浮夸套话**：禁止出现“众所周知”、“显而易见”、“赋能”、“全面提升”、“一文搞懂”、“保姆级教程”、“震惊”、“终极方案”等表达。
- 文学感只克制地出现在开头一两句、章节过渡或结尾余韵，始终服务于核心观点。

---

## 5. 发布前自检与推送流程

每次新增或修改内容后，**必须**按以下顺序验证并提交：

1. **核对温度校准**：运行 `npm run temp`，检查新文章/项目的最终温度、各分解项与全站中位温度是否合理，确认未意外触发「手动标定」。
2. **全量静态构建**：运行 `npm run build`，确保 Astro 静态构建、Content Collections Schema 校验与 OG 图生成 **100% 零报错**。
3. **精准暂存并提交**：
   - 运行 `git status` 检查变更范围，**只暂存本次相关文件**（严禁把 `dist/`、`output/` 等未跟踪或临时产物加入暂存区）。
   - 遵循仓库 Conventional Commit 风格，例如：
     - `feat(writing): 新增笔记 LTN-xxx《标题》`
     - `fix(writing): 修订 LTN-xxx ...`
     - `log: YYYY-MM-DD`
4. **推送上线**：执行 `git push origin main`。
