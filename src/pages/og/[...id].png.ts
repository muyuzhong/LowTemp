import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { resolveSiteTemps } from '../../lib/temp-resolver';
import { renderArticleOgPng } from '../../lib/og';

const calcReadingMinutes = (text: string) => {
  const clean = text.replace(/```[\s\S]*?```/g, '').trim();
  const cjk = (clean.match(/[一-龥]/g) || []).length;
  const en = (clean.match(/[a-zA-Z0-9_\-]+/g) || []).length;
  return Math.max(1, Math.round(cjk / 350 + en / 180));
};

export const getStaticPaths: GetStaticPaths = async () => {
  const entries = await getCollection('writing');
  const siteTemps = await resolveSiteTemps();
  const allTextForFontSubset = entries
    .map((e) => `${e.data.title} ${e.data.subtitle || ''} ${e.data.excerpt}`)
    .join(' ');

  return entries.map((entry) => ({
    params: { id: entry.id },
    props: {
      entry,
      temp: siteTemps.getWriting(entry).temp,
      allTextForFontSubset,
    },
  }));
};

export const GET: APIRoute = async ({ props }) => {
  const { entry, temp, allTextForFontSubset } = props as {
    entry: Awaited<ReturnType<typeof getCollection<'writing'>>>[number];
    temp: number | null;
    allTextForFontSubset: string;
  };
  const d = entry.data;
  const minutes = d.minutes ?? (entry.body ? calcReadingMinutes(entry.body) : 8);

  const png = await renderArticleOgPng({
    id: d.id,
    title: d.title,
    subtitle: d.subtitle,
    excerpt: d.excerpt,
    category: d.category,
    status: d.status,
    temp,
    published: d.published,
    minutes,
    allTextForFontSubset,
  });

  return new Response(new Uint8Array(png), {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
};
