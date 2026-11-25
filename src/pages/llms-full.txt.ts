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

  const sections: string[] = [
    '# 低温笔记 LowTemp Notes — 全文语料库 (llms-full.txt)',
    '',
    `站点主页：${origin}/`,
    '作者：暮羽中 (@muyuzhong)',
    '许可协议：CC BY-NC 4.0（文字内容署名-非商业性使用）',
    '',
    '================================================================================',
    '',
  ];

  for (const e of writing) {
    const d = e.data;
    const t = fmtTemp(siteTemps.getWriting(e).temp);
    sections.push(`# ${d.id} · ${d.title}`);
    if (d.subtitle) sections.push(`> ${d.subtitle}`);
    sections.push('');
    sections.push(`- URL: ${origin}/writing/${e.id}/`);
    sections.push(`- 类别: ${CATEGORY_LABEL[d.category] || d.category}`);
    sections.push(`- 物态与温度: ${STATUS_LABEL[d.status]}（${STATUS_STATE[d.status]} ${t}）`);
    sections.push(`- 发布日期: ${fmtDate(d.published)}${d.updated ? `（更新于 ${fmtDate(d.updated)}）` : ''}`);
    if (d.tags?.length) sections.push(`- 标签: ${d.tags.join(', ')}`);
    sections.push(`- 摘要: ${d.excerpt.replace(/\s+/g, ' ').trim()}`);
    sections.push('');
    sections.push((e.body || '').trim());

    if (d.notes && d.notes.length > 0) {
      sections.push('');
      sections.push('## 作者附注');
      for (const n of d.notes) {
        sections.push(`- **${n.anchor}**：${n.text}`);
      }
    }

    sections.push('');
    sections.push('--------------------------------------------------------------------------------');
    sections.push('');
  }

  for (const p of projects) {
    const d = p.data;
    const t = fmtTemp(siteTemps.getProject(p).temp);
    sections.push(`# 项目档案 ${d.id} · ${d.title}`);
    sections.push(`> ${d.subtitle}`);
    sections.push('');
    sections.push(`- URL: ${origin}/projects/#${d.id.toLowerCase()}`);
    sections.push(`- 状态: ${d.state} · ${STATUS_LABEL[d.status]}（${t}）`);
    sections.push(`- 问题定义: ${d.problem}`);
    sections.push(`- 核心假设: ${d.hypothesis}`);
    if (d.system?.length) sections.push(`- 系统组成: ${d.system.join(' / ')}`);
    if (p.body?.trim()) {
      sections.push('');
      sections.push(p.body.trim());
    }
    sections.push('');
    sections.push('--------------------------------------------------------------------------------');
    sections.push('');
  }

  return new Response(sections.join('\n'), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
    },
  });
};
