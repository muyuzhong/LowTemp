import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { resolveSiteTemps } from '../lib/temp-resolver';
import { renderSiteOgPng } from '../lib/og';

export const GET: APIRoute = async () => {
  const writing = await getCollection('writing');
  const siteTemps = await resolveSiteTemps();

  const allTextForFontSubset = writing
    .map((e) => `${e.data.title} ${e.data.subtitle || ''} ${e.data.excerpt}`)
    .join(' ');

  const medianTemp = siteTemps.median;

  const pins = writing
    .map((e) => ({
      temp: siteTemps.getWriting(e).temp,
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
