---
id: LAB-001
title: LowTemp Notes
subtitle: 这个网站本身:一个把知识成熟度可视化为温度的个人实验室。
state: 运行中
status: stable
problem: 个人博客通常只有"已发布"一种状态,文章发表后假装永远静止,读者无法区分成熟结论和随手想法。
hypothesis: 给每篇内容标注状态与温度,并公开演化历史,可以让读者校准信任,也让作者敢于发布未完成的思想。
system:
  - Astro Static Site
  - Content Collections
  - Status-Temperature Mapping
  - Temperature Axis (data-driven)
  - Command Palette Search
  - Focus Reading (CSS Custom Highlight)
next: 温度史的可视化:单篇文章的降温曲线。
order: 2
---

## 失败尝试

- **第一个版本想做全文搜索**:静态站加索引的复杂度远超收益。五项导航以内的网站,不需要搜索。
  - 2026.09 后来还是做了:构建时静态生成一份索引 JSON,在浏览器里本地检索(⌘K)。
