/**
 * 构建期 OG 分享卡片渲染器（1200×630 PNG）
 * 使用 satori 将排版与温度谱尺转为纯矢量路径 SVG，再由 sharp 光栅化为 PNG，
 * 不依赖 CI 容器的系统字库（在 Cloudflare Pages 构建环境中不会出现中文方块字）。
 */
import satori, { type Font } from 'satori';
import sharp from 'sharp';
import {
  THERMO_MAX,
  THERMO_MIN,
  THERMO_MAJORS,
  STATUS_LABEL,
  STATUS_STATE,
  CATEGORY_LABEL,
  fmtDate,
  fmtTemp,
  type Status,
} from './temp';

const WIDTH = 1200;
const HEIGHT = 630;
const PAD_X = 88;
const CONTENT_W = WIDTH - PAD_X * 2; // 1024px

/* 对应 tokens.css 深色银盐冷暖灰（Split-Tone Grey）与墨阶 */
const PALETTE = {
  bg: '#0c0e12',
  ink0: '#d6dae3',
  ink1: '#8b91a0',
  ink2: '#6a7080',
  line: '#20242d',
  accent: '#8b82d9',
  phase: {
    draft: '#787067',
    exploring: '#8c9096',
    tested: '#9eb4c9',
    stable: '#d4e8fa',
    deprecated: '#c1787a',
  } satisfies Record<Status, string>,
};

const TTF_UA =
  'Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1';

let cachedFontsPromise: Promise<Font[]> | null = null;
let cachedCharset = '';

async function fetchGoogleFontTtf(familyQuery: string, textSubset: string): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css2?family=${familyQuery}&text=${encodeURIComponent(textSubset)}`;
  const cssRes = await fetch(url, { headers: { 'User-Agent': TTF_UA } });
  if (!cssRes.ok) {
    throw new Error(`Failed to fetch Google Fonts CSS (${cssRes.status}): ${familyQuery}`);
  }
  const css = await cssRes.text();
  const match =
    css.match(/src:\s*url\(([^)]+)\)\s*format\(['"]?(?:truetype|opentype|woff)['"]?\)/i) ??
    css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/i);
  if (!match?.[1]) {
    throw new Error(`Could not parse font URL from CSS for ${familyQuery}`);
  }
  const fontRes = await fetch(match[1]);
  if (!fontRes.ok) {
    throw new Error(`Failed to download font binary (${fontRes.status}): ${match[1]}`);
  }
  return fontRes.arrayBuffer();
}

export async function ensureOgFonts(extraChars: string): Promise<Font[]> {
  const baseAscii =
    ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~' +
    '低温笔记在噪声退去之后，记录仍然成立的东西。草稿探索已验证稳定已废弃雾液态结晶中升华工程研究建造日志随笔站点中位温度越确定冷共篇阅读分钟·—°C「」《》、：；？！（）—…';
  const merged = Array.from(new Set((baseAscii + extraChars).replace(/\s+/g, ' '))).join('');

  if (cachedFontsPromise && [...merged].every((ch) => cachedCharset.includes(ch))) {
    return cachedFontsPromise;
  }

  cachedCharset = Array.from(new Set(cachedCharset + merged)).join('');
  const subset = cachedCharset;

  cachedFontsPromise = Promise.all([
    fetchGoogleFontTtf('Noto+Serif+SC:wght@600', subset),
    fetchGoogleFontTtf('Noto+Sans+SC:wght@400', subset),
    fetchGoogleFontTtf('IBM+Plex+Mono:wght@500', subset),
  ]).then(([serifBuf, sansBuf, monoBuf]) => [
    { name: 'Noto Serif SC', data: serifBuf, weight: 600, style: 'normal' as const },
    { name: 'Noto Sans SC', data: sansBuf, weight: 400, style: 'normal' as const },
    { name: 'IBM Plex Mono', data: monoBuf, weight: 500, style: 'normal' as const },
  ]);

  return cachedFontsPromise;
}

type HNode = {
  type: string;
  props: Record<string, any>;
};

const h = (type: string, props: Record<string, any> = {}, ...children: any[]): HNode => {
  const flat = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
  return {
    type,
    props: {
      ...props,
      children: flat.length === 0 ? undefined : flat.length === 1 ? flat[0] : flat,
    },
  };
};

function clampText(s: string, maxLen: number): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > maxLen ? `${clean.slice(0, maxLen - 1).trim()}…` : clean;
}

function posPct(temp: number): number {
  const clamped = Math.max(THERMO_MIN + 0.15, Math.min(THERMO_MAX - 0.15, temp));
  return ((THERMO_MAX - clamped) / (THERMO_MAX - THERMO_MIN)) * 100;
}

function buildBrandMark(): HNode {
  return h(
    'svg',
    {
      width: '22',
      height: '22',
      viewBox: '0 0 28 28',
      fill: 'none',
      style: { marginRight: '10px' },
    },
    h('path', {
      d: 'M9 5 V24 H20',
      stroke: PALETTE.ink0,
      'stroke-width': '1.6',
      'stroke-linecap': 'square',
    }),
    h('line', { x1: '11', y1: '8.5', x2: '20.5', y2: '4', stroke: PALETTE.ink0, 'stroke-width': '1.5' }),
    h('line', { x1: '11', y1: '12.5', x2: '18.5', y2: '8.5', stroke: PALETTE.ink0, 'stroke-width': '1.5' }),
    h('line', { x1: '11', y1: '16.5', x2: '16.5', y2: '13', stroke: PALETTE.ink1, 'stroke-width': '1.5' }),
    h('line', { x1: '11', y1: '20.5', x2: '14.8', y2: '17.5', stroke: PALETTE.accent, 'stroke-width': '1.6' })
  );
}

function buildThermoRuler(pins: Array<{ temp: number; color: string; active?: boolean }>): HNode {
  const rulerW = CONTENT_W;
  const span = THERMO_MAX - THERMO_MIN;
  const halfSteps = Math.round(span * 2);
  const majorSet = new Set<number>(THERMO_MAJORS);

  const tickLines = Array.from({ length: halfSteps + 1 }, (_, i) => {
    const t = THERMO_MAX - i * 0.5;
    const x = (((THERMO_MAX - t) / span) * rulerW).toFixed(1);
    const isMajor = majorSet.has(t);
    return h('line', {
      x1: x,
      y1: '0',
      x2: x,
      y2: isMajor ? '9' : '4.5',
      stroke: isMajor ? PALETTE.ink2 : PALETTE.line,
      'stroke-width': '1',
    });
  });

  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: `${rulerW}px`,
      },
    },
    /* 谱线立杆区 */
    h(
      'div',
      {
        style: {
          display: 'flex',
          position: 'relative',
          width: `${rulerW}px`,
          height: '26px',
        },
      },
      ...pins.map((p) => {
        const leftPx = Math.round((posPct(p.temp) / 100) * rulerW);
        const stemH = p.active ? 22 : 15;
        const dotSize = p.active ? 9 : 6;
        return h(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              position: 'absolute',
              left: `${leftPx - Math.floor(dotSize / 2)}px`,
              bottom: '0px',
              width: `${dotSize}px`,
            },
          },
          h('div', {
            style: {
              width: `${dotSize}px`,
              height: `${dotSize}px`,
              borderRadius: '999px',
              backgroundColor: p.color,
            },
          }),
          h('div', {
            style: {
              width: p.active ? '1.5px' : '1px',
              height: `${stemH - Math.floor(dotSize / 2)}px`,
              backgroundColor: p.color,
              opacity: p.active ? 0.95 : 0.7,
            },
          })
        );
      })
    ),
    /* 银盐渐变温度弦 */
    h('div', {
      style: {
        width: `${rulerW}px`,
        height: '1.5px',
        backgroundImage: `linear-gradient(90deg, ${PALETTE.phase.draft} 0%, ${PALETTE.phase.exploring} 38%, ${PALETTE.phase.tested} 66%, ${PALETTE.phase.stable} 100%)`,
        opacity: 0.9,
      },
    }),
    /* 0.5° 矢量刻度 */
    h(
      'svg',
      {
        width: String(rulerW),
        height: '11',
        viewBox: `0 0 ${rulerW} 11`,
      },
      ...tickLines
    ),
    /* 主刻度读数 */
    h(
      'div',
      {
        style: {
          display: 'flex',
          position: 'relative',
          width: `${rulerW}px`,
          height: '18px',
          marginTop: '2px',
        },
      },
      ...THERMO_MAJORS.map((t, idx) => {
        const leftPx = Math.round(((THERMO_MAX - t) / span) * rulerW);
        return h(
          'span',
          {
            style: {
              position: 'absolute',
              left: idx === 0 ? '0px' : `${leftPx - 12}px`,
              fontFamily: 'IBM Plex Mono',
              fontSize: '12.5px',
              color: PALETTE.ink2,
            },
          },
          idx === 0 ? `${t}°C` : `${t}°`
        );
      })
    )
  );
}

export interface ArticleOgInput {
  id: string;
  title: string;
  subtitle?: string;
  excerpt: string;
  category: string;
  status: Status;
  temp: number | null;
  published: Date;
  minutes: number;
  allTextForFontSubset: string;
}

export async function renderArticleOgPng(input: ArticleOgInput): Promise<Buffer> {
  const fonts = await ensureOgFonts(input.allTextForFontSubset);
  const phaseColor = PALETTE.phase[input.status];
  const categoryLabel = CATEGORY_LABEL[input.category] || input.category;
  const statusLabel = STATUS_LABEL[input.status];
  const stateLabel = STATUS_STATE[input.status];
  const tempStr = fmtTemp(input.temp);
  const subText = clampText(input.subtitle || input.excerpt, 68);

  const titleLen = input.title.length;
  const titleFontSize = titleLen <= 18 ? 50 : titleLen <= 28 ? 44 : 38;

  const tree = h(
    'div',
    {
      style: {
        width: `${WIDTH}px`,
        height: `${HEIGHT}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: PALETTE.bg,
        color: PALETTE.ink0,
        fontFamily: 'Noto Sans SC',
      },
    },
    h(
      'div',
      {
        style: {
          width: `${CONTENT_W}px`,
          height: `${HEIGHT - 96}px`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        },
      },
    /* 顶栏（严格锁定 1024px 版心宽） */
    h(
      'div',
      {
        style: {
          width: `${CONTENT_W}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingBottom: '18px',
          borderBottom: `1px solid ${PALETTE.line}`,
        },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center' } },
        buildBrandMark(),
        h(
          'span',
          {
            style: {
              fontFamily: 'Noto Serif SC',
              fontSize: '20px',
              fontWeight: 600,
              letterSpacing: '0.06em',
              color: PALETTE.ink0,
            },
          },
          '低温笔记'
        ),
        h('span', { style: { margin: '0 10px', color: PALETTE.ink2, fontSize: '16px' } }, '·'),
        h(
          'span',
          {
            style: {
              fontFamily: 'IBM Plex Mono',
              fontSize: '15px',
              letterSpacing: '0.02em',
              color: PALETTE.ink2,
            },
          },
          'blog.muyuzhong.xyz'
        )
      ),
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            fontSize: '16px',
            color: PALETTE.ink1,
          },
        },
        h(
          'span',
          {
            style: {
              fontFamily: 'IBM Plex Mono',
              fontSize: '16px',
              letterSpacing: '0.06em',
              color: PALETTE.ink0,
            },
          },
          input.id
        ),
        h('span', { style: { margin: '0 10px', color: PALETTE.ink2 } }, '·'),
        h('span', { style: { color: PALETTE.ink1 } }, categoryLabel)
      )
    ),

    /* 中部：衬线大标题 + 副题（严格锁定 1024px 自动换行） */
    h(
      'div',
      {
        style: {
          width: `${CONTENT_W}px`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        },
      },
      h(
        'div',
        {
          style: {
            width: `${CONTENT_W}px`,
            fontFamily: 'Noto Serif SC',
            fontSize: `${titleFontSize}px`,
            fontWeight: 600,
            lineHeight: 1.35,
            letterSpacing: '0.01em',
            color: PALETTE.ink0,
          },
        },
        clampText(input.title, 46)
      ),
      subText &&
        h(
          'div',
          {
            style: {
              width: `${CONTENT_W}px`,
              marginTop: '18px',
              fontFamily: 'Noto Sans SC',
              fontSize: '21px',
              lineHeight: 1.58,
              color: PALETTE.ink1,
            },
          },
          subText
        )
    ),

    /* 底部：真实温度坐标尺 + 物态与日期读数 */
    h(
      'div',
      {
        style: {
          width: `${CONTENT_W}px`,
          display: 'flex',
          flexDirection: 'column',
        },
      },
      buildThermoRuler(
        input.temp != null ? [{ temp: input.temp, color: phaseColor, active: true }] : []
      ),
      h(
        'div',
        {
          style: {
            width: `${CONTENT_W}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: '12px',
            fontSize: '16px',
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center' } },
          h('div', {
            style: {
              width: '8px',
              height: '8px',
              borderRadius: '999px',
              backgroundColor: phaseColor,
              marginRight: '9px',
            },
          }),
          h('span', { style: { color: PALETTE.ink0 } }, `${statusLabel} · ${stateLabel}`),
          h(
            'span',
            {
              style: {
                marginLeft: '10px',
                fontFamily: 'IBM Plex Mono',
                fontSize: '16px',
                color: PALETTE.ink1,
              },
            },
            tempStr
          )
        ),
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              fontFamily: 'IBM Plex Mono',
              fontSize: '15px',
              letterSpacing: '0.04em',
              color: PALETTE.ink2,
            },
          },
          h('span', {}, fmtDate(input.published)),
          h('span', { style: { margin: '0 10px' } }, '·'),
          h('span', {}, `${input.minutes} MIN`)
        )
      )
    )
    )
  );

  const svg = await satori(tree as any, { width: WIDTH, height: HEIGHT, fonts });
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

export async function renderSiteOgPng(opts: {
  medianTemp: number;
  articleCount: number;
  pins: Array<{ temp: number; status: Status }>;
  allTextForFontSubset: string;
}): Promise<Buffer> {
  const fonts = await ensureOgFonts(opts.allTextForFontSubset);

  /* 同温谱线轻微拆分双线（±0.12°C），与首页 ThermoStrip 视觉一致 */
  const sortedPins = [...opts.pins].sort((a, b) => b.temp - a.temp);
  const adjustedTemps = sortedPins.map((p) => p.temp);
  let i = 0;
  while (i < sortedPins.length) {
    let end = i + 1;
    while (end < sortedPins.length && sortedPins[end - 1].temp - sortedPins[end].temp < 0.18) end++;
    if (end - i > 1) {
      const cnt = end - i;
      const center = sortedPins.slice(i, end).reduce((s, x) => s + x.temp, 0) / cnt;
      for (let k = 0; k < cnt; k++) {
        adjustedTemps[i + k] = center + ((cnt - 1) / 2 - k) * 0.24;
      }
    }
    i = end;
  }

  const tree = h(
    'div',
    {
      style: {
        width: `${WIDTH}px`,
        height: `${HEIGHT}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: PALETTE.bg,
        color: PALETTE.ink0,
        fontFamily: 'Noto Sans SC',
      },
    },
    h(
      'div',
      {
        style: {
          width: `${CONTENT_W}px`,
          height: `${HEIGHT - 96}px`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        },
      },
    h(
      'div',
      {
        style: {
          width: `${CONTENT_W}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingBottom: '18px',
          borderBottom: `1px solid ${PALETTE.line}`,
        },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center' } },
        buildBrandMark(),
        h(
          'span',
          {
            style: {
              fontFamily: 'IBM Plex Mono',
              fontSize: '15px',
              letterSpacing: '0.12em',
              color: PALETTE.ink2,
            },
          },
          'LOWTEMP NOTES'
        )
      ),
      h(
        'span',
        {
          style: {
            fontFamily: 'IBM Plex Mono',
            fontSize: '15px',
            color: PALETTE.ink2,
          },
        },
        'blog.muyuzhong.xyz'
      )
    ),

    h(
      'div',
      {
        style: {
          width: `${CONTENT_W}px`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        },
      },
      h(
        'div',
        {
          style: {
            fontFamily: 'Noto Serif SC',
            fontSize: '68px',
            fontWeight: 600,
            letterSpacing: '0.04em',
            color: PALETTE.ink0,
          },
        },
        '低温笔记'
      ),
      h(
        'div',
        {
          style: {
            marginTop: '16px',
            fontFamily: 'Noto Serif SC',
            fontSize: '26px',
            color: PALETTE.ink1,
          },
        },
        '在噪声退去之后，记录仍然成立的东西。'
      ),
      h(
        'div',
        {
          style: {
            marginTop: '14px',
            fontSize: '17px',
            color: PALETTE.ink2,
          },
        },
        'Agent 工程 · Coding Agent · 上下文工程 · 增量验证'
      )
    ),

    h(
      'div',
      { style: { width: `${CONTENT_W}px`, display: 'flex', flexDirection: 'column' } },
      buildThermoRuler(
        sortedPins.map((p, idx) => ({
          temp: adjustedTemps[idx],
          color: PALETTE.phase[p.status],
          active: false,
        }))
      ),
      h(
        'div',
        {
          style: {
            width: `${CONTENT_W}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: '12px',
            fontSize: '15.5px',
            color: PALETTE.ink2,
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center' } },
          h('div', {
            style: {
              width: '7px',
              height: '7px',
              borderRadius: '999px',
              backgroundColor: PALETTE.phase.stable,
              marginRight: '9px',
            },
          }),
          h('span', { style: { color: PALETTE.ink1 } }, `站点中位温度 ${opts.medianTemp.toFixed(1)}°C`),
          h('span', { style: { margin: '0 10px' } }, '·'),
          h('span', {}, '越确定，越冷')
        ),
        h(
          'span',
          { style: { fontFamily: 'IBM Plex Mono', fontSize: '14.5px', letterSpacing: '0.04em' } },
          `${opts.articleCount} NOTES ARCHIVED`
        )
      )
    )
    )
  );

  const svg = await satori(tree as any, { width: WIDTH, height: HEIGHT, fonts });
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}
