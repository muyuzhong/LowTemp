/* 首页入场:一根弦(design.md §2.6;遮罩与进入的编排见 intro.ts)
 *
 * 画面只有一根 1px 发丝弦和一排短针刻度。弦的横坐标从一开始就与首页温度尺(ThermoStrip)
 * 对齐:版心内是 max → min(20° → 3°),两侧按同一比例向外延伸,左边更暖,右边到零下。
 * 所以进入时它不必「变成」温度尺,只要两端收拢、整根落到色带上,刻度原地锁成半度刻度。
 *
 *  静止  每 4s 一道脉搏从左滑到右,经过处刻度起伏 2px,染上该温度的物态色
 *  横扫  光标下的刻度按高斯钟形浮起(中心 24px),弹簧阻尼;最高处浮出等宽读数
 *  纵穿  弦被光标勾住拉弯,约 40px 处挣脱。弦是带弹性基底的一维波动方程,
 *        所以挣脱后会原地回弹震颤两三下,同时把弦波传向两端
 *  land  点击处一道弦波 → 两端收拢、整根下落、咬合到色带 → 刻度翻到色带下方 → 交给 DOM
 */

type RGB = [number, number, number];

export interface Axis {
  /** 色带左右端(视口坐标) */
  left: number;
  right: number;
  /** 左端 / 右端温度 */
  max: number;
  min: number;
  /** 版心内的主刻度温度 */
  majors: number[];
}

export interface Landing {
  /** 色带中线(视口坐标)、高度、不透明度 */
  y: number;
  thick: number;
  bandAlpha: number;
  /** 色带底边到刻度顶端的距离;半度 / 主刻度长度 */
  gap: number;
  half: number;
  major: number;
}

export interface StringScene {
  /** 静止时弦所在高度(视口坐标) */
  readonly lineY: number;
  /** 从 (x, y) 拨最后一下,然后落到 to 上;to 为 null 时原地淡出。画布交出画面时 resolve */
  land(x: number, y: number, to: Landing | null): Promise<void>;
  destroy(): void;
}

/** 进入时间线(ms,从点击算起);intro.ts 按同一张表编排 DOM */
export const LAND = {
  move: 150, // 两端开始收拢、整根开始下落
  settle: 600, // 落位
  flip: 430, // 弦上的刻度开始收进弦里
  lock: 560, // 色带由 1px 长到实际高度,刻度从下方伸出:咔嗒
  handoff: 700, // 画布把色带与刻度交给 DOM
  fade: 100,
} as const;

const DX = 4; // 弦的离散步长(px)
const WAVE_C = 1100; // 波速(px/s)
const WAVE_K = 34; // 弹性基底(rad/s,约 5.4Hz):宽的弯折原地回弹,窄的波纹传向两端
const DAMP = 7; // 阻尼:回弹两三下后平息
const BEND = 48; // 被勾住时弧线的宽度(sech 形)
const PULL = 40; // 挣脱距离
const PEAK = 24; // 磁吸中心刻度长度
const SIGMA = 32; // 磁吸钟形宽度
const SPRING_K = 520;
const SPRING_C = 28; // 略欠阻尼:浮起时带一点点回弹
const BASE = [3, 5, 8]; // 次刻度 / 半度 / 主刻度的静止长度
const REST_A = [0.36, 0.62, 0.85];
const LINE_A = 0.8;
const PULSE_FIRST = 1900;
const PULSE_EVERY = 4000;
const PULSE_RUN = 2400;
const PULSE_SIGMA = 70;
const FONT = '500 11px "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace';

interface Tick {
  tau: number;
  x: number;
  kind: 0 | 1 | 2; // 次刻度 / 半度 / 主刻度
  /** 落位后对应温度尺上第几根半度刻度;-1 = 收起 */
  keep: number;
  h: number;
  v: number;
}

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth = (t: number) => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const bez = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (bez(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return bez(y1, y2, (lo + hi) / 2);
  };
}
/* 收拢:起步干脆、落位稳 */
const easeMove = cubicBezier(0.65, 0, 0.25, 1);
const easeOut = cubicBezier(0.22, 1, 0.36, 1);

const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export function createStringScene(canvas: HTMLCanvasElement, measure: () => Axis): StringScene | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let dpr = 1;
  let vw = 0;
  let vh = 0;
  let y0 = 0;
  let axis = measure();
  let ppd = 1; // 每度多少 px
  let ticks: Tick[] = [];
  let N = 0;
  let u = new Float32Array(0);
  let vel = new Float32Array(0);
  let still = true;

  /* 颜色:从主题 token 读,经 canvas 规范化成 RGB */
  const col = {
    ink1: [139, 145, 160] as RGB,
    ink2: [106, 112, 128] as RGB,
    line: [32, 36, 45] as RGB,
    stops: [] as RGB[], // 雾紫 → 液蓝 → 结晶中 → 结晶
  };
  const STOP_AT = [0, 0.38, 0.66, 1]; // 与 .thermo-band 的渐变一致
  const parse = (value: string, fallback: RGB): RGB => {
    ctx.fillStyle = '#000';
    ctx.fillStyle = value.trim() || '#000';
    const s = String(ctx.fillStyle);
    if (s[0] === '#') return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) as RGB;
    const m = s.match(/[\d.]+/g);
    return m && m.length >= 3 ? [+m[0], +m[1], +m[2]] : fallback;
  };
  const readColors = () => {
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string, fb: RGB) => parse(cs.getPropertyValue(name), fb);
    col.ink1 = v('--ink-1', col.ink1);
    col.ink2 = v('--ink-2', col.ink2);
    col.line = v('--line', col.line);
    col.stops = [v('--mauve', [138, 132, 163]), v('--blue', [110, 159, 203]), v('--accent', [139, 130, 217]), v('--teal', [112, 170, 166])];
  };

  /** 某温度的物态色 */
  const tempColor = (tau: number): RGB => {
    const p = clamp01((axis.max - tau) / (axis.max - axis.min));
    let i = 0;
    while (i < STOP_AT.length - 2 && p > STOP_AT[i + 1]) i++;
    return mix(col.stops[i], col.stops[i + 1], (p - STOP_AT[i]) / (STOP_AT[i + 1] - STOP_AT[i]));
  };
  const tauAt = (x: number) => axis.max - (x - axis.left) / ppd;

  const buildTicks = () => {
    ppd = (axis.right - axis.left) / (axis.max - axis.min);
    /* 刻度间距不小于约 5px:版心宽时 0.1°,窄屏退到 0.25° / 0.5° */
    const step = ppd * 0.1 >= 5 ? 0.1 : ppd * 0.25 >= 4.5 ? 0.25 : 0.5;
    const px = step * ppd;
    const halves = Math.round((axis.max - axis.min) * 2);
    const kMin = Math.floor(-axis.left / px) - 1;
    const kMax = Math.ceil((vw - axis.left) / px) + 1;
    const isMajor = (tau: number, inside: boolean) =>
      inside ? axis.majors.some((m) => Math.abs(m - tau) < 1e-6) : Math.abs(tau % 4) < 1e-6;
    ticks = [];
    for (let k = kMin; k <= kMax; k++) {
      const halfF = k * step * 2;
      const half = Math.round(halfF);
      const isHalf = Math.abs(halfF - half) < 1e-6;
      const tau = Math.round((axis.max - k * step) * 1000) / 1000;
      const inside = isHalf && half >= 0 && half < halves;
      const kind = isHalf ? (isMajor(tau, inside) ? 2 : 1) : 0;
      ticks.push({ tau, x: axis.left + k * px, kind, keep: inside ? half : -1, h: BASE[kind], v: 0 });
    }
  };

  const resize = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    vw = canvas.clientWidth || innerWidth;
    vh = canvas.clientHeight || innerHeight;
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    y0 = Math.round(vh / 2);
    axis = measure();
    N = Math.ceil(vw / DX) + 2;
    u = new Float32Array(N);
    vel = new Float32Array(N);
    readColors();
    buildTicks();
  };

  /* ---------- 弦:带弹性基底的一维波动方程 u_tt = c²u_xx − k²u − γu_t ---------- */
  let grab: { x: number; dir: 1 | -1 } | null = null;
  const P = { x: -1e4, y: -1e4, has: false, inside: false };

  const disp = (x: number) => {
    const f = x / DX;
    const i = Math.floor(f);
    if (i < 0 || i >= N - 1) return 0;
    return u[i] + (u[i + 1] - u[i]) * (f - i);
  };

  const impulse = (x: number, dir: number, speed: number) => {
    for (let j = 1; j < N - 1; j++) {
      const d = (j * DX - x) / 22;
      if (d * d < 9) vel[j] += dir * speed * Math.exp(-d * d);
    }
    still = false;
  };

  const stepWave = (dt: number) => {
    if (still && !grab) return;
    if (grab) {
      /* 被勾住:弦弯成一道以指尖为顶点的弧线,跟手但带一点点迟滞 */
      const pull = P.y - y0;
      const follow = 1 - Math.exp(-dt * 40);
      for (let j = 1; j < N - 1; j++) {
        const target = pull / Math.cosh((j * DX - grab.x) / BEND);
        u[j] += (target - u[j]) * follow;
        vel[j] = 0;
      }
      return;
    }
    const n = Math.ceil(dt / 0.0016);
    const h = dt / n;
    const c2 = (WAVE_C * WAVE_C) / (DX * DX);
    const k2 = WAVE_K * WAVE_K;
    let peak = 0;
    for (let s = 0; s < n; s++) {
      for (let j = 1; j < N - 1; j++) {
        vel[j] += (c2 * (u[j - 1] - 2 * u[j] + u[j + 1]) - k2 * u[j] - DAMP * vel[j]) * h;
      }
      for (let j = 1; j < N - 1; j++) u[j] += vel[j] * h;
    }
    for (let j = 0; j < N; j++) peak = Math.max(peak, Math.abs(u[j]), Math.abs(vel[j]) * 0.02);
    if (peak < 0.01) {
      u.fill(0);
      vel.fill(0);
      still = true;
    }
  };

  /* ---------- 指针 ---------- */
  let leaving: {
    t: number;
    xa: number;
    xb: number;
    fz: number;
    to: Landing | null;
    resolve: () => void;
    done: Promise<void>;
    settled: boolean;
  } | null = null;

  /* 当前帧弦的两端、两端渐隐区宽度、高度;land() 从这里接手 */
  let xa = vw / 2;
  let xb = vw / 2;
  let fz = 1;

  const onMove = (e: PointerEvent) => {
    const x = e.clientX;
    const y = e.clientY;
    if (P.has && !leaving && !reduced) {
      const was = P.y - y0;
      const now = y - y0;
      if (grab) {
        grab.x = x;
        if (now * grab.dir < 0) grab = null; // 退回去了:轻轻放开
        else if (Math.abs(now) >= PULL) grab = null; // 拉到头:挣脱
      } else if (was * now < 0 || (was !== 0 && now === 0)) {
        /* 穿过了弦:取穿越点 */
        const cx = P.x + (x - P.x) * (was / (was - now || 1));
        if (cx > xa + fz * 0.3 && cx < xb - fz * 0.3) {
          const dir: 1 | -1 = now >= 0 ? 1 : -1;
          /* 一下划过去太快,来不及勾住:直接拨一下 */
          if (Math.abs(now) >= 18) impulse(cx, dir, 520 + Math.min(1, Math.abs(now - was) / 160) * 700);
          else {
            grab = { x, dir };
            still = false;
          }
        }
      }
    }
    P.x = x;
    P.y = y;
    P.has = true;
    P.inside = true;
  };
  const onOut = (e: PointerEvent) => {
    if (!e.relatedTarget) {
      P.inside = false;
      grab = null;
    }
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') {
      P.inside = false;
      grab = null;
    }
  };

  /* ---------- 绘制 ---------- */
  const snap = (x: number) => Math.round(x * dpr) / dpr;
  /** 线宽 1px 时让线落在整像素上 */
  const crisp = (y: number) => (Math.round(y * dpr - dpr / 2) + dpr / 2) / dpr;

  const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  const born = performance.now();
  let last = born;
  let hover = 0;
  let raf = 0;
  let cleared = false;

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.033, Math.max(0, (now - last) / 1000));
    last = now;
    const life = now - born;

    /* 初见:弦从正中向两侧展开 */
    const A = reduced ? 1 : easeOut(clamp01((life - 120) / 1400));
    let yl = y0;
    let env = 1; // 弦波可见程度
    let thick = 1;
    let q = 0; // 发丝 → 色带
    let subA = 1; // 次刻度
    let all = 1; // 整体
    let T = 0;
    const to = leaving?.to ?? null;

    if (leaving) {
      T = now - leaving.t;
      if (to) {
        const e = easeMove(clamp01((T - LAND.move) / (LAND.settle - LAND.move)));
        xa = lerp(leaving.xa, axis.left, e);
        xb = lerp(leaving.xb, axis.right, e);
        fz = lerp(leaving.fz, 0, e);
        yl = lerp(y0, to.y, e);
        env = 1 - smooth((T - 220) / 320);
        subA = 1 - smooth((T - LAND.move) / 280);
        q = easeOut(clamp01((T - LAND.lock) / 130));
        thick = 1 + (to.thick - 1) * q;
        all = 1 - smooth((T - LAND.handoff) / LAND.fade);
        if (T >= LAND.handoff + LAND.fade && !leaving.settled) {
          leaving.settled = true;
          leaving.resolve();
        }
      } else {
        all = 1 - smooth((T - 80) / 360);
        if (T >= 440 && !leaving.settled) {
          leaving.settled = true;
          leaving.resolve();
        }
      }
    } else {
      xa = vw / 2 - (A * vw) / 2;
      xb = vw / 2 + (A * vw) / 2;
      fz = Math.max(1, 0.2 * vw * A);
    }

    if (leaving?.settled) {
      if (!cleared) ctx.clearRect(0, 0, canvas.width, canvas.height);
      cleared = true;
      return;
    }

    if (!reduced) stepWave(dt);

    /* 指针:离弦越远磁吸越弱 */
    hover += ((!leaving && P.inside ? 1 : 0) - hover) * (1 - Math.exp(-dt * 7));
    if (reduced) hover = !leaving && P.inside ? 1 : 0;
    const dyN = (P.y - y0) / 260;
    const prox = hover / (1 + dyN * dyN);

    /* 脉搏 */
    let pulseX = -1e5;
    if (!reduced && !leaving && life > PULSE_FIRST) {
      const ph = (life - PULSE_FIRST) % PULSE_EVERY;
      if (ph < PULSE_RUN) pulseX = -160 + (vw + 320) * (ph / PULSE_RUN);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    if (xb - xa < 0.5 || all <= 0) return;

    const flat = still || env < 0.002;
    const yc = flat && !leaving ? crisp(yl) : yl;
    const top = yc - 0.5; // 刻度立在弦的上沿
    const w = Math.max(fz, 1);
    const mask = (x: number) => smooth((x - xa + 1) / w) * smooth((xb - 0.5 - x) / w);

    /* 1. 弦(落位时由发丝长成色带) */
    const f = Math.min(0.5, fz / (xb - xa));
    const lineGrad = ctx.createLinearGradient(xa, 0, xb, 0);
    const lc = rgba(col.ink2, LINE_A * (1 - q) * all);
    lineGrad.addColorStop(0, rgba(col.ink2, 0));
    lineGrad.addColorStop(f, lc);
    lineGrad.addColorStop(1 - f, lc);
    lineGrad.addColorStop(1, rgba(col.ink2, 0));
    if (thick <= 1.001) {
      ctx.beginPath();
      if (flat) {
        ctx.moveTo(xa, yc);
        ctx.lineTo(xb, yc);
      } else {
        ctx.moveTo(xa, yc + disp(xa) * env);
        for (let j = Math.ceil(xa / DX); j * DX < xb; j++) ctx.lineTo(j * DX, yc + u[j] * env);
        ctx.lineTo(xb, yc + disp(xb) * env);
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = lineGrad;
      ctx.stroke();
    } else if (to) {
      roundRect(xa, yl - thick / 2, xb - xa, thick, thick / 2);
      ctx.fillStyle = lineGrad;
      ctx.fill();
      const band = ctx.createLinearGradient(axis.left, 0, axis.right, 0);
      col.stops.forEach((c, i) => band.addColorStop(STOP_AT[i], rgba(c, 1)));
      ctx.globalAlpha = to.bandAlpha * q * all;
      ctx.fillStyle = band;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    /* 2. 刻度 */
    const inv2s = 1 / (2 * SIGMA * SIGMA);
    const inv2p = 1 / (2 * PULSE_SIGMA * PULSE_SIGMA);
    let peakH = 0;
    for (const k of ticks) {
      const dxm = k.x - P.x;
      const g = prox > 0.001 ? Math.exp(-dxm * dxm * inv2s) * prox : 0;
      const dxp = k.x - pulseX;
      const pg = dxp * dxp < 9 * PULSE_SIGMA * PULSE_SIGMA ? Math.exp(-dxp * dxp * inv2p) : 0;
      const base = BASE[k.kind];
      const target = base + (PEAK - base) * g + 2 * pg;
      if (reduced) {
        k.h = target;
        k.v = 0;
      } else {
        k.v += (SPRING_K * (target - k.h) - SPRING_C * k.v) * dt;
        k.h += k.v * dt;
      }
      if (Math.abs(dxm) < SIGMA * 0.6) peakH = Math.max(peakH, k.h);

      let a = mask(k.x) * all;
      if (k.kind === 0) a *= subA;
      if (a < 0.003) continue;

      let len = k.h;
      let st = 0;
      if (to && k.keep >= 0) {
        st = 60 * clamp01((k.x - axis.left) / (axis.right - axis.left));
        len *= 1 - easeOut(clamp01((T - LAND.flip - st) / 110));
      }

      if (len > 0.05) {
        const lit = clamp01((k.h - base) / (PEAK - base));
        const tint = Math.max(lit, pg * 0.75);
        const c = tint > 0.004 ? mix(col.ink2, tempColor(k.tau), tint) : col.ink2;
        const alpha = lerp(REST_A[k.kind], 1, Math.max(lit, pg * 0.5)) * a;
        if (flat) {
          ctx.fillStyle = rgba(c, alpha);
          ctx.fillRect(snap(k.x), top - len, 1, len);
        } else {
          /* 弦弯了:刻度沿弧线的法线方向展开 */
          const by = yl + disp(k.x) * env;
          const slope = ((disp(k.x + 2) - disp(k.x - 2)) / 4) * env;
          const n = Math.hypot(slope, 1);
          ctx.beginPath();
          ctx.moveTo(k.x + 0.5, by - 0.5);
          ctx.lineTo(k.x + 0.5 + (slope / n) * len, by - 0.5 - len / n);
          ctx.lineWidth = 1;
          ctx.strokeStyle = rgba(c, alpha);
          ctx.stroke();
        }
      }

      /* 落位:半度刻度从色带下方伸出来,长度与颜色和 .thermo-ticks 一致 */
      if (to && k.keep >= 0) {
        const grow = easeOut(clamp01((T - LAND.lock - st) / 150));
        if (grow > 0) {
          const major = k.kind === 2;
          ctx.fillStyle = major ? rgba(col.ink2, 0.7 * a) : rgba(col.line, a);
          ctx.fillRect(snap(k.x), yl + thick / 2 + to.gap, 1, (major ? to.major : to.half) * grow);
        }
      }
    }

    /* 3. 游标读数:最高那根刻度顶上 */
    const ra = smooth((peakH - 8) / 12) * mask(P.x) * all;
    if (ra > 0.01) {
      const tau = tauAt(P.x);
      const text = `${tau < -0.05 ? '−' : ''}${Math.abs(tau).toFixed(1)}°C`;
      ctx.font = FONT;
      const tw = ctx.measureText(text).width;
      const total = 5 + 6 + tw;
      const x0 = Math.max(8, Math.min(vw - 8 - total, P.x - total / 2));
      const by = (flat ? top : yl + disp(P.x) * env) - peakH - 9;
      ctx.globalAlpha = ra;
      ctx.fillStyle = rgba(tempColor(tau), 1);
      ctx.beginPath();
      ctx.arc(x0 + 2.5, by - 3.5, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(col.ink1, 1);
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(text, x0 + 11, by);
      ctx.globalAlpha = 1;
    }
  };

  resize();

  addEventListener('resize', resize);
  addEventListener('pointermove', onMove, { passive: true });
  addEventListener('pointerout', onOut);
  addEventListener('pointerup', onUp);
  raf = requestAnimationFrame(frame);

  return {
    get lineY() {
      return y0;
    },
    land(x, y, to) {
      if (leaving) return leaving.done;
      grab = null;
      let resolve = () => {};
      const done = new Promise<void>((r) => (resolve = r));
      leaving = { t: performance.now(), xa, xb, fz, to, resolve, done, settled: false };
      if (reduced) {
        leaving.settled = true;
        resolve();
      } else {
        /* 最后一拨:朝点击的那一侧 */
        impulse(x, y >= y0 ? 1 : -1, 900);
      }
      return done;
    },
    destroy() {
      cancelAnimationFrame(raf);
      removeEventListener('resize', resize);
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerout', onOut);
      removeEventListener('pointerup', onUp);
    },
  };
}
