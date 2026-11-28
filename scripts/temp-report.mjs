#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const CONTENT_ROOT = path.resolve(process.cwd(), 'src/content');

const PHASE_BAND = {
  draft: { min: 17.0, max: 19.8, base: 18.1, scale: 0.75 },
  exploring: { min: 11.0, max: 16.8, base: 14.2, scale: 1.0 },
  tested: { min: 6.6, max: 10.8, base: 9.4, scale: 0.75 },
  stable: { min: 3.2, max: 6.4, base: 5.4, scale: 0.55 },
  deprecated: null,
};

const STATUS_LABEL = {
  draft: '草稿',
  exploring: '探索',
  tested: '已验证',
  stable: '稳定',
  deprecated: '已废弃',
};

const STATUS_STATE = {
  draft: '雾',
  exploring: '液态',
  tested: '结晶中',
  stable: '结晶',
  deprecated: '升华',
};

const CONFIDENCE_DELTA = {
  低: { raw: 1.0, label: '置信低' },
  中: { raw: 0.0, label: '置信中' },
  中高: { raw: -0.7, label: '置信中高' },
  高: { raw: -1.3, label: '置信高' },
};

const CATEGORY_DELTA = {
  reflection: { raw: 0.4, label: '随笔' },
  research: { raw: 0.0, label: '研究笔记' },
  buildlog: { raw: -0.2, label: '建造日志' },
  engineering: { raw: -0.3, label: '工程' },
};

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

function fmtSignedDelta(delta) {
  const sign = delta >= 0 ? '+' : '−';
  const abs = Math.abs(delta);
  if (abs > 0 && abs < 0.05) {
    return `${sign}${(Math.round((abs + 1e-9) * 100) / 100).toFixed(2)}°`;
  }
  return `${sign}${(Math.round((abs + 1e-9) * 10) / 10).toFixed(1)}°`;
}

function fmtTemp(t) {
  return t == null ? '—°C' : `${t.toFixed(1)}°C`;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unquoteYamlScalar(raw) {
  const s = raw.trim();
  if (!s || s === 'null' || s === '~') return undefined;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return s.replace(/\s+#.*$/, '').trim() || undefined;
}

function parseFrontmatter(raw) {
  const clean = raw.replace(/^\uFEFF/, '');
  const m = clean.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: clean };

  const fmLines = m[1].split(/\r?\n/);
  const data = {};

  let i = 0;
  while (i < fmLines.length) {
    const line = fmLines[i];
    const keyMatch = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!keyMatch) {
      i++;
      continue;
    }

    const key = keyMatch[1];
    const rest = keyMatch[2].trim();

    if (rest.startsWith('[') && rest.endsWith(']')) {
      const inner = rest.slice(1, -1).trim();
      data[key] = inner
        ? inner
            .split(',')
            .map((x) => unquoteYamlScalar(x))
            .filter((x) => x !== undefined)
        : [];
      i++;
      continue;
    }

    if (rest === '') {
      // Check for indented block array or block scalar
      const items = [];
      let itemIndent = null;
      let j = i + 1;
      while (j < fmLines.length) {
        const sub = fmLines[j];
        if (!sub.trim()) {
          j++;
          continue;
        }
        const indentMatch = sub.match(/^(\s+)/);
        if (!indentMatch) break;
        const indent = indentMatch[1].length;
        const bulletMatch = sub.match(/^(\s*)-\s*(.*)$/);
        if (bulletMatch) {
          if (itemIndent === null) itemIndent = bulletMatch[1].length;
          if (bulletMatch[1].length === itemIndent) {
            items.push(bulletMatch[2].trim());
          }
        }
        j++;
      }
      data[key] = items.length > 0 ? items : undefined;
      i = j;
      continue;
    }

    data[key] = unquoteYamlScalar(rest);
    i++;
  }

  return { data, body: m[2] };
}

function readMarkdownDir(dirName) {
  const dir = path.join(CONTENT_ROOT, dirName);
  if (!fs.existsSync(dir)) return [];

  const entries = [];
  const walk = (currentDir, prefix = '') => {
    for (const dirent of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (dirent.name.startsWith('.')) continue;
      const fullPath = path.join(currentDir, dirent.name);
      const rel = prefix ? `${prefix}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        walk(fullPath, rel);
      } else if (dirent.isFile() && dirent.name.endsWith('.md')) {
        const raw = fs.readFileSync(fullPath, 'utf8');
        const { data, body } = parseFrontmatter(raw);
        const id = rel.replace(/\.md$/i, '');
        entries.push({ id, file: rel, data, body });
      }
    }
  };
  walk(dir);
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

function parseDate(val) {
  if (!val) return null;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseNumber(val) {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

/* ---------- 与 src/lib/log.ts 保持一致的日志时刻与提及解析 ---------- */

const BULLET_LINE_RE =
  /^[-*]\s+(?:([*!])\s+)?(?:(\d{1,2}):(\d{2})\s+)?(?:([*!])\s+)?(?:\[([^\n\]]{1,24})\](?!\()\s*)?([\s\S]+)$/;
const EMPTY_BULLET_RE =
  /^[-*]\s*(?:[*!]\s*)?(?:\d{1,2}:\d{2}\s*)?(?:[*!]\s*)?(?:\[[^\n\]]{1,24}\]\s*)?$/;

function splitExtraLink(raw) {
  const match = raw.match(/^(.*?)\s+(?:->|→)\s+((?:https?:\/\/|\/)\S+)\s*$/);
  if (!match) return { text: raw.trim(), extraLink: null };
  return { text: match[1].trim(), extraLink: match[2].trim() };
}

function normalizeWikilinkKey(rawTarget) {
  return rawTarget
    .trim()
    .replace(/^\/+/, '')
    .replace(/^(?:writing|projects|log)\//i, '')
    .replace(/\.md$/i, '')
    .toUpperCase();
}

function cleanPlainLogText(text, refMap) {
  return text
    .replace(/\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g, (_, rawTarget, _heading, alias) => {
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

function extractLogMoments(logEntries, refMap) {
  const moments = [];
  for (const entry of logEntries) {
    const body = (entry.body ?? '').replace(/^\uFEFF/, '').trim();
    if (!body) continue;

    const lines = body.split(/\r?\n/);
    const hasBullet = lines.some((l) => /^[-*](?:\s|$)/.test(l));
    if (hasBullet) {
      const rawItems = [];
      for (const line of lines) {
        if (/^[-*](?:\s|$)/.test(line)) {
          rawItems.push(line);
        } else if (/^\s+\S/.test(line) && rawItems.length > 0) {
          rawItems[rawItems.length - 1] += ` ${line.trim()}`;
        } else if (line.trim() && rawItems.length === 0) {
          rawItems.push(`- ${line.trim()}`);
        }
      }
      for (const item of rawItems) {
        if (EMPTY_BULLET_RE.test(item.trim())) continue;
        const m = item.match(BULLET_LINE_RE);
        if (!m) continue;
        const { text, extraLink } = splitExtraLink(m[6]);
        if (!text) continue;
        moments.push({
          sourceText: text,
          rawText: cleanPlainLogText(text, refMap),
          extraLink: extraLink ?? entry.data.link ?? null,
        });
      }
    } else {
      moments.push({
        sourceText: body,
        rawText: cleanPlainLogText(body, refMap),
        extraLink: entry.data.link ?? null,
      });
    }
  }
  return moments;
}

function countLogMentions(moments, matchKeys) {
  const normalizedKeys = matchKeys.map((k) => String(k || '').trim().toUpperCase()).filter(Boolean);
  if (normalizedKeys.length === 0) return 0;
  let count = 0;
  for (const m of moments) {
    const hay = `${m.sourceText} ${m.rawText} ${m.extraLink ?? ''}`.toUpperCase();
    if (normalizedKeys.some((k) => hay.includes(k))) count++;
  }
  return count;
}

/* ---------- 与 src/lib/temp.ts 保持一致的核心校准算法 ---------- */

function stripFencedCodeBlocks(body) {
  const lines = body.split(/\r?\n/);
  const out = [];
  let fenceChar = null;
  let fenceLen = 0;

  for (const line of lines) {
    if (!fenceChar) {
      const open = line.match(/^\s*(`{3,}|~{3,})/);
      if (open) {
        fenceChar = open[1][0];
        fenceLen = open[1].length;
        continue;
      }
      out.push(line);
    } else {
      const closeRe = new RegExp(`^\\s*${fenceChar}{${fenceLen},}\\s*$`);
      if (closeRe.test(line)) {
        fenceChar = null;
        fenceLen = 0;
      }
    }
  }
  return out.join('\n');
}

function countEpistemicMarkers(body) {
  if (!body) return { openCount: 0, decisionOrFailedCount: 0, figureCount: 0 };
  const clean = stripFencedCodeBlocks(body);
  let openCount = 0;
  let decisionOrFailedCount = 0;
  let figureCount = 0;

  const classAttrRe = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let m;
  while ((m = classAttrRe.exec(clean)) !== null) {
    const raw = (m[1] ?? m[2] ?? '').trim();
    if (!raw) continue;
    const tokens = new Set(raw.toLowerCase().split(/\s+/));
    if (tokens.has('note')) {
      if (tokens.has('open')) openCount++;
      if (tokens.has('decision') || tokens.has('failed')) decisionOrFailedCount++;
    }
    if (tokens.has('fig') || tokens.has('diagram-figure')) {
      figureCount++;
    }
  }
  return { openCount, decisionOrFailedCount, figureCount };
}

function bodyMentionsAny(body, keys) {
  if (!body) return false;
  for (const rawKey of keys) {
    const key = String(rawKey || '').trim();
    if (!key) continue;
    const re = new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(key)}(?![A-Za-z0-9_-])`, 'i');
    if (re.test(body)) return true;
  }
  return false;
}

function finalizeBreakdown(status, band, rawFactors) {
  const sumDelta = round2(rawFactors.reduce((acc, f) => acc + f.rawDelta, 0));
  const unclamped = band.base + band.scale * sumDelta;
  const clamped = Math.max(band.min, Math.min(band.max, unclamped));
  const temp = round1(clamped);

  const factors = rawFactors
    .filter((f) => f.rawDelta !== 0)
    .map((f) => ({
      label: f.label,
      rawDelta: round2(f.rawDelta),
      delta: round2(f.rawDelta * band.scale),
    }));

  const nearTransition =
    (status === 'draft' || status === 'exploring' || status === 'tested') &&
    temp <= round1(band.min + 0.3);

  const parts = [
    `${STATUS_STATE[status]}基准 ${band.base.toFixed(1)}°`,
    ...factors.map((f) => `${f.label} ${fmtSignedDelta(f.delta)}`),
  ];

  return {
    temp,
    status,
    band,
    isManual: false,
    nearTransition,
    factors,
    formulaText: `${parts.join(' · ')} → ${temp.toFixed(1)}°C`,
  };
}

function computeWritingTemp(input) {
  const band = PHASE_BAND[input.status] ?? null;
  if (input.temperature != null) {
    const temp = round1(input.temperature);
    return {
      temp,
      status: input.status,
      band,
      isManual: true,
      nearTransition: false,
      factors: [],
      formulaText: `手动标定 ${temp.toFixed(1)}°C`,
    };
  }
  if (!band) {
    return {
      temp: null,
      status: input.status,
      band: null,
      isManual: false,
      nearTransition: false,
      factors: [],
      formulaText: '已升华归档',
    };
  }

  const rawFactors = [];

  const confCfg = CONFIDENCE_DELTA[(input.confidence ?? '').trim()];
  if (confCfg && confCfg.raw !== 0) {
    rawFactors.push({ label: confCfg.label, rawDelta: confCfg.raw });
  }

  const catCfg = CATEGORY_DELTA[(input.category ?? '').trim()];
  if (catCfg && catCfg.raw !== 0) {
    rawFactors.push({ label: catCfg.label, rawDelta: catCfg.raw });
  }

  const { openCount, decisionOrFailedCount, figureCount } = countEpistemicMarkers(input.body);
  if (openCount > 0) {
    rawFactors.push({
      label: openCount > 1 ? `未决×${openCount}` : '未决',
      rawDelta: Math.min(0.6, openCount * 0.3),
    });
  }
  if (decisionOrFailedCount > 0) {
    rawFactors.push({
      label: decisionOrFailedCount > 1 ? `推敲×${decisionOrFailedCount}` : '推敲',
      rawDelta: Math.max(-0.5, -decisionOrFailedCount * 0.2),
    });
  }
  if (figureCount > 0) {
    rawFactors.push({
      label: figureCount > 1 ? `图示×${figureCount}` : '图示',
      rawDelta: Math.max(-0.4, -figureCount * 0.08),
    });
  }

  if (input.backlinks > 0) {
    rawFactors.push({
      label: input.backlinks > 1 ? `反链×${input.backlinks}` : '反链',
      rawDelta: Math.max(-1.75, -input.backlinks * 0.35),
    });
  }
  if (input.logMentions > 0) {
    rawFactors.push({
      label: input.logMentions > 1 ? `日志×${input.logMentions}` : '日志',
      rawDelta: Math.max(-0.6, -input.logMentions * 0.15),
    });
  }
  if (input.updated && input.published && input.updated.getTime() > input.published.getTime()) {
    rawFactors.push({ label: '修订', rawDelta: -0.2 });
  }
  const transitions = Math.max(0, (input.tempLogCount ?? 1) - 1);
  if (transitions > 0) {
    rawFactors.push({
      label: transitions > 1 ? `演化×${transitions}` : '演化',
      rawDelta: Math.max(-0.3, -transitions * 0.15),
    });
  }
  if (input.notesCount > 0) {
    rawFactors.push({
      label: input.notesCount > 1 ? `附注×${input.notesCount}` : '附注',
      rawDelta: Math.max(-0.24, -input.notesCount * 0.08),
    });
  }

  return finalizeBreakdown(input.status, band, rawFactors);
}

function computeProjectTemp(input) {
  const band = PHASE_BAND[input.status] ?? null;
  if (input.temperature != null) {
    const temp = round1(input.temperature);
    return {
      temp,
      status: input.status,
      band,
      isManual: true,
      nearTransition: false,
      factors: [],
      formulaText: `手动标定 ${temp.toFixed(1)}°C`,
    };
  }
  if (!band) {
    return {
      temp: null,
      status: input.status,
      band: null,
      isManual: false,
      nearTransition: false,
      factors: [],
      formulaText: '已升华归档',
    };
  }

  const rawFactors = [];
  if (input.systemCount > 0) {
    rawFactors.push({
      label: input.systemCount > 1 ? `系统模块×${input.systemCount}` : '系统模块',
      rawDelta: Math.max(-0.6, -input.systemCount * 0.15),
    });
  }
  if (input.hasNext) {
    rawFactors.push({ label: '待验证', rawDelta: 0.2 });
  }
  if (input.writingMentions > 0) {
    rawFactors.push({
      label: input.writingMentions > 1 ? `文章引用×${input.writingMentions}` : '文章引用',
      rawDelta: Math.max(-0.9, -input.writingMentions * 0.3),
    });
  }
  if (input.logMentions > 0) {
    rawFactors.push({
      label: input.logMentions > 1 ? `日志×${input.logMentions}` : '日志',
      rawDelta: Math.max(-0.6, -input.logMentions * 0.15),
    });
  }

  return finalizeBreakdown(input.status, band, rawFactors);
}

function siteTemp(temps) {
  const xs = temps.filter((t) => t != null).sort((a, b) => a - b);
  if (!xs.length) return 12.7;
  const mid = xs.length >> 1;
  const m = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  return round1(m);
}

/* ---------- 终端报表输出 ---------- */

function displayWidth(str) {
  let w = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    w += cp > 0x2e7f ? 2 : 1;
  }
  return w;
}

function padEndDisplay(str, targetWidth) {
  const diff = targetWidth - displayWidth(str);
  return diff > 0 ? str + ' '.repeat(diff) : str;
}

function main() {
  const writing = readMarkdownDir('writing');
  const projects = readMarkdownDir('projects');
  const logs = readMarkdownDir('log');

  const refMap = {};
  for (const w of writing) {
    const id = String(w.data.id || w.id).toUpperCase();
    const target = { id, href: `/writing/${w.id}/`, title: w.data.title || w.id };
    refMap[id] = target;
    refMap[w.id.toUpperCase()] = target;
  }
  for (const p of projects) {
    const id = String(p.data.id || p.id).toUpperCase();
    const target = { id, href: `/projects/#${id.toLowerCase()}`, title: p.data.title || p.id };
    refMap[id] = target;
    refMap[p.id.toUpperCase()] = target;
  }

  const logMoments = extractLogMoments(logs, refMap);
  const activeWriting = writing.filter((w) => w.data.status !== 'deprecated');

  const writingRows = writing.map((w) => {
    const d = w.data;
    const code = String(d.id || w.id);
    const backlinks = activeWriting.filter(
      (other) => other.id !== w.id && bodyMentionsAny(other.body, [code, w.id])
    ).length;
    const logMentions = countLogMentions(logMoments, [code, w.id]);

    const res = computeWritingTemp({
      status: d.status,
      temperature: parseNumber(d.temperature),
      confidence: d.confidence,
      category: d.category,
      body: w.body,
      published: parseDate(d.published),
      updated: parseDate(d.updated),
      tempLogCount: Array.isArray(d.tempLog) ? d.tempLog.length : 1,
      notesCount: Array.isArray(d.notes) ? d.notes.length : 0,
      backlinks,
      logMentions,
    });

    return { code, slug: w.id, title: d.title || w.id, seriesOf: d.seriesOf || null, res };
  });

  const projectRows = projects
    .sort((a, b) => (parseNumber(a.data.order) ?? 0) - (parseNumber(b.data.order) ?? 0))
    .map((p) => {
      const d = p.data;
      const code = String(d.id || p.id);
      const writingMentions = activeWriting.filter((w) =>
        bodyMentionsAny(w.body, [code, p.id])
      ).length;
      const logMentions = countLogMentions(logMoments, [code, p.id]);

      const res = computeProjectTemp({
        status: d.status,
        temperature: parseNumber(d.temperature),
        systemCount: Array.isArray(d.system) ? d.system.length : 0,
        hasNext: Boolean(d.next && String(d.next).trim()),
        writingMentions,
        logMentions,
      });

      return { code, slug: p.id, title: d.title || p.id, res };
    });

  const median = siteTemp([
    ...writingRows.filter((r) => !r.seriesOf).map((r) => r.res.temp),
    ...projectRows.map((r) => r.res.temp),
  ]);

  const sortByTemp = process.argv.includes('--temp') || process.argv.includes('--sort=temp');
  if (sortByTemp) {
    writingRows.sort((a, b) => (b.res.temp ?? -999) - (a.res.temp ?? -999) || a.code.localeCompare(b.code));
  }

  console.log('');
  console.log('低温笔记 LowTemp Notes · 全站温度校准报告');
  console.log('温区: draft 17.0–19.8° (×0.75) | exploring 11.0–16.8° (×1.00) | tested 6.6–10.8° (×0.75) | stable 3.2–6.4° (×0.55)');
  console.log('─'.repeat(118));

  console.log(`\n[文章 Writing · 共 ${writingRows.length} 篇]`);
  for (const row of writingRows) {
    const { code, title, res } = row;
    const phase = `${STATUS_LABEL[res.status] ?? res.status}/${STATUS_STATE[res.status] ?? ''}`;
    const tempStr = fmtTemp(res.temp).padStart(6);
    const flag = res.nearTransition ? ' [临近相变]' : res.isManual ? ' [手动]' : '';
    const shortTitle = title.length > 22 ? `${title.slice(0, 21)}…` : title;
    console.log(
      `  ${code.padEnd(8)} ${padEndDisplay(phase, 14)} ${tempStr}  ${padEndDisplay(shortTitle, 38)}  ${res.formulaText}${flag}`
    );
  }

  console.log(`\n[项目 Projects · 共 ${projectRows.length} 项]`);
  for (const row of projectRows) {
    const { code, title, res } = row;
    const phase = `${STATUS_LABEL[res.status] ?? res.status}/${STATUS_STATE[res.status] ?? ''}`;
    const tempStr = fmtTemp(res.temp).padStart(6);
    const flag = res.nearTransition ? ' [临近相变]' : res.isManual ? ' [手动]' : '';
    console.log(
      `  ${code.padEnd(8)} ${padEndDisplay(phase, 14)} ${tempStr}  ${padEndDisplay(title, 38)}  ${res.formulaText}${flag}`
    );
  }

  const phaseCounts = { draft: 0, exploring: 0, tested: 0, stable: 0, deprecated: 0 };
  for (const row of [...writingRows, ...projectRows]) {
    if (row.res.status in phaseCounts) phaseCounts[row.res.status]++;
  }

  const nearList = [...writingRows, ...projectRows].filter((r) => r.res.nearTransition);

  console.log('');
  console.log('─'.repeat(118));
  console.log(
    `全站中位温度: ${median.toFixed(1)}°C  |  分布: 草稿 ${phaseCounts.draft} · 探索 ${phaseCounts.exploring} · 已验证 ${phaseCounts.tested} · 稳定 ${phaseCounts.stable} · 已废弃 ${phaseCounts.deprecated}`
  );
  if (nearList.length > 0) {
    console.log(
      `临近相变提示: ${nearList.map((r) => `${r.code} (${fmtTemp(r.res.temp)})`).join('、')}`
    );
  }
  console.log('');
}

main();
