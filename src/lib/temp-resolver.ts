/* 全站温度图谱解算器（Astro 服务端 / 构建期使用） */
import { getCollection, type CollectionEntry } from 'astro:content';
import { buildRefMap, findLogMentions, parseDailyLogs } from './log';
import {
  bodyMentionsAny,
  computeProjectTemp,
  computeWritingTemp,
  siteTemp,
  type TempBreakdown,
} from './temp';

export interface SiteTempMap {
  writing: Map<string, TempBreakdown>;
  projects: Map<string, TempBreakdown>;
  median: number;
  getWriting(entry: CollectionEntry<'writing'>): TempBreakdown;
  getProject(entry: CollectionEntry<'projects'>): TempBreakdown;
}

/* 短 TTL（250ms）复用同一次页面渲染周期内的 Promise，既避免重复计算，又保证 astro dev 热更新立即生效 */
const CACHE_TTL_MS = 250;
let cachedAt = 0;
let cachedPromise: Promise<SiteTempMap> | null = null;

async function computeSiteTemps(): Promise<SiteTempMap> {
  const [writing, projects, rawLogs] = await Promise.all([
    getCollection('writing'),
    getCollection('projects'),
    getCollection('log'),
  ]);

  const refMap = buildRefMap(writing, projects);
  const dailyLogs = parseDailyLogs(rawLogs, refMap);
  const activeWriting = writing.filter((w) => w.data.status !== 'deprecated');

  const writingMap = new Map<string, TempBreakdown>();
  for (const w of writing) {
    const d = w.data;
    const backlinks = activeWriting.filter(
      (other) => other.id !== w.id && bodyMentionsAny(other.body, [d.id, w.id])
    ).length;
    const logMentions = findLogMentions(dailyLogs, [d.id, w.id]).length;

    writingMap.set(
      w.id,
      computeWritingTemp({
        status: d.status,
        temperature: d.temperature,
        confidence: d.confidence,
        category: d.category,
        body: w.body,
        published: d.published,
        updated: d.updated,
        tempLog: d.tempLog,
        notes: d.notes,
        backlinks,
        logMentions,
      })
    );
  }

  const projectMap = new Map<string, TempBreakdown>();
  for (const p of projects) {
    const d = p.data;
    const writingMentions = activeWriting.filter((w) =>
      bodyMentionsAny(w.body, [d.id, p.id])
    ).length;
    const logMentions = findLogMentions(dailyLogs, [d.id, p.id]).length;

    projectMap.set(
      p.id,
      computeProjectTemp({
        status: d.status,
        temperature: d.temperature,
        system: d.system,
        next: d.next,
        writingMentions,
        logMentions,
      })
    );
  }

  const median = siteTemp([
    ...[...writingMap.values()].map((b) => b.temp),
    ...[...projectMap.values()].map((b) => b.temp),
  ]);

  return {
    writing: writingMap,
    projects: projectMap,
    median,
    getWriting(entry: CollectionEntry<'writing'>): TempBreakdown {
      const hit = writingMap.get(entry.id);
      if (hit) return hit;
      const d = entry.data;
      return computeWritingTemp({
        status: d.status,
        temperature: d.temperature,
        confidence: d.confidence,
        category: d.category,
        body: entry.body,
        published: d.published,
        updated: d.updated,
        tempLog: d.tempLog,
        notes: d.notes,
      });
    },
    getProject(entry: CollectionEntry<'projects'>): TempBreakdown {
      const hit = projectMap.get(entry.id);
      if (hit) return hit;
      const d = entry.data;
      return computeProjectTemp({
        status: d.status,
        temperature: d.temperature,
        system: d.system,
        next: d.next,
      });
    },
  };
}

export function resolveSiteTemps(): Promise<SiteTempMap> {
  const now = Date.now();
  if (cachedPromise && now - cachedAt < CACHE_TTL_MS) {
    return cachedPromise;
  }
  cachedAt = now;
  cachedPromise = computeSiteTemps().catch((err) => {
    cachedPromise = null;
    cachedAt = 0;
    throw err;
  });
  return cachedPromise;
}
