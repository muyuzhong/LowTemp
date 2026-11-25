import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import {
  CATEGORY_LABEL,
  STATUS_LABEL,
  STATUS_STATE,
  fmtDate,
  fmtTemp,
} from '../lib/temp';
import { resolveSiteTemps } from '../lib/temp-resolver';

export const GET: APIRoute = async ({ site }) => {
  const origin = (site ?? new URL('https://blog.muyuzhong.xyz')).origin;
  const writing = (await getCollection('writing')).sort(
    (a, b) => b.data.published.getTime() - a.data.published.getTime()
  );
  const projects = (await getCollection('projects')).sort((a, b) => a.data.order - b.data.order);
  const siteTemps = await resolveSiteTemps();
  const median = siteTemps.median;

  const lines: string[] = [
    '# 低温笔记 LowTemp Notes',
    '',
    '> 在噪声退去之后，记录仍然成立的东西。暮羽中（@muyuzhong）关于 Coding Agent 可靠性、上下文工程、语义算子架构、最小必要修改与增量验证的个人研究站点。',
    '',
    '低温笔记把“思考与工程判断的成熟度”可视化为物理温度（越确定的思想，温度越低；当前全站中位温度 ' +
      `${median.toFixed(1)}°C）：`,
    '- `draft`（草稿 · 雾 17.0–19.8°C，基准 18.1°C）：尚在形成，大概率仍有纰漏',
    '- `exploring`（探索 · 液态 11.0–16.8°C，基准 14.2°C）：有方向的实践探索，尚未定型',
    '- `tested`（已验证 · 结晶中 6.6–10.8°C，基准 9.4°C）：已在真实项目中验证，仍寻找边界反例',
    '- `stable`（稳定 · 结晶 3.2–6.4°C，基准 5.4°C）：长期沉淀，暂未遇到反例',
    '- `deprecated`（已废弃 · 升华）：判断已被推翻或升级，保留演化记录',
    '',
    '## 文章与研究笔记',
    '',
    ...writing.map((e) => {
      const d = e.data;
      const t = fmtTemp(siteTemps.getWriting(e).temp);
      const cat = CATEGORY_LABEL[d.category] || d.category;
      return `- [${d.id} · ${d.title}](${origin}/writing/${e.id}/): [${cat} · ${STATUS_LABEL[d.status]}/${STATUS_STATE[d.status]} ${t} · ${fmtDate(d.published)}] ${d.excerpt.replace(/\s+/g, ' ').trim()}`;
    }),
    '',
    '## 实验室项目',
    '',
    ...projects.map((p) => {
      const d = p.data;
      const t = fmtTemp(siteTemps.getProject(p).temp);
      return `- [${d.id} · ${d.title}](${origin}/projects/#${d.id.toLowerCase()}): [${d.state} · ${STATUS_LABEL[d.status]} ${t}] ${d.subtitle}`;
    }),
    '',
    '## 索引与全文语料',
    '',
    `- [全文 Markdown 语料库 (llms-full.txt)](${origin}/llms-full.txt): 包含站内全部研究文章与项目的完整正文与附注`,
    `- [全文 RSS 订阅源 (rss.xml)](${origin}/rss.xml): 标准 RSS 2.0 全文输出`,
    `- [关于作者与温度系统](${origin}/about/): 站点设计理念与实验环境`,
    `- [站点地图 (sitemap-index.xml)](${origin}/sitemap-index.xml)`,
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
    },
  });
};
