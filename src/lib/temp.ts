/* 温度即状态 — design.md §1 */

export type Status = 'draft' | 'exploring' | 'tested' | 'stable' | 'deprecated';

export const STATUS_TEMP: Record<Status, number | null> = {
  draft: 19.5,
  exploring: 14.0,
  tested: 8.4,
  stable: 4.2,
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

export function tempOf(status: Status, override?: number | null): number | null {
  return override ?? STATUS_TEMP[status];
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
  return Math.round(m * 10) / 10;
}

export function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())}`;
}
