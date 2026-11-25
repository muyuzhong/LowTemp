/* 温度即状态 — 多维物理校准系统 (design.md §1) */

export type Status = 'draft' | 'exploring' | 'tested' | 'stable' | 'deprecated';

export interface PhaseBand {
  min: number;
  max: number;
  base: number;
  scale: number;
}

/**
 * 物态温区、基准温度与相态热容灵敏度（Phase Band）
 * 低温物理中越接近结晶态热涨落越小，各 status 温区严格互不越界。
 */
export const PHASE_BAND: Record<Status, PhaseBand | null> = {
  draft: { min: 17.0, max: 19.8, base: 18.1, scale: 0.75 },
  exploring: { min: 11.0, max: 16.8, base: 14.2, scale: 1.0 },
  tested: { min: 6.6, max: 10.8, base: 9.4, scale: 0.75 },
  stable: { min: 3.2, max: 6.4, base: 5.4, scale: 0.55 },
  deprecated: null,
};

/** 静态基准温度（兜底值 = PHASE_BAND[status].base） */
export const STATUS_TEMP: Record<Status, number | null> = {
  draft: 18.1,
  exploring: 14.2,
  tested: 9.4,
  stable: 5.4,
  deprecated: null,
};

export const STATUS_LABEL: Record<Status, string> = {
  draft: '草稿',
  exploring: '探索',
  tested: '已验证',
  stable: '稳定',
  deprecated: '已废弃',
};

/** 物态 — design.md §1.1 */
export const STATUS_STATE: Record<Status, string> = {
  draft: '雾',
  exploring: '液态',
  tested: '结晶中',
  stable: '结晶',
  deprecated: '升华',
};

/** 状态对应的颜色 token（银盐冷暖灰 Split-Tone Grey） — design.md §1 / §3 */
export const STATUS_COLOR: Record<Status, string> = {
  draft: 'var(--phase-draft)',
  exploring: 'var(--phase-exploring)',
  tested: 'var(--phase-tested)',
  stable: 'var(--phase-stable)',
  deprecated: 'var(--red)',
};

/** 首页温度谱尺刻度参数与四档物态色标位置（暖 → 冷） */
export const THERMO_PHASES = ['draft', 'exploring', 'tested', 'stable'] as const;
export const THERMO_STOP_AT = [0, 0.38, 0.66, 1] as const;
export const THERMO_MAX = 20;
export const THERMO_MIN = 3;
export const THERMO_MAJORS = [20, 16, 12, 8, 4] as const;

export const CATEGORY_LABEL: Record<string, string> = {
  engineering: '工程',
  research: '研究笔记',
  buildlog: '建造日志',
  reflection: '随笔',
};

export interface TempFactor {
  label: string;
  /** 乘过相态灵敏度 scale 后的实际贡献值（°C） */
  delta: number;
  /** 未乘 scale 的原始分量值 */
  rawDelta: number;
}

export interface TempBreakdown {
  temp: number | null;
  status: Status;
  band: PhaseBand | null;
  base: number | null;
  scale: number | null;
  sumDelta: number;
  unclamped: number | null;
  isManual: boolean;
  nearTransition: boolean;
  factors: TempFactor[];
  formulaText: string;
}

export interface EpistemicMarkers {
  openCount: number;
  decisionOrFailedCount: number;
  figureCount: number;
}

export interface WritingTempInput {
  status: Status;
  temperature?: number | null;
  confidence?: string | null;
  category?: string | null;
  body?: string | null;
  published: Date;
  updated?: Date | null;
  tempLog?: { date: Date; status: Status }[] | null;
  notes?: { anchor: string; text: string }[] | null;
  backlinks?: number;
  logMentions?: number;
}

export interface ProjectTempInput {
  status: Status;
  temperature?: number | null;
  system?: string[] | null;
  next?: string | null;
  writingMentions?: number;
  logMentions?: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

function fmtSignedDelta(delta: number): string {
  const sign = delta >= 0 ? '+' : '−';
  const abs = Math.abs(delta);
  if (abs > 0 && abs < 0.05) {
    return `${sign}${(Math.round((abs + 1e-9) * 100) / 100).toFixed(2)}°`;
  }
  return `${sign}${(Math.round((abs + 1e-9) * 10) / 10).toFixed(1)}°`;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 去除 Markdown fenced code blocks（``` 或 ~~~），避免代码块内示例 HTML 误触发认识论标记 */
export function stripFencedCodeBlocks(body: string): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  let fenceChar: string | null = null;
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

/** 统计去除代码块后的正文认识论 HTML 标记（按精确 CSS class token 匹配） */
export function countEpistemicMarkers(body: string | null | undefined): EpistemicMarkers {
  if (!body) return { openCount: 0, decisionOrFailedCount: 0, figureCount: 0 };
  const clean = stripFencedCodeBlocks(body);
  let openCount = 0;
  let decisionOrFailedCount = 0;
  let figureCount = 0;

  const classAttrRe = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
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

/** 判断正文是否提及任一编号/slug（大小写不敏感，严格词边界） */
export function bodyMentionsAny(body: string | null | undefined, keys: string[]): boolean {
  if (!body) return false;
  for (const rawKey of keys) {
    const key = rawKey.trim();
    if (!key) continue;
    const re = new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(key)}(?![A-Za-z0-9_-])`, 'i');
    if (re.test(body)) return true;
  }
  return false;
}

const CONFIDENCE_DELTA: Record<string, { raw: number; label: string }> = {
  低: { raw: 1.0, label: '置信低' },
  中: { raw: 0.0, label: '置信中' },
  中高: { raw: -0.7, label: '置信中高' },
  高: { raw: -1.3, label: '置信高' },
};

const CATEGORY_DELTA: Record<string, { raw: number; label: string }> = {
  reflection: { raw: 0.4, label: '随笔' },
  research: { raw: 0.0, label: '研究笔记' },
  buildlog: { raw: -0.2, label: '建造日志' },
  engineering: { raw: -0.3, label: '工程' },
};

function finalizeBreakdown(
  status: Status,
  band: PhaseBand,
  rawFactors: { label: string; rawDelta: number }[]
): TempBreakdown {
  const sumDelta = round2(rawFactors.reduce((acc, f) => acc + f.rawDelta, 0));
  const unclamped = band.base + band.scale * sumDelta;
  const clamped = Math.max(band.min, Math.min(band.max, unclamped));
  const temp = round1(clamped);

  const factors: TempFactor[] = rawFactors
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
  const formulaText = `${parts.join(' · ')} → ${temp.toFixed(1)}°C`;

  return {
    temp,
    status,
    band,
    base: band.base,
    scale: band.scale,
    sumDelta,
    unclamped: round2(unclamped),
    isManual: false,
    nearTransition,
    factors,
    formulaText,
  };
}

/** 计算单篇文章的多维校准温度与分解明细 */
export function computeWritingTemp(input: WritingTempInput): TempBreakdown {
  const band = PHASE_BAND[input.status];

  if (input.temperature != null) {
    const temp = round1(input.temperature);
    return {
      temp,
      status: input.status,
      band,
      base: band?.base ?? null,
      scale: band?.scale ?? null,
      sumDelta: 0,
      unclamped: temp,
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
      base: null,
      scale: null,
      sumDelta: 0,
      unclamped: null,
      isManual: false,
      nearTransition: false,
      factors: [],
      formulaText: '已升华归档',
    };
  }

  const rawFactors: { label: string; rawDelta: number }[] = [];

  // 1. 置信度 confidence
  const confKey = input.confidence?.trim() ?? '';
  const confCfg = CONFIDENCE_DELTA[confKey];
  if (confCfg && confCfg.raw !== 0) {
    rawFactors.push({ label: confCfg.label, rawDelta: confCfg.raw });
  }

  // 2. 分类 category
  const catKey = input.category?.trim() ?? '';
  const catCfg = CATEGORY_DELTA[catKey];
  if (catCfg && catCfg.raw !== 0) {
    rawFactors.push({ label: catCfg.label, rawDelta: catCfg.raw });
  }

  // 3. 正文认识论标记（已剥离 fenced code blocks）
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

  // 4. 知识图谱与日常轨迹动态降温
  const backlinks = input.backlinks ?? 0;
  if (backlinks > 0) {
    rawFactors.push({
      label: backlinks > 1 ? `反链×${backlinks}` : '反链',
      rawDelta: Math.max(-1.75, -backlinks * 0.35),
    });
  }

  const logMentions = input.logMentions ?? 0;
  if (logMentions > 0) {
    rawFactors.push({
      label: logMentions > 1 ? `日志×${logMentions}` : '日志',
      rawDelta: Math.max(-0.6, -logMentions * 0.15),
    });
  }

  if (input.updated && input.updated.getTime() > input.published.getTime()) {
    rawFactors.push({ label: '修订', rawDelta: -0.2 });
  }

  const transitions = Math.max(0, (input.tempLog?.length ?? 1) - 1);
  if (transitions > 0) {
    rawFactors.push({
      label: transitions > 1 ? `演化×${transitions}` : '演化',
      rawDelta: Math.max(-0.3, -transitions * 0.15),
    });
  }

  const notesCount = input.notes?.length ?? 0;
  if (notesCount > 0) {
    rawFactors.push({
      label: notesCount > 1 ? `附注×${notesCount}` : '附注',
      rawDelta: Math.max(-0.24, -notesCount * 0.08),
    });
  }

  return finalizeBreakdown(input.status, band, rawFactors);
}

/** 计算单个实验室项目的校准温度与分解明细 */
export function computeProjectTemp(input: ProjectTempInput): TempBreakdown {
  const band = PHASE_BAND[input.status];

  if (input.temperature != null) {
    const temp = round1(input.temperature);
    return {
      temp,
      status: input.status,
      band,
      base: band?.base ?? null,
      scale: band?.scale ?? null,
      sumDelta: 0,
      unclamped: temp,
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
      base: null,
      scale: null,
      sumDelta: 0,
      unclamped: null,
      isManual: false,
      nearTransition: false,
      factors: [],
      formulaText: '已升华归档',
    };
  }

  const rawFactors: { label: string; rawDelta: number }[] = [];

  const systemCount = input.system?.length ?? 0;
  if (systemCount > 0) {
    rawFactors.push({
      label: systemCount > 1 ? `系统模块×${systemCount}` : '系统模块',
      rawDelta: Math.max(-0.6, -systemCount * 0.15),
    });
  }

  if (input.next && input.next.trim().length > 0) {
    rawFactors.push({ label: '待验证', rawDelta: 0.2 });
  }

  const writingMentions = input.writingMentions ?? 0;
  if (writingMentions > 0) {
    rawFactors.push({
      label: writingMentions > 1 ? `文章引用×${writingMentions}` : '文章引用',
      rawDelta: Math.max(-0.9, -writingMentions * 0.3),
    });
  }

  const logMentions = input.logMentions ?? 0;
  if (logMentions > 0) {
    rawFactors.push({
      label: logMentions > 1 ? `日志×${logMentions}` : '日志',
      rawDelta: Math.max(-0.6, -logMentions * 0.15),
    });
  }

  return finalizeBreakdown(input.status, band, rawFactors);
}

/** 静态兜底温度（无图谱上下文时使用） */
export function tempOf(status: Status, override?: number | null): number | null {
  return override != null ? round1(override) : STATUS_TEMP[status];
}

export function fmtTemp(t: number | null | undefined): string {
  return t == null ? '—°C' : `${t.toFixed(1)}°C`;
}

/** 站点温度 = 全部公开内容温度的中位数（deprecated 不计） */
export function siteTemp(temps: (number | null)[]): number {
  const xs = temps.filter((t): t is number => t != null).sort((a, b) => a - b);
  if (!xs.length) return 12.7;
  const mid = xs.length >> 1;
  const m = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  return round1(m);
}

export function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())}`;
}
