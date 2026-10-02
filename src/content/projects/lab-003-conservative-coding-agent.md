---
id: LAB-003
title: Conservative Coding Agent
subtitle: 一个强调最小必要修改和变更安全验证的 Coding Agent。
state: 已完成
status: exploring
problem: 现有 Coding Agent 能完成修改,但难以控制修改范围,也很难证明没有引入额外问题。改对一个函数的同时顺手"优化"另外三个,是常态而非事故。
hypothesis: 如果 Agent 在修改前理解局部语义边界,并在修改后进行增量验证,可以显著降低非预期变更。
system:
  - Context Layer
  - Planning Harness
  - AST Analysis
  - Minimal Diff
  - Incremental Validation
order: 1
---

## 结果

已完成。变更验证从全树 AST 比对改为基于作用域的符号级增量检查,单次验证耗时从 420ms 降至 28ms(见 2026.08.11 日志)。

## 失败尝试

- **一次性注入完整仓库结构**:没有提升理解能力,反而加剧了上下文污染。见 LTN-023 的浓度问题。
- **让 Agent 自我报告修改范围**:报告与实际 diff 的一致率不到 60%。口头承诺不构成验证。

## 相关文章

- LTN-024 Skill 的评价与优化
- LTN-022 为什么我放弃原来的 Sandbox 架构
