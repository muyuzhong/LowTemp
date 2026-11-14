import { getCollection } from 'astro:content';
import { fmtTemp, tempOf, STATUS_LABEL, CATEGORY_LABEL } from '../lib/temp';
import { buildRefMap, parseDailyLogs } from '../lib/log';

export async function GET() {
  const writing = await getCollection('writing');
  const projects = await getCollection('projects');
  const log = await getCollection('log');
  const dailyLogs = parseDailyLogs(log, buildRefMap(writing, projects));

  const items = [
    ...writing.map((w) => {
      const temp = tempOf(w.data.status, w.data.temperature);
      return {
        type: 'writing',
        id: w.data.id,
        slug: w.id,
        title: w.data.title,
        subtitle: w.data.subtitle ?? '',
        excerpt: w.data.excerpt,
        category: CATEGORY_LABEL[w.data.category] ?? w.data.category,
        status: STATUS_LABEL[w.data.status] ?? w.data.status,
        temp: fmtTemp(temp),
        tags: w.data.tags ?? [],
        url: `/writing/${w.id}/`,
        date: w.data.published.toISOString().split('T')[0],
        body: w.body ? w.body.slice(0, 3000).replace(/[#*`>_[\]()]/g, ' ').replace(/\s+/g, ' ').trim() : '',
      };
    }),
    ...projects.map((p) => {
      const temp = tempOf(p.data.status, p.data.temperature);
      return {
        type: 'project',
        id: p.data.id,
        slug: p.id,
        title: p.data.title,
        subtitle: p.data.subtitle ?? '',
        excerpt: p.data.subtitle || p.data.problem,
        category: '项目',
        status: STATUS_LABEL[p.data.status] ?? p.data.status,
        temp: fmtTemp(temp),
        tags: [],
        url: `/projects/#${p.data.id.toLowerCase()}`,
        date: '',
        body: p.body ? p.body.slice(0, 1500).replace(/[#*`>_[\]()]/g, ' ').replace(/\s+/g, ' ').trim() : '',
      };
    }),
    ...dailyLogs.map((day) => ({
      type: 'log',
      id: `LOG-${day.dateKey}`,
      slug: day.dateKey,
      title: `日志 · ${day.dateDot}`,
      subtitle: day.summary ?? '',
      excerpt: day.previewText,
      category: '实验日志',
      status: day.spanLabel || '记录',
      temp: '',
      tags: [...day.tags, ...day.kinds],
      url: `/log/#${day.dayAnchorId}`,
      date: day.dateKey,
      body: day.moments
        .map((m) => `${m.time ?? ''} ${m.kind ?? ''} ${m.rawText}`.trim())
        .join(' · ')
        .slice(0, 1200),
    })),
  ];

  return new Response(JSON.stringify(items), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
