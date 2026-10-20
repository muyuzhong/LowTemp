/* ASCII 锦鲤池:俯视一方水池(入场动画 intro.ts 与独立预览共用)
 *
 * 思路同 ascii-sharks——一个小生态,而不是一幅画:
 *  - 水:正方形网格上的二维波动方程(经典「水波纹」算法)。鼠标划过、鱼尾摆动、鱼食落水都会激起涟漪;
 *        字符按波纹走向取 - / | \ ,波纹下的鱼和池底光纹会随折射轻轻错位
 *  - 鲤:跟随式脊柱(头转向,各节依次跟随),再叠一条从头传到尾的摆动波;
 *        每格 3×3 超采样「到脊柱的距离 / 该处半宽」得覆盖率:身子从背脊到两侧由密到疏,
 *        轮廓按覆盖落在格子哪一边取 ' . ( ),鳍是从鳍根放射的鳍条;四种花色,池底一道淡影
 *  - 行为:闲游 + 避开池边 + 彼此分开;鼠标慢慢移动时会好奇地游过来,划得太快会受惊散开;
 *        点一下水面撒鱼食,附近的鱼过来抢
 *  - 池底有缓慢流动的焦散光纹,水面漂着几片睡莲叶,鱼从叶子底下穿过
 *  - reveal(x, y):从一点荡开一圈水波,波前三道字符水纹,波里由浓到淡擦掉画布,露出下面的页面
 *  - 颜色只取 --blue 与 --ink-0 及其混色,跟随主题;约 30fps;prefers-reduced-motion 下只画一帧
 */
import { noise } from './bg-field';

const FRAME_MS = 33;
const REVEAL_MS = 1500; // 揭开:水波从点击处扩到全屏
const NA = 8; // 透明度分档
const DIM = 0, MID = 1, HI = 2;
const SEG = 16; // 鲤鱼脊柱节点数
const DAMP = 0.988; // 水波每步衰减
const BODY = ':+*#%@'; // 鱼身:两侧 → 背脊,由疏到密
const REFRACT = 26; // 水面坡度 → 折射错位(px)

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/* 整数哈希 → [0, 1) */
function hash(a: number, b: number) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function parse(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x808080;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a: string, b: string, t: number) => {
  const x = parse(a), y = parse(b);
  return x.map((v, i) => Math.round(lerp(v, y[i], t))).join(',');
};
const luma = (hex: string) => {
  const [r, g, b] = parse(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

/* 一段线的走向(屏幕坐标,y 向下)→ - / | \ */
function lineGlyph(tx: number, ty: number) {
  const ax = Math.abs(tx), ay = Math.abs(ty);
  if (ay < ax * 0.42) return '-';
  if (ax < ay * 0.42) return '|';
  return tx * ty > 0 ? '\\' : '/';
}

/* ---------- 鲤鱼的身形(俯视;s 从吻端 0 到尾鳍末端 1,宽度是体长 L 的倍数) ---------- */
const BODY_END = 0.76; // 身子到这里,后面是尾鳍(约占全长四分之一)
function bodyHalf(s: number) {
  if (s < 0.08) return 0.078 * Math.sqrt(Math.max(0, 1 - ((0.08 - s) / 0.08) ** 2)); // 圆钝的吻
  if (s < 0.28) return lerp(0.078, 0.095, smoothstep(0.08, 0.28, s)); // 最宽在头后
  if (s < BODY_END) return lerp(0.095, 0.026, smoothstep(0.28, BODY_END, s)); // 收到尾柄
  return 0;
}
/* 尾鳍:从尾柄张成两片扇叶,末端中间一道 V 形缺口 */
function inTail(s: number, d: number) {
  if (s < BODY_END - 0.04) return false;
  const k = (s - (BODY_END - 0.04)) / (1 - BODY_END + 0.04);
  if (d > 0.026 + 0.13 * Math.sin((k * Math.PI) / 2) ** 1.2) return false;
  return s < 0.9 || d > ((s - 0.9) / 0.1) * 0.08;
}

type Koi = {
  x: Float32Array; y: Float32Array; // 脊柱节点(头 → 尾)
  rx: Float32Array; ry: Float32Array; // 叠上摆动波之后的节点,用来画
  L: number; seg: number;
  heading: number; speed: number; base: number; wander: number;
  phase: number; flap: number; depth: number; seed: number;
  kind: number; // 花色:0 纯白,1 大块斑纹(红白式),2 头顶一个圆(丹顶),3 蓝身白背(浅黄式)
  scared: number; sx: number; sy: number; // 受惊:从 (sx, sy) 逃开
  wake: number; full: number;
};
/* 这一点是不是斑纹(s 沿身长,lat 是带符号的横向距离,都以体长为单位) */
function patch(k: Koi, s: number, lat: number) {
  switch (k.kind) {
    case 1: return s < BODY_END - 0.05 && noise(s * 4.2 + k.seed, lat * 14 + k.seed, 0.3) > 0.1;
    case 2: return ((s - 0.11) / 0.055) ** 2 + (lat / 0.05) ** 2 < 1;
    case 3: return Math.abs(lat) > bodyHalf(s) * 0.45;
    default: return false;
  }
}

type Pad = { x: number; y: number; r: number; rot: number; vr: number; vx: number; vy: number };
type Pellet = { x: number; y: number; life: number };

export interface KoiPondOptions {
  /** 点一下水面撒鱼食(预览里开;入场门里点击是「进入」) */
  feed?: boolean;
  /** 盖在池面上的文字:这块区域里的字符压暗,文字才读得清 */
  textZone?: HTMLElement | null;
}

export function createKoiPond(canvas: HTMLCanvasElement, opts: KoiPondOptions = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 颜色 ---------- */
  let styles: string[][] = [];
  let bg = '#0c0e12', mono = 'monospace';
  const readColors = () => {
    const css = getComputedStyle(root);
    const token = (name: string, d: string) => css.getPropertyValue(name).trim() || d;
    bg = token('--bg-0', '#0c0e12');
    mono = token('--font-mono', 'monospace');
    const blue = token('--blue', '#6e9fcb'), ink = token('--ink-0', '#d6dae3');
    /* 深色:蓝 / 浅蓝 / 白;浅色:纸面是白,三档换成淡蓝 / 蓝 / 深蓝(像水墨里的鱼) */
    const tones = luma(bg) < 0.5
      ? [mix(blue, blue, 0), mix(blue, ink, 0.5), mix(ink, ink, 0)]
      : [mix(blue, bg, 0.35), mix(blue, blue, 0), mix(blue, ink, 0.55)];
    styles = tones.map((rgb) => Array.from({ length: NA }, (_, k) => `rgba(${rgb},${((k + 1) / NA).toFixed(3)})`));
  };

  /* ---------- 网格 ---------- */
  let w = 0, h = 0, dpr = 1, fs = 10, cw = 6, ch = 11, cols = 0, rows = 0;
  let q = 6, nx = 0, ny = 0; // 水波网格(正方形格,边长 q)
  let wa = new Float32Array(0), wb = new Float32Array(0); // 当前 / 上一步水面高度
  let kG: string[] = [], kC = new Uint8Array(0), kA = new Float32Array(0); // 鱼的覆盖层
  const kTouched: number[] = [];
  let caustic = new Uint8Array(0); // 池底光纹缓存:0 无,1 '.',2 ':'
  let foodAt = new Uint8Array(0);
  const foodTouched: number[] = [];
  let dimZone = new Uint8Array(0);
  let koi: Koi[] = [];
  let pads: Pad[] = [];
  const pellets: Pellet[] = [];

  const splash = (x: number, y: number, r: number, amp: number) => {
    const gx = x / q, gy = y / q, rr = Math.max(1, r / q);
    const x0 = Math.max(1, Math.floor(gx - rr * 2)), x1 = Math.min(nx - 2, Math.ceil(gx + rr * 2));
    const y0 = Math.max(1, Math.floor(gy - rr * 2)), y1 = Math.min(ny - 2, Math.ceil(gy + rr * 2));
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const d2 = ((i - gx) ** 2 + (j - gy) ** 2) / (rr * rr);
        if (d2 < 4) wa[j * nx + i] += amp * Math.exp(-d2);
      }
    }
  };

  const stepWater = () => {
    /* 经典水波:新 = 四邻之和 / 2 − 上一步,再衰减;结果写进上一步的数组后交换 */
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1, k = j * nx + 1; i < nx - 1; i++, k++) {
        wb[k] = ((wa[k - 1] + wa[k + 1] + wa[k - nx] + wa[k + nx]) * 0.5 - wb[k]) * DAMP;
      }
    }
    const t = wa;
    wa = wb;
    wb = t;
  };

  /* 某点的水面高度与坡度 */
  const water = (x: number, y: number): [number, number, number] => {
    const i = clamp(Math.round(x / q), 1, nx - 2), j = clamp(Math.round(y / q), 1, ny - 2), k = j * nx + i;
    return [wa[k], (wa[k + 1] - wa[k - 1]) * 0.5, (wa[k + nx] - wa[k - nx]) * 0.5];
  };

  const spawnKoi = (i: number, n: number): Koi => {
    const base = Math.min(w, h);
    const L = clamp(base * 0.3, 120, 320) * lerp(0.82, 1.12, hash(i, 1)); // 鱼要大,细节才出得来
    const heading = hash(i, 2) * Math.PI * 2;
    const hx = lerp(w * 0.15, w * 0.85, (i + 0.5) / n + (hash(i, 3) - 0.5) * 0.1);
    const hy = lerp(h * 0.2, h * 0.8, hash(i, 4));
    const seg = L / (SEG - 1);
    const x = new Float32Array(SEG), y = new Float32Array(SEG);
    for (let k = 0; k < SEG; k++) {
      x[k] = hx - Math.cos(heading) * seg * k;
      y[k] = hy - Math.sin(heading) * seg * k;
    }
    return {
      x, y, rx: new Float32Array(SEG), ry: new Float32Array(SEG), L, seg, heading,
      speed: 30, base: L * lerp(0.12, 0.19, hash(i, 5)), wander: 0, phase: hash(i, 6) * 6, flap: hash(i, 7) * 6,
      depth: lerp(0.72, 1, hash(i, 8)), seed: hash(i, 9) * 50, kind: [1, 2, 0, 3, 1][i % 5],
      scared: 0, sx: 0, sy: 0, wake: 0, full: 0,
    };
  };

  const layout = () => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const first = !w;
    w = rect.width;
    h = rect.height;
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    fs = clamp(Math.round(Math.min(w, h * 1.6) / 140), 9, 13);
    cw = fs * 0.6;
    ch = Math.round(fs * 1.12);
    cols = Math.ceil(w / cw);
    rows = Math.ceil(h / ch);
    const n = cols * rows;
    kG = new Array(n).fill('');
    kC = new Uint8Array(n);
    kA = new Float32Array(n);
    kTouched.length = 0;
    caustic = new Uint8Array(n);
    foodAt = new Uint8Array(n);
    foodTouched.length = 0;
    q = cw;
    nx = Math.ceil(w / q) + 2;
    ny = Math.ceil(h / q) + 2;
    wa = new Float32Array(nx * ny);
    wb = new Float32Array(nx * ny);

    dimZone = new Uint8Array(n);
    const r = opts.textZone?.getBoundingClientRect();
    if (r && r.width) {
      const ca = Math.max(0, Math.floor((r.left - rect.left) / cw) - 4), cb = Math.min(cols - 1, Math.ceil((r.right - rect.left) / cw) + 4);
      const ra = Math.max(0, Math.floor((r.top - rect.top) / ch) - 1), rb = Math.min(rows - 1, Math.ceil((r.bottom - rect.top) / ch) + 1);
      for (let rr = ra; rr <= rb; rr++) for (let cc = ca; cc <= cb; cc++) dimZone[rr * cols + cc] = 1;
    }

    if (first) {
      const count = clamp(Math.round((w * h) / 300000), 3, 5);
      koi = Array.from({ length: count }, (_, i) => spawnKoi(i, count));
      const pc = w < 640 ? 2 : 3;
      pads = Array.from({ length: pc }, (_, i) => {
        const r = clamp(Math.min(w, h) * lerp(0.045, 0.075, hash(i, 21)), 24, 70);
        /* 叶子贴着四边放,中间留给鱼和文字 */
        const side = i % 4;
        const along = hash(i, 22) < 0.5 ? lerp(0.12, 0.32, hash(i, 27)) : lerp(0.68, 0.88, hash(i, 27)); // 避开每条边的正中
        const x = side < 2 ? along * w : side === 2 ? w * 0.1 : w * 0.9;
        const y = side === 0 ? h * 0.13 : side === 1 ? h * 0.86 : along * h;
        return { x, y, r, rot: hash(i, 23) * 6.28, vr: (hash(i, 24) - 0.5) * 0.06, vx: (hash(i, 25) - 0.5) * 5, vy: (hash(i, 26) - 0.5) * 5 };
      });
    }
  };

  /* ---------- 行为 ---------- */
  const ptr = { x: 0, y: 0, lx: 0, ly: 0, lt: 0, speed: 0, on: false, sx: 0, sy: 0 };
  let nextEvent = 2;

  const updateKoi = (k: Koi, dt: number) => {
    const hx = k.x[0], hy = k.y[0];
    k.wander = clamp(k.wander + (Math.random() - 0.5) * dt * 2.2, -1, 1);
    let ax = Math.cos(k.heading + k.wander * 0.7), ay = Math.sin(k.heading + k.wander * 0.7);
    let turn = 1.0, boost = 1;

    /* 池边:靠近就往里拐 */
    const m = Math.min(w, h) * 0.08 + k.L * 0.4;
    if (hx < m) ax += ((m - hx) / m) * 2.5;
    if (hx > w - m) ax -= ((hx - (w - m)) / m) * 2.5;
    if (hy < m) ay += ((m - hy) / m) * 2.5;
    if (hy > h - m) ay -= ((hy - (h - m)) / m) * 2.5;

    /* 彼此分开 */
    for (const o of koi) {
      if (o === k) continue;
      const dx = hx - o.x[(SEG / 3) | 0], dy = hy - o.y[(SEG / 3) | 0];
      const d = Math.hypot(dx, dy), r = (k.L + o.L) * 0.35;
      if (d < r && d > 0.1) { ax += (dx / d) * (1 - d / r) * 1.5; ay += (dy / d) * (1 - d / r) * 1.5; }
    }

    /* 鱼食:找最近的一粒 */
    let best: Pellet | null = null, bd = 420;
    for (const p of pellets) {
      const d = Math.hypot(p.x - hx, p.y - hy);
      if (d < bd) { bd = d; best = p; }
    }
    if (best && k.full <= 0) {
      ax += ((best.x - hx) / bd) * 3;
      ay += ((best.y - hy) / bd) * 3;
      turn = 2.6;
      boost = 1.9;
      if (bd < k.L * 0.07 + 6) {
        pellets.splice(pellets.indexOf(best), 1);
        splash(best.x, best.y, q * 1.2, 0.5); // 一口吞下
        k.full = 0.8;
      }
    } else if (ptr.on && ptr.speed < 350) {
      /* 好奇:鼠标停在水面上,鱼会慢慢游过来 */
      const dx = ptr.x - hx, dy = ptr.y - hy, d = Math.hypot(dx, dy);
      if (d < 300 && d > 40) { ax += (dx / d) * 0.9; ay += (dy / d) * 0.9; turn = 1.5; }
    }
    k.full -= dt;

    /* 受惊:从惊扰点逃开 */
    if (k.scared > 0) {
      const dx = hx - k.sx, dy = hy - k.sy, d = Math.hypot(dx, dy) || 1;
      ax += (dx / d) * 4 * k.scared;
      ay += (dy / d) * 4 * k.scared;
      turn = 4;
      boost = Math.max(boost, 1 + 2.4 * k.scared);
      k.scared = Math.max(0, k.scared - dt * 0.8);
    }

    const want = Math.atan2(ay, ax);
    const dh = wrapAngle(want - k.heading);
    k.heading += clamp(dh, -turn * dt, turn * dt);
    k.speed += (k.base * boost - k.speed) * Math.min(1, dt * 1.6);
    k.x[0] += Math.cos(k.heading) * k.speed * dt;
    k.y[0] += Math.sin(k.heading) * k.speed * dt;
    /* 各节跟随前一节 */
    for (let i = 1; i < SEG; i++) {
      const dx = k.x[i] - k.x[i - 1], dy = k.y[i] - k.y[i - 1], d = Math.hypot(dx, dy) || 1;
      k.x[i] = k.x[i - 1] + (dx / d) * k.seg;
      k.y[i] = k.y[i - 1] + (dy / d) * k.seg;
    }
    k.phase += dt * (2.2 + k.speed * 0.06);
    k.flap += dt * (1.6 + k.speed * 0.03);

    /* 摆尾留下的细小尾迹 */
    k.wake -= dt;
    if (k.wake <= 0) {
      k.wake = 0.16;
      const t = (SEG * 0.8) | 0;
      splash(k.x[t], k.y[t], q, 0.02 + k.speed * 0.0008);
    }

    /* 叠上从头传到尾的摆动波(只影响画,不影响游动) */
    const amp = k.L * 0.045 * (0.6 + k.speed / 90);
    for (let i = 0; i < SEG; i++) {
      const j = Math.max(1, i);
      const tx = k.x[j - 1] - k.x[j], ty = k.y[j - 1] - k.y[j], d = Math.hypot(tx, ty) || 1;
      const lat = amp * Math.sin(k.phase - i * 0.55) * (i / (SEG - 1)) ** 1.4;
      k.rx[i] = k.x[i] - (ty / d) * lat;
      k.ry[i] = k.y[i] + (tx / d) * lat;
    }
  };

  const update = (t: number, dt: number) => {
    for (const k of koi) updateKoi(k, dt);
    /* 时不时有鱼到水面吻一下,或一滴水落下 */
    nextEvent -= dt;
    if (nextEvent <= 0) {
      nextEvent = 2.5 + Math.random() * 3.5;
      const k = koi[(Math.random() * koi.length) | 0];
      if (k && Math.random() < 0.6) splash(k.x[0], k.y[0], q * 1.5, 0.7);
      else splash(Math.random() * w, Math.random() * h, q * 1.2, 0.9);
    }
    for (let i = pellets.length - 1; i >= 0; i--) {
      const p = pellets[i];
      const [, gx, gy] = water(p.x, p.y);
      p.x += gx * 30 * dt;
      p.y += gy * 30 * dt;
      p.life -= dt;
      if (p.life <= 0) pellets.splice(i, 1);
    }
    for (const p of pads) {
      p.x = clamp(p.x + p.vx * dt, p.r, w - p.r);
      p.y = clamp(p.y + p.vy * dt, p.r, h - p.r);
      if (p.x <= p.r || p.x >= w - p.r) p.vx *= -1;
      if (p.y <= p.r || p.y >= h - p.r) p.vy *= -1;
      p.rot += p.vr * dt;
    }
    stepWater();
    stepWater();
  };

  /* ---------- 画鱼:3×3 超采样「到脊柱的距离 / 该处半宽」 ---------- */
  const overKoi = (c: number, r: number, g: string, col: number, a: number, under = false) => {
    if (c < 0 || r < 0 || c >= cols || r >= rows) return;
    const i = r * cols + c;
    if (kG[i]) { if (under) return; } else kTouched.push(i);
    kG[i] = g;
    kC[i] = col;
    kA[i] = a;
  };

  /* 轮廓字:覆盖到的部分落在格子哪一边(mx, my ∈ 0..1),就取贴着那一边的字 */
  const edgeGlyph = (mx: number, my: number) => (my < 0.35 ? "'" : my > 0.65 ? '.' : mx < 0.35 ? ')' : mx > 0.65 ? '(' : ':');

  /* 点到脊柱第 i 段的距离²;raw 是投影参数(未截断) */
  const segHit = (X: Float32Array, Y: Float32Array, i: number, px: number, py: number): [number, number] => {
    const vx = X[i + 1] - X[i], vy = Y[i + 1] - Y[i], l2 = vx * vx + vy * vy || 1;
    const raw = ((px - X[i]) * vx + (py - Y[i]) * vy) / l2, u = clamp(raw, 0, 1);
    return [(X[i] + vx * u - px) ** 2 + (Y[i] + vy * u - py) ** 2, raw];
  };

  const rasterKoi = (k: Koi) => {
    const L = k.L, X = k.rx, Y = k.ry;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < SEG; i++) {
      x0 = Math.min(x0, X[i]); x1 = Math.max(x1, X[i]);
      y0 = Math.min(y0, Y[i]); y1 = Math.max(y1, Y[i]);
    }
    const reach = L * 0.3; // 鳍伸出脊柱的最远距离
    const shx = L * 0.05 * k.depth, shy = L * 0.08 * k.depth; // 池底的影子往右下偏
    const c0 = Math.max(0, Math.floor((x0 - reach) / cw)), c1 = Math.min(cols - 1, Math.ceil((x1 + reach + shx) / cw));
    const r0 = Math.max(0, Math.floor((y0 - reach) / ch)), r1 = Math.min(rows - 1, Math.ceil((y1 + reach + shy) / ch));

    /* 脊柱上 s 处的点和朝尾的切线 */
    const at = (s: number) => {
      const f = s * (SEG - 1), i = Math.min(SEG - 2, Math.floor(f)), u = f - i;
      const tx = X[i + 1] - X[i], ty = Y[i + 1] - Y[i], l = Math.hypot(tx, ty) || 1;
      return [lerp(X[i], X[i + 1], u), lerp(Y[i], Y[i + 1], u), tx / l, ty / l];
    };
    /* 鳍:胸鳍一对(大,扇形,缓慢扇动),腹鳍一对(小)。[椭圆中心 x, y, 长轴方向 x, y, 半长, 半宽, 鳍根 x, y] */
    const fins: number[][] = [];
    const addFin = (s: number, beta: number, len: number, wid: number, side: number) => {
      const [ax, ay, tx, ty] = at(s);
      const ox = -ty * side, oy = tx * side; // 朝外的法线
      const dx = tx * Math.cos(beta) + ox * Math.sin(beta), dy = ty * Math.cos(beta) + oy * Math.sin(beta);
      const bx = ax + ox * bodyHalf(s) * L * 0.8, by = ay + oy * bodyHalf(s) * L * 0.8;
      fins.push([bx + dx * len * L, by + dy * len * L, dx, dy, len * L, wid * L, bx, by]);
    };
    for (const side of [-1, 1]) {
      addFin(0.19, 1.15 + 0.3 * Math.sin(k.flap + side * 0.7), 0.095, 0.05, side);
      addFin(0.46, 0.75 + 0.15 * Math.sin(k.flap * 0.8 + side), 0.045, 0.02, side);
    }
    const [pedX, pedY] = at(BODY_END - 0.03); // 尾鳍条从尾柄放射
    const [ex, ey, etx, ety] = at(0.055);
    const eyes = [[ex - ety * L * 0.055, ey + etx * L * 0.055], [ex + ety * L * 0.055, ey - etx * L * 0.055]];
    const reject = (reach + 10) ** 2;

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cx = (c + 0.5) * cw, cy = (r + 0.5) * ch;
        /* 先看格子中心离脊柱多远:太远直接跳过;记下最近的一段,超采样只查它附近 */
        let j0 = 0, dc = Infinity;
        for (let i = 0; i < SEG - 1; i++) {
          const [d] = segHit(X, Y, i, cx, cy);
          if (d < dc) { dc = d; j0 = i; }
        }
        if (dc > reject) continue;
        const ja = Math.max(0, j0 - 2), jb = Math.min(SEG - 2, j0 + 2);
        const [, gx, gy] = water(cx, cy);
        const offx = gx * REFRACT, offy = gy * REFRACT; // 波纹下的鱼随折射错位

        let nb = 0, nf = 0, shade = 0, sSum = 0, latSum = 0, mxs = 0, mys = 0, fdx = 0, fdy = 0, fxs = 0, fys = 0;
        for (let sj = 0; sj < 3; sj++) {
          for (let si = 0; si < 3; si++) {
            const px = (c + (si + 0.5) / 3) * cw + offx, py = (r + (sj + 0.5) / 3) * ch + offy;
            let best = Infinity, bs = 0, side = 0, past = false;
            for (let i = ja; i <= jb; i++) {
              const [d, raw] = segHit(X, Y, i, px, py);
              if (d < best) {
                best = d;
                bs = (i + clamp(raw, 0, 1)) / (SEG - 1);
                side = (X[i + 1] - X[i]) * (py - Y[i]) - (Y[i + 1] - Y[i]) * (px - X[i]);
                past = i === SEG - 2 && raw > 1; // 尾鳍末端之外
              }
            }
            const d = Math.sqrt(best) / L, hw = bodyHalf(bs);
            if (d < hw) {
              nb++;
              shade += 1 - (d / hw) ** 2; // 背脊最亮
              sSum += bs;
              latSum += side > 0 ? d : -d;
              mxs += si;
              mys += sj;
            } else if (!past && inTail(bs, d)) {
              nf++;
              fdx += px - pedX;
              fdy += py - pedY;
              fxs += si;
              fys += sj;
            } else {
              for (const f of fins) {
                const ox = px - f[0], oy = py - f[1];
                const a = (ox * f[2] + oy * f[3]) / f[4], b = (oy * f[2] - ox * f[3]) / f[5];
                if (a * a + b * b < 1) { nf++; fdx += px - f[6]; fdy += py - f[7]; fxs += si; fys += sj; break; }
              }
            }
          }
        }

        const alpha = k.depth;
        if (nb >= 4) {
          if (eyes.some(([qx, qy]) => Math.abs(qx - cx) < cw * 0.6 && Math.abs(qy - cy) < ch * 0.5)) {
            overKoi(c, r, 'o', DIM, alpha);
            continue;
          }
          const v = (nb / 9) * (0.3 + 0.7 * (shade / nb));
          const g = BODY[clamp(Math.round(v * (BODY.length - 1)), 0, BODY.length - 1)];
          overKoi(c, r, g, patch(k, sSum / nb, latSum / nb) ? MID : HI, alpha * (0.8 + 0.2 * v));
        } else if (nb > 0) {
          overKoi(c, r, edgeGlyph(mxs / nb / 2, mys / nb / 2), HI, alpha * 0.85);
        } else if (nf >= 7) {
          /* 鳍里面:鳍条从鳍根放射,一根一根分开,之间是薄薄的鳍膜 */
          const ray = Math.abs(Math.sin(Math.atan2(fdy, fdx) * 9)) < 0.5;
          overKoi(c, r, ray ? lineGlyph(fdx, fdy) : ':', MID, alpha * (ray ? 0.6 : 0.32));
        } else if (nf > 0) {
          /* 鳍的轮廓:和鱼身一样贴着覆盖的那一边取字,扇形才看得出来 */
          overKoi(c, r, edgeGlyph(fxs / nf / 2, fys / nf / 2), MID, alpha * 0.75);
        } else {
          /* 池底的影子:把格子往左上挪回去,落在鱼身里就是影子 */
          const sx = cx - shx, sy = cy - shy;
          let best = Infinity, bs = 0;
          for (let i = Math.max(0, j0 - 3); i <= Math.min(SEG - 2, j0 + 3); i++) {
            const [d, raw] = segHit(X, Y, i, sx, sy);
            if (d < best) { best = d; bs = (i + clamp(raw, 0, 1)) / (SEG - 1); }
          }
          if (Math.sqrt(best) / L < bodyHalf(bs) * 0.9) overKoi(c, r, '.', DIM, 0.4 * alpha, true);
        }
      }
    }
  };

  /* ---------- 一帧 ---------- */
  const bIds: number[][] = Array.from({ length: 3 * NA }, () => []);
  const bGlyphs: string[][] = Array.from({ length: 3 * NA }, () => []);
  const put = (col: number, a: number, i: number, g: string) => {
    if (a < 0.07) return;
    const b = col * NA + Math.min(NA - 1, Math.round(a * NA) - 1);
    bIds[b].push(i);
    bGlyphs[b].push(g);
  };
  let frame = 0;

  const clearBuckets = () => {
    for (let b = 0; b < bIds.length; b++) { bIds[b].length = 0; bGlyphs[b].length = 0; }
  };
  const flush = () => {
    ctx.font = `500 ${fs}px ${mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let b = 0; b < bIds.length; b++) {
      const ids = bIds[b];
      if (!ids.length) continue;
      const gs = bGlyphs[b];
      ctx.fillStyle = styles[(b / NA) | 0][b % NA];
      for (let j = 0; j < ids.length; j++) {
        const i = ids[j];
        ctx.fillText(gs[j], ((i % cols) + 0.5) * cw, (((i / cols) | 0) + 0.5) * ch);
      }
    }
  };

  const render = (t: number) => {
    clearBuckets();
    for (const i of kTouched) kG[i] = '';
    kTouched.length = 0;
    for (const i of foodTouched) foodAt[i] = 0;
    foodTouched.length = 0;
    for (const p of pellets) {
      const c = Math.floor(p.x / cw), r = Math.floor(p.y / ch);
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      foodAt[r * cols + c] = 1;
      foodTouched.push(r * cols + c);
    }
    /* 深的先画,浅的盖上去 */
    [...koi].sort((a, b) => a.depth - b.depth).forEach(rasterKoi);

    /* 池底光纹变化慢,隔帧算一次 */
    const redoCaustic = frame++ % 2 === 0;
    const zc = t * 0.2;

    for (let r = 0; r < rows; r++) {
      const y = (r + 0.5) * ch;
      for (let c = 0; c < cols; c++) {
        const x = (c + 0.5) * cw;
        const i = r * cols + c;
        const dim = dimZone[i] ? 0.3 : 1;

        /* 鱼食 */
        if (foodAt[i]) { put(HI, 0.95, i, 'o'); continue; }

        /* 睡莲叶:圆叶缺一角,叶脉放射;鱼从下面穿过 */
        let leaf = false;
        for (const p of pads) {
          const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
          if (d > p.r) continue;
          const a = wrapAngle(Math.atan2(dy, dx) - p.rot);
          if (Math.abs(a) < 0.3 && d > p.r * 0.12) break; // 缺口
          leaf = true;
          if (d > p.r - cw * 1.1) {
            /* 叶缘:左右两侧用 ( ) 才显得圆,其余按切线走向 */
            const g = Math.abs(dy) < Math.abs(dx) * 0.42 ? (dx < 0 ? '(' : ')') : lineGlyph(-dy, dx);
            put(MID, 0.85 * dim, i, g);
          } else if (Math.abs(Math.sin(a * 3.5)) < 0.12 && d > p.r * 0.2) put(MID, 0.5 * dim, i, lineGlyph(dx, dy)); // 叶脉
          else put(DIM, (0.35 + 0.25 * (d / p.r)) * dim, i, hash(c, r) < 0.5 ? ':' : '.'); // 叶面
          break;
        }
        if (leaf) continue;

        const [hv, gx, gy] = water(x, y);
        const strong = Math.abs(hv) > 0.3;

        /* 鱼;很强的波纹会盖过鱼身 */
        if (kG[i] && !strong) { put(kC[i], kA[i] * (dimZone[i] ? 0.45 : 1), i, kG[i]); continue; }

        /* 涟漪:按波纹走向取字,波峰亮、波谷暗 */
        if (hv > 0.08) {
          put(hv > 0.3 ? HI : MID, clamp(hv * 3, 0.3, 1) * dim, i, lineGlyph(-gy, gx));
          continue;
        }
        if (hv < -0.12) { put(DIM, clamp(-hv * 2.5, 0.2, 0.6) * dim, i, '.'); continue; }

        /* 池底光纹:两层噪声的零值线连成一张网,随水面折射错位 */
        if (redoCaustic) {
          const u = (x + gx * REFRACT) * 0.0095, v = (y + gy * REFRACT) * 0.0095;
          const n = noise(u, v, zc) + 0.5 * noise(u * 2.1 + 7, v * 2.1 - 3, zc * 1.4 + 5);
          const ridge = 1 - Math.abs(n) * 28;
          caustic[i] = ridge > 0.5 ? 2 : ridge > 0 ? 1 : 0;
        }
        if (caustic[i]) put(DIM, (caustic[i] === 2 ? 0.42 : 0.24) * dim, i, '.');
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    flush();
    drawReveal(t);
  };

  /* ---------- 揭开:从一点荡开一圈水波,波里一点点露出下面的页面 ---------- */
  let rev: { x: number; y: number; t0: number; R: number; band: number; done: () => void } | null = null;

  /* 圆周上的字:左右两侧用 ( ),其余按切线走向 */
  const ringGlyph = (dx: number, dy: number) =>
    Math.abs(dy) < Math.abs(dx) * 0.42 ? (dx < 0 ? '(' : ')') : lineGlyph(-dy, dx);

  const drawReveal = (t: number) => {
    if (!rev) return;
    const p = clamp((t - rev.t0) / (REVEAL_MS / 1000), 0, 1);
    const R = rev.R * (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2); // 先慢后快再慢
    const { x: ox, y: oy, band } = rev;

    /* 波前往里 band 宽的一段由浓到淡擦掉:页面是透出来的,不是切开的 */
    ctx.globalCompositeOperation = 'destination-out';
    const g = ctx.createRadialGradient(ox, oy, Math.max(0, R - band), ox, oy, Math.max(1, R));
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';

    /* 波前:三道字符水纹,外亮内淡,盖在刚露出的页面上 */
    clearBuckets();
    const fade = 1 - smoothstep(0.85, 1, p);
    const crests: [number, number, number][] = [[R, HI, 1], [R - 30, MID, 0.65], [R - 76, MID, 0.35]];
    const ra = Math.max(0, Math.floor((oy - R - ch) / ch)), rb = Math.min(rows - 1, Math.ceil((oy + R + ch) / ch));
    for (let r = ra; r <= rb; r++) {
      const y = (r + 0.5) * ch;
      for (let c = 0; c < cols; c++) {
        const x = (c + 0.5) * cw, dx = x - ox, dy = y - oy, d = Math.hypot(dx, dy) || 1;
        /* 沿半径方向一格有多宽:格子窄高,按方向取,每道波纹才只有一格粗 */
        const tol = 0.5 * ((Math.abs(dx) / d) * cw + (Math.abs(dy) / d) * ch);
        for (const [rk, col, a] of crests) {
          if (rk > 0 && Math.abs(d - rk) < tol) { put(col, a * fade, r * cols + c, ringGlyph(dx, dy)); break; }
        }
      }
    }
    flush();

    if (p >= 1) {
      const done = rev.done;
      rev = null;
      ctx.clearRect(0, 0, w, h);
      done();
    }
  };

  const reveal = (x: number, y: number) =>
    new Promise<void>((resolve) => {
      if (reduced) return resolve();
      const band = clamp(Math.min(w, h) * 0.3, 120, 280);
      const R = Math.max(Math.hypot(x, y), Math.hypot(w - x, y), Math.hypot(x, h - y), Math.hypot(w - x, h - y)) + band;
      rev = { x, y, t0: (performance.now() - t0) / 1000, R, band, done: resolve };
      /* 水面真的被拍了一下,附近的鱼受惊散开 */
      splash(x, y, q * 2, 1.3);
      for (const k of koi) {
        if (Math.hypot(k.x[0] - x, k.y[0] - y) < 320) { k.scared = 1; k.sx = x; k.sy = y; }
      }
    });

  /* ---------- 循环与交互 ---------- */
  const t0 = performance.now();
  let raf = 0, last = -Infinity;
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    if (now - last < (rev ? 15 : FRAME_MS)) return; // 揭开时 60fps,波前才顺
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const t = (now - t0) / 1000;
    ptr.speed *= 0.85;
    update(t, dt);
    render(t);
  };

  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const onMove = (e: PointerEvent) => {
    const [x, y] = local(e);
    const now = performance.now();
    if (ptr.on) {
      const d = Math.hypot(x - ptr.lx, y - ptr.ly), dt = Math.max(1, now - ptr.lt) / 1000;
      ptr.speed = Math.max(ptr.speed, d / dt);
      /* 手指划过水面:沿途留下细细的波 */
      if (Math.hypot(x - ptr.sx, y - ptr.sy) > q * 2) {
        splash(x, y, q * 1.2, 0.06 + Math.min(0.2, (d / dt) / 4000));
        ptr.sx = x;
        ptr.sy = y;
      }
      /* 划得太快:附近的鱼受惊 */
      if (d / dt > 1300) {
        for (const k of koi) {
          if (Math.hypot(k.x[0] - x, k.y[0] - y) < 170) { k.scared = 1; k.sx = x; k.sy = y; }
        }
      }
    } else {
      ptr.sx = x;
      ptr.sy = y;
    }
    ptr.x = ptr.lx = x;
    ptr.y = ptr.ly = y;
    ptr.lt = now;
    ptr.on = true;
  };
  const onLeave = () => (ptr.on = false);
  const onDown = (e: PointerEvent) => {
    if (!opts.feed) return;
    const [x, y] = local(e);
    splash(x, y, q * 2, 1.2);
    for (let j = 0, n = 4 + ((Math.random() * 4) | 0); j < n; j++) {
      const a = Math.random() * 6.28, r = Math.random() * 22;
      pellets.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * 0.8, life: 14 + Math.random() * 4 });
    }
  };
  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      layout();
      if (reduced) still();
    }, 100);
  };
  const onTheme = () => {
    readColors();
    if (reduced) render(0);
  };
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  const themeObserver = new MutationObserver(onTheme);

  /* 静止的一帧:先在后台游几秒,让鱼散开、留下几圈波纹 */
  const still = () => {
    for (let s = 0; s < 120; s++) update(s / 30, 1 / 30);
    render(4);
  };

  addEventListener('pointermove', onMove, { passive: true });
  root.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointerdown', onDown);
  addEventListener('resize', onResize);
  scheme.addEventListener('change', onTheme);
  themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  readColors();
  layout();
  if (reduced) {
    still();
    /* 画布上的等宽字不会触发字体加载;字体到位后重画一次 */
    document.fonts?.load(`500 ${fs}px ${mono}`).then(() => render(4), () => {});
  } else {
    raf = requestAnimationFrame(loop);
  }

  return {
    reveal,
    destroy() {
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerdown', onDown);
      removeEventListener('resize', onResize);
      scheme.removeEventListener('change', onTheme);
      themeObserver.disconnect();
    },
  };
}
