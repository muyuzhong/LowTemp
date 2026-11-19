import rss from '@astrojs/rss';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { getCollection, render } from 'astro:content';
import type { APIContext } from 'astro';
import {
  CATEGORY_LABEL,
  STATUS_LABEL,
  STATUS_STATE,
  fmtTemp,
  tempOf,
} from '../lib/temp';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeRssHtml(
  rawHtml: string,
  siteOrigin: string,
  parts?: Array<{ title: string; subtitle?: string }>
): string {
  let html = rawHtml
    /* 移除任何潜在脚本标签 */
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    /* 将分篇标记还原为语义化章节标题，保证全文阅读器体验完整 */
    .replace(/<div\s+class=["']part-divider["']\s+data-part=["'](\d+)["']\s*><\/div>/gi, (_, nStr) => {
      const idx = parseInt(nStr, 10) - 1;
      const meta = parts?.[idx];
      const heading = meta?.title
        ? `PART ${String(idx + 1).padStart(2, '0')} · ${escapeHtml(meta.title)}`
        : `PART ${String(idx + 1).padStart(2, '0')}`;
      const sub = meta?.subtitle ? `<p><em>${escapeHtml(meta.subtitle)}</em></p>` : '';
      return `<hr /><h2>${heading}</h2>${sub}`;
    })
    /* 将站内根路径链接与资源补全为绝对 URL */
    .replace(/\b(href|src)=(["'])\/(?!\/)([^"']*)\2/gi, (_, attr, q, rest) => {
      return `${attr}=${q}${siteOrigin}/${rest}${q}`;
    });

  return html.trim();
}

export async function GET(context: APIContext) {
  const siteUrl = context.site!;
  const siteOrigin = siteUrl.origin;
  const container = await AstroContainer.create();

  const writing = (await getCollection('writing')).sort(
    (a, b) => b.data.published.getTime() - a.data.published.getTime()
  );

  const items = await Promise.all(
    writing.map(async (e) => {
      const d = e.data;
      const temp = tempOf(d.status, d.temperature);
      const { Content } = await render(e);
      const rendered = await container.renderToString(Content);
      const bodyHtml = normalizeRssHtml(rendered, siteOrigin, d.parts);

      const postUrl = `${siteOrigin}/writing/${e.id}/`;
      const leadBanner = `<p><em>${escapeHtml(d.id)} · ${escapeHtml(CATEGORY_LABEL[d.category] || d.category)} · ${escapeHtml(STATUS_LABEL[d.status])}（${escapeHtml(STATUS_STATE[d.status])} ${escapeHtml(fmtTemp(temp))}）</em></p>`;
      const subHtml = d.subtitle ? `<p><strong>${escapeHtml(d.subtitle)}</strong></p>` : '';

      const notesHtml =
        d.notes && d.notes.length > 0
          ? `<hr /><h3>作者附注</h3><ol>${d.notes
              .map(
                (n) =>
                  `<li><strong>${escapeHtml(n.anchor)}</strong>：${escapeHtml(n.text)}</li>`
              )
              .join('')}</ol>`
          : '';

      const footerHtml = `<hr /><p><a href="${postUrl}#discussion">在低温笔记阅读原文并参与研讨（${escapeHtml(d.id)}） →</a></p>`;

      return {
        title: `${d.id} · ${d.title}`,
        description: d.excerpt,
        content: `${leadBanner}${subHtml}${bodyHtml}${notesHtml}${footerHtml}`,
        pubDate: d.published,
        categories: [CATEGORY_LABEL[d.category], ...d.tags],
        link: `/writing/${e.id}/`,
      };
    })
  );

  return rss({
    title: '低温笔记 LowTemp Notes',
    description: '在噪声退去之后，记录仍然成立的东西。',
    site: siteUrl,
    items,
    customData: '<language>zh-CN</language>',
  });
}
