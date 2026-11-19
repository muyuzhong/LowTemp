import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { siteTemp, tempOf } from '../lib/temp';
import { renderSiteOgPng } from '../lib/og';

export const GET: APIRoute = async () => {
  const writing = await getCollection('writing');
  const projects = await getCollection('projects');

  const allTextForFontSubset = writing
    .map((e) => `${e.data.title} ${e.data.subtitle || ''} ${e.data.excerpt}`)
    .join(' ');

  const medianTemp = siteTemp([
    ...writing.map((e) => tempOf(e.data.status, e.data.temperature)),
    ...projects.map((e) => tempOf(e.data.status, e.data.temperature)),
  ]);

  const pins = writing
    .map((e) => ({
      temp: tempOf(e.data.status, e.data.temperature),
      status: e.data.status,
    }))
    .filter((p): p is { temp: number; status: (typeof writing)[number]['data']['status'] } => p.temp != null);

  const png = await renderSiteOgPng({
    medianTemp,
    articleCount: writing.length,
    pins,
    allTextForFontSubset,
  });

  return new Response(new Uint8Array(png), {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=86400',
    },
  });
};
