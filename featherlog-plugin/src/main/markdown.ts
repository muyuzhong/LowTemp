import type { LowtempDay } from '../contracts';

export interface ParsedBullet {
  time: string;
  kind: string | null;
  milestone: boolean;
  text: string;
}

export interface ParsedLogFile {
  summary: string | null;
  bullets: ParsedBullet[];
  extraFrontmatter: string[];
  extraBody: string[];
  isProseOnly: boolean;
}

const TIMELINE_LINE = /^\s*-\s+(\*\s+)?(\d{1,2}):(\d{2})(?:\s+\[([^\]\n]+)\])?\s*(.*)$/;
const EMPTY_BULLET = /^\s*-\s*(\*\s*)?$/;

function unquoteYaml(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === 'string') return parsed.trim();
    } catch {
      return trimmed.slice(1, -1).replace(/\\"/g, '"').trim();
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/''/g, "'").trim();
  }
  return trimmed;
}

function splitFrontmatter(source: string): { frontmatter: string[]; body: string } {
  const lines = source.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { frontmatter: [], body: source };
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end === -1) {
    return { frontmatter: [], body: source };
  }
  return {
    frontmatter: lines.slice(1, end),
    body: lines.slice(end + 1).join('\n'),
  };
}

/**
 * Parse a LowTemp `src/content/log/YYYY-MM-DD.md` file into frontmatter metadata
 * and structured timeline bullets, preserving unrelated frontmatter or prose.
 */
export function parseLogMarkdown(raw: string): ParsedLogFile {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const { frontmatter, body } = splitFrontmatter(normalized);

  let summary: string | null = null;
  const extraFrontmatter: string[] = [];

  for (const line of frontmatter) {
    const publishedMatch = /^published\s*:/.test(line);
    if (publishedMatch) continue;
    const summaryMatch = /^summary\s*:(.*)$/.exec(line);
    if (summaryMatch) {
      const value = unquoteYaml(summaryMatch[1] ?? '');
      summary = value || null;
      continue;
    }
    if (line.trim() !== '' || extraFrontmatter.length > 0) {
      extraFrontmatter.push(line);
    }
  }
  while (extraFrontmatter.at(-1)?.trim() === '') extraFrontmatter.pop();

  const bullets: ParsedBullet[] = [];
  const extraBody: string[] = [];

  for (const line of body.split('\n')) {
    if (!line.trim() || EMPTY_BULLET.test(line)) continue;
    const match = TIMELINE_LINE.exec(line);
    if (match) {
      const hour = Number(match[2]);
      const minute = Number(match[3]);
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        const rawKind = match[4]?.trim() ?? '';
        const kind = rawKind ? rawKind : null;
        const text = (match[5] ?? '').trim();
        if (kind === null && !text) continue;
        bullets.push({
          time,
          kind,
          milestone: Boolean(match[1]),
          text,
        });
        continue;
      }
    }
    extraBody.push(line);
  }

  const isProseOnly = bullets.length === 0 && summary === null && extraBody.length > 0;
  return { summary, bullets, extraFrontmatter, extraBody, isProseOnly };
}

/**
 * Canonical deduplication key so entries already tracked in Featherlog are not
 * duplicated when merging bullets added externally via CLI or Obsidian.
 */
export function entrySignature(item: {
  time: string;
  kind: string | null;
  milestone: boolean;
  text: string;
}): string {
  return `${item.time}\u0000${item.milestone ? '1' : '0'}\u0000${item.kind ?? ''}\u0000${item.text}`;
}

/**
 * Serialize a Featherlog day record into LowTemp `src/content/log/YYYY-MM-DD.md`.
 */
export function serializeLogMarkdown(
  day: Pick<LowtempDay, 'date' | 'summary' | 'entries'>,
  preserved?: { extraFrontmatter?: string[]; extraBody?: string[] },
): string {
  const lines: string[] = ['---', `published: ${day.date}`];
  const summary = day.summary?.trim() ?? '';
  if (summary) {
    lines.push(`summary: ${JSON.stringify(summary)}`);
  }
  if (preserved?.extraFrontmatter?.length) {
    lines.push(...preserved.extraFrontmatter);
  }
  lines.push('---', '');

  for (const entry of day.entries) {
    const star = entry.milestone ? '* ' : '';
    const facet = entry.kind ? ` [${entry.kind}]` : '';
    lines.push(`- ${star}${entry.time}${facet} ${entry.text}`);
  }

  if (preserved?.extraBody?.length) {
    if (day.entries.length > 0) lines.push('');
    lines.push(...preserved.extraBody);
  }

  return `${lines.join('\n')}\n`;
}
