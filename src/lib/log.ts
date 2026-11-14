import type { CollectionEntry } from 'astro:content';

export interface RefTarget {
  id: string;
  href: string;
  title: string;
}

export type RefMap = Record<string, RefTarget>;

export interface LogMoment {
  anchorId: string;
  time: string | null;
  minutes: number | null;
  milestone: boolean;
  kind: string | null;
  rawText: string;
  sourceText: string;
  extraLink: string | null;
  html: string;
  gapPx: number;
  longGap: boolean;
}

export interface DailyLog {
  dateKey: string;
  dateDot: string;
  monthKey: string;
  shortDate: string;
  weekday: string;
  dateMs: number;
  dayAnchorId: string;
  summary: string | null;
  previewHtml: string;
  previewText: string;
  hasExplicitSummary: boolean;
  spanLabel: string;
  hasMilestone: boolean;
  kinds: string[];
  tags: string[];
  moments: LogMoment[];
  isSinglePlain: boolean;
}

export interface RhythmNeedle {
  xPct: number;
  milestone: boolean;
  href: string;
  readout: string;
}

export interface RhythmStats {
  scopeLabel: string;
  defaultReadout: string;
  needles: RhythmNeedle[];
}

export interface LogMention {
  dateDot: string;
  time: string | null;
  html: string;
  rawText: string;
  href: string;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

const pad2 = (n: number) => String(n).padStart(2, '0');

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str: string): string {
  return escapeHtml(str).replace(/'/g, '&#39;');
}

function sanitizeHref(url: string): string {
  const trimmed = url.trim();
  if (/^(https?:\/\/|\/|#)/i.test(trimmed)) return trimmed;
  return '#';
}

function truncateText(text: string, maxLen: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen).trimEnd()}…`;
}

function normalizeWikilinkKey(rawTarget: string): string {
  return rawTarget
    .trim()
    .replace(/^\/+/, '')
    .replace(/^(?:writing|projects|log)\//i, '')
    .replace(/\.md$/i, '')
    .toUpperCase();
}

/** 将含 [[双链]] 与反引号的日志文本清洗为可读纯文本（用于摘要、刻度读数与检索） */
export function cleanPlainLogText(text: string, refMap: RefMap): string {
  return text
    .replace(/\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g, (_, rawTarget: string, _heading?: string, alias?: string) => {
      if (alias && alias.trim()) return alias.trim();
      const normKey = normalizeWikilinkKey(rawTarget);
      const hit = refMap[normKey];
      if (hit) return hit.id;
      if (/^\d{4}-\d{2}-\d{2}$/.test(normKey)) return normKey.replace(/-/g, '.');
      return rawTarget.trim().replace(/\.md$/i, '');
    })
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 将行内文本安全渲染为 HTML（支持 `code`、[[双链]]、[label](url)、LTN-xxx / LAB-xxx 自动互链） */
export function renderLogInline(text: string, refMap: RefMap, extraLink?: string | null): string {
  const segments = text.split(/(`[^`]+`)/g);
  const out = segments
    .map((seg) => {
      if (seg.startsWith('`') && seg.endsWith('`') && seg.length >= 2) {
        return `<code>${escapeHtml(seg.slice(1, -1))}</code>`;
      }

      const placeholders: string[] = [];
      let escaped = escapeHtml(seg);

      // 1. 解析 Obsidian [[target#heading|alias]] 双链
      escaped = escaped.replace(
        /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g,
        (_, rawTarget: string, heading?: string, alias?: string) => {
          const normKey = normalizeWikilinkKey(rawTarget);
          const target = refMap[normKey];
          const cleanAlias = alias?.trim();

          if (target) {
            const display = cleanAlias || target.id;
            const useRefCls = !cleanAlias || /^(?:LTN|LAB)-\d{3}$/i.test(cleanAlias);
            const cls = useRefCls ? ' class="log-ref"' : '';
            const href =
              heading && !target.href.includes('#')
                ? `${target.href}#${encodeURIComponent(heading.trim())}`
                : target.href;
            const idx = placeholders.length;
            placeholders.push(`<a href="${escapeAttr(href)}"${cls} title="${escapeAttr(target.title)}">${display}</a>`);
            return `\u0000L${idx}\u0000`;
          }

          if (/^\d{4}-\d{2}-\d{2}$/.test(normKey)) {
            const display = cleanAlias || normKey.replace(/-/g, '.');
            const href = `/log/#log-${normKey.toLowerCase()}`;
            const idx = placeholders.length;
            placeholders.push(`<a href="${escapeAttr(href)}" class="log-ref">${display}</a>`);
            return `\u0000L${idx}\u0000`;
          }

          return cleanAlias || rawTarget.trim().replace(/\.md$/i, '');
        }
      );

      // 2. 解析标准 Markdown 链接
      escaped = escaped.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, rawUrl: string) => {
        const idx = placeholders.length;
        const href = escapeAttr(sanitizeHref(rawUrl));
        placeholders.push(`<a href="${href}">${label}</a>`);
        return `\u0000L${idx}\u0000`;
      });

      // 3. 自动识别裸编号 LTN-xxx / LAB-xxx
      escaped = escaped.replace(/\b((?:LTN|LAB)-\d{3})\b/gi, (match) => {
        const key = match.toUpperCase();
        const target = refMap[key];
        if (!target) return match;
        return `<a href="${escapeAttr(target.href)}" class="log-ref" title="${escapeAttr(target.title)}">${key}</a>`;
      });

      return escaped.replace(/\u0000L(\d+)\u0000/g, (_, i) => placeholders[Number(i)] ?? '');
    })
    .join('');

  if (extraLink) {
    return `${out} — <a href="${escapeAttr(sanitizeHref(extraLink))}">链接</a>`;
  }
  return out;
}

export function buildRefMap(
  writing: CollectionEntry<'writing'>[],
  projects: CollectionEntry<'projects'>[]
): RefMap {
  const map: RefMap = {};
  for (const w of writing) {
    const target: RefTarget = {
      id: w.data.id.toUpperCase(),
      href: `/writing/${w.id}/`,
      title: w.data.title,
    };
    map[w.data.id.toUpperCase()] = target;
    map[w.id.toUpperCase()] = target;
  }
  for (const p of projects) {
    const id = p.data.id.toUpperCase();
    const target: RefTarget = {
      id,
      href: `/projects/#${id.toLowerCase()}`,
      title: p.data.title,
    };
    map[id] = target;
    map[p.id.toUpperCase()] = target;
  }
  return map;
}

interface ParsedBullet {
  time: string | null;
  minutes: number | null;
  milestone: boolean;
  kind: string | null;
  rawText: string;
  sourceText: string;
  extraLink: string | null;
}

const BULLET_LINE_RE =
  /^[-*]\s+(?:([*!])\s+)?(?:(\d{1,2}):(\d{2})\s+)?(?:([*!])\s+)?(?:\[([^\n\]]{1,24})\](?!\()\s*)?([\s\S]+)$/;

function parseTimeParts(hRaw?: string, mRaw?: string): { time: string; minutes: number } | null {
  if (!hRaw || !mRaw) return null;
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (h === 24 && m === 0) return { time: '24:00', minutes: 1439 };
  if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
    return { time: `${pad2(h)}:${pad2(m)}`, minutes: h * 60 + m };
  }
  return null;
}

function splitExtraLink(raw: string): { text: string; extraLink: string | null } {
  const match = raw.match(/^(.*?)\s+(?:->|→)\s+((?:https?:\/\/|\/)\S+)\s*$/);
  if (!match) return { text: raw.trim(), extraLink: null };
  return { text: match[1].trim(), extraLink: match[2].trim() };
}

const EMPTY_BULLET_RE =
  /^[-*]\s*(?:[*!]\s*)?(?:\d{1,2}:\d{2}\s*)?(?:[*!]\s*)?(?:\[[^\n\]]{1,24}\]\s*)?$/;

function extractBullets(body: string): ParsedBullet[] | null {
  const lines = body.split(/\r?\n/);
  const bulletIdx = lines.findIndex((l) => /^[-*](?:\s|$)/.test(l));
  if (bulletIdx === -1) return null;

  const rawItems: string[] = [];
  for (const line of lines) {
    if (/^[-*](?:\s|$)/.test(line)) {
      rawItems.push(line);
    } else if (/^\s+\S/.test(line) && rawItems.length > 0) {
      rawItems[rawItems.length - 1] += ` ${line.trim()}`;
    } else if (line.trim() && rawItems.length === 0) {
      // 列表中混入前置单段说明时，保留为无时刻条目
      rawItems.push(`- ${line.trim()}`);
    }
  }

  const parsed: ParsedBullet[] = [];
  for (const item of rawItems) {
    if (EMPTY_BULLET_RE.test(item.trim())) continue;
    const m = item.match(BULLET_LINE_RE);
    if (!m) continue;
    const [, flagA, hRaw, mRaw, flagB, kindRaw, rest] = m;
    const tp = parseTimeParts(hRaw, mRaw);
    const { text, extraLink } = splitExtraLink(rest);
    if (!text) continue;
    parsed.push({
      time: tp?.time ?? null,
      minutes: tp?.minutes ?? null,
      milestone: Boolean(flagA || flagB),
      kind: kindRaw ? kindRaw.trim() : null,
      rawText: text,
      extraLink,
    });
  }
  return parsed;
}

function computeSpanLabel(moments: LogMoment[]): string {
  const times = moments.map((m) => m.time).filter((t): t is string => Boolean(t));
  if (times.length >= 2) {
    return `${times[0]}–${times[times.length - 1]} · ${moments.length} 刻`;
  }
  if (times.length === 1) {
    return moments.length > 1 ? `${times[0]} · ${moments.length} 条` : times[0];
  }
  return moments.length > 1 ? `${moments.length} 条` : '';
}

export function parseDailyLogs(entries: CollectionEntry<'log'>[], refMap: RefMap): DailyLog[] {
  const usedIds = new Set<string>();
  const claimId = (base: string): string => {
    let candidate = base;
    let i = 2;
    while (usedIds.has(candidate)) {
      candidate = `${base}-${i++}`;
    }
    usedIds.add(candidate);
    return candidate;
  };

  interface DayBucket {
    dateKey: string;
    dateDot: string;
    monthKey: string;
    shortDate: string;
    weekday: string;
    dateMs: number;
    summaries: string[];
    tags: Set<string>;
    items: (ParsedBullet & { sourceOrder: number; preferredAnchorId?: string })[];
    isLegacySingleFileOnly: boolean;
  }

  const buckets = new Map<string, DayBucket>();

  // 按文件 id 稳定排序，确保同日多文件归并顺序可预测
  const sortedEntries = [...entries].sort((a, b) => a.id.localeCompare(b.id));

  for (const entry of sortedEntries) {
    const d = entry.data.published;
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const dateKey = `${y}-${pad2(m)}-${pad2(day)}`;
    const dateDot = `${y}.${pad2(m)}.${pad2(day)}`;
    const monthKey = `${y}.${pad2(m)}`;
    const shortDate = `${pad2(m)}.${pad2(day)}`;
    const weekday = WEEKDAYS[d.getUTCDay()];
    const dateMs = Date.UTC(y, m - 1, day);

    let bucket = buckets.get(dateKey);
    if (!bucket) {
      bucket = {
        dateKey,
        dateDot,
        monthKey,
        shortDate,
        weekday,
        dateMs,
        summaries: [],
        tags: new Set<string>(),
        items: [],
        isLegacySingleFileOnly: true,
      };
      buckets.set(dateKey, bucket);
    }

    if (entry.data.summary) bucket.summaries.push(entry.data.summary.trim());
    for (const t of entry.data.tags ?? []) bucket.tags.add(t);

    const body = (entry.body ?? '').replace(/^\uFEFF/, '').trim();
    const bullets = body ? extractBullets(body) : null;

    if (bullets) {
      bucket.isLegacySingleFileOnly = false;
      for (const b of bullets) {
        bucket.items.push({
          ...b,
          extraLink: b.extraLink ?? entry.data.link ?? null,
          sourceOrder: bucket.items.length,
        });
      }
    } else if (body) {
      bucket.items.push({
        time: null,
        minutes: null,
        milestone: true,
        kind: null,
        rawText: body,
        extraLink: entry.data.link ?? null,
        sourceOrder: bucket.items.length,
        preferredAnchorId: `log-${entry.id}`,
      });
    }
  }

  const days: DailyLog[] = [];
  const sortedBuckets = [...buckets.values()].sort((a, b) => b.dateMs - a.dateMs);

  for (const b of sortedBuckets) {
    if (b.items.length === 0 && b.summaries.length === 0) continue;

    b.items.sort((x, y) => {
      if (x.minutes != null && y.minutes != null) {
        return x.minutes - y.minutes || x.sourceOrder - y.sourceOrder;
      }
      if (x.minutes != null) return -1;
      if (y.minutes != null) return 1;
      return x.sourceOrder - y.sourceOrder;
    });

    const moments: LogMoment[] = b.items.map((item, idx) => {
      const prev = idx > 0 ? b.items[idx - 1] : null;
      let gapPx = 0;
      let longGap = false;
      if (prev) {
        if (item.minutes != null && prev.minutes != null) {
          const delta = Math.max(0, item.minutes - prev.minutes);
          if (delta <= 45) {
            gapPx = 6;
          } else {
            gapPx = 6 + Math.min(20, Math.round(Math.log2(delta / 30) * 5.5));
          }
          longGap = delta >= 180;
        } else {
          gapPx = 8;
        }
      }

      const rawBase =
        item.preferredAnchorId ??
        `log-${b.dateKey}-${item.time ? item.time.replace(':', '') : pad2(idx + 1)}`;
      const anchorId = claimId(rawBase);

      return {
        anchorId,
        time: item.time,
        minutes: item.minutes,
        milestone: item.milestone,
        kind: item.kind,
        rawText: cleanPlainLogText(item.rawText, refMap),
        sourceText: item.rawText,
        extraLink: item.extraLink,
        html: renderLogInline(item.rawText, refMap, item.extraLink),
        gapPx,
        longGap,
      };
    });

    const summary = b.summaries.length > 0 ? b.summaries.join(' / ') : null;
    const hasExplicitSummary = Boolean(summary);
    const fallbackMoment = moments.find((m) => m.milestone) ?? moments[moments.length - 1];
    const previewSource = summary ?? (fallbackMoment ? truncateText(fallbackMoment.rawText, 52) : '');
    const previewText = cleanPlainLogText(previewSource, refMap);
    const previewHtml = renderLogInline(previewSource, refMap);

    const dayAnchorBase = usedIds.has(`log-${b.dateKey}`) ? `day-${b.dateKey}` : `log-${b.dateKey}`;
    const dayAnchorId = claimId(dayAnchorBase);

    const kinds = [...new Set(moments.map((m) => m.kind).filter((k): k is string => Boolean(k)))];
    const isSinglePlain =
      moments.length === 1 && !hasExplicitSummary && moments[0].time == null && b.isLegacySingleFileOnly;

    days.push({
      dateKey: b.dateKey,
      dateDot: b.dateDot,
      monthKey: b.monthKey,
      shortDate: b.shortDate,
      weekday: b.weekday,
      dateMs: b.dateMs,
      dayAnchorId,
      summary,
      previewHtml,
      previewText,
      hasExplicitSummary,
      spanLabel: computeSpanLabel(moments),
      hasMilestone: moments.some((m) => m.milestone),
      kinds,
      tags: [...b.tags],
      moments,
      isSinglePlain,
    });
  }

  return days;
}

/** 24h 昼夜刻度弦统计 */
export function buildRhythmStats(days: DailyLog[]): RhythmStats {
  const newestMs = days[0]?.dateMs ?? 0;
  const recentCutoff = newestMs - 30 * 86_400_000;

  const collect = (subset: DailyLog[]) => {
    const out: { minutes: number; needle: RhythmNeedle }[] = [];
    for (const day of subset) {
      for (const m of day.moments) {
        if (m.minutes == null || !m.time) continue;
        out.push({
          minutes: m.minutes,
          needle: {
            xPct: Math.min(99.6, Math.max(0.4, (m.minutes / 1440) * 100)),
            milestone: m.milestone,
            href: `#${m.anchorId}`,
            readout: `${day.shortDate} ${m.time} · ${truncateText(m.rawText, 34)}`,
          },
        });
      }
    }
    return out;
  };

  const recentPoints = collect(days.filter((d) => d.dateMs >= recentCutoff));
  const useRecent = recentPoints.length >= 3;
  const points = useRecent ? recentPoints : collect(days);

  if (points.length === 0) {
    return {
      scopeLabel: '24h 时刻分布',
      defaultReadout: '尚无时刻记录',
      needles: [],
    };
  }

  // 3 小时滑动窗口寻找最活跃时段
  let bestStartHour = 0;
  let bestCount = -1;
  for (let h = 0; h < 24; h++) {
    let count = 0;
    for (const pt of points) {
      const ptHour = Math.floor(pt.minutes / 60);
      const diff = (ptHour - h + 24) % 24;
      if (diff < 3) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      bestStartHour = h;
    }
  }
  const bestEndHour = (bestStartHour + 3) % 24;
  const peakWindow = `${pad2(bestStartHour)}:00–${pad2(bestEndHour)}:00`;

  return {
    scopeLabel: useRecent ? '近 30 日时刻分布' : '历史时刻分布',
    defaultReadout: `活跃峰值 ${peakWindow} · 共 ${points.length} 刻`,
    needles: points.map((p) => p.needle),
  };
}

/** 查询所有提及特定编号/路径的日志时刻 */
export function findLogMentions(days: DailyLog[], matchKeys: string[]): LogMention[] {
  const normalizedKeys = matchKeys.map((k) => k.trim().toUpperCase()).filter(Boolean);
  if (normalizedKeys.length === 0) return [];

  const mentions: LogMention[] = [];
  for (const day of days) {
    for (const m of day.moments) {
      const hay = `${m.sourceText} ${m.rawText} ${m.extraLink ?? ''}`.toUpperCase();
      if (normalizedKeys.some((k) => hay.includes(k))) {
        mentions.push({
          dateDot: day.dateDot,
          time: m.time,
          html: m.html,
          rawText: m.rawText,
          href: `/log/#${m.anchorId}`,
        });
      }
    }
  }
  return mentions;
}
