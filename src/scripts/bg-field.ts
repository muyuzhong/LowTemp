/* 背景「等温线场」
 *
 * 一个缓慢演化的噪声场 = 温度场;画出它的等值线(marching squares),就是等温线。
 *  - 线条集中在页面两侧,向正文列渐隐(正文区域保持干净)
 *  - 场随时间极慢漂移,随滚动有轻微视差
 *  - 鼠标是一个"热源":靠近的等温线被染成强调色
 *  - 主题切换时跟随 CSS 变量换色;prefers-reduced-motion 下只画静态一帧
 *  - 视口过窄(没有侧边空白)或标签页隐藏时不绘制
 */

const CELL = 18; // 采样格大小(css px)
const LEVELS = 15; // 等温线条数
const LEVEL_STEP = 0.042;
const MIN_WIDTH = 1180; // 小于此宽度没有可用的侧边空白
const FRAME_HALF = 560; // 内容框半宽(与 .frame 的 1120 对应)

/* ---------- 3D 梯度噪声(Perlin) ---------- */
const perm = new Uint8Array(512);
(() => {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let seed = 20260702; // 固定种子:每次打开是同一片"地形"
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 255; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
})();
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function grad(h: number, x: number, y: number, z: number) {
  const u = (h & 15) < 8 ? x : y;
  const v = (h & 15) < 4 ? y : (h & 15) === 12 || (h & 15) === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}
function noise(x: number, y: number, z: number) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
  const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
  return lerp(
    lerp(lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u), lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u), v),
    lerp(lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u), lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u), v),
    w
  );
}
/* 两层叠加,归一到约 0..1 */
const field = (x: number, y: number, z: number) =>
  0.5 + 0.62 * noise(x * 0.0019, y * 0.0019, z) + 0.26 * noise(x * 0.0041 + 17, y * 0.0041 - 9, z * 1.7);

/* marching squares 的 16 种情形 → 要连的边(0 上 1 右 2 下 3 左) */
const SEGMENTS: number[][][] = [
  [], [[3, 2]], [[2, 1]], [[3, 1]], [[0, 1]], [[3, 0], [2, 1]], [[0, 2]], [[3, 0]],
  [[3, 0]], [[0, 2]], [[3, 2], [0, 1]], [[0, 1]], [[3, 1]], [[2, 1]], [[3, 2]], [],
];

export function initBgField() {
  const canvas = document.getElementById('bg-field') as HTMLCanvasElement | null;
  if (!canvas || canvas.dataset.bound) return;
  canvas.dataset.bound = 'true';
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0, h = 0, dpr = 1;
  let cols = 0, rows = 0;
  let values = new Float32Array(0);
  let running = false;
  let raf = 0;
  let last = 0;
  let enabled = false;

  /* 鼠标热源:平滑跟随,离开页面后淡出 */
  const mouse = { x: -999, y: -999, tx: -999, ty: -999, heat: 0, theatTarget: 0 };
  let colors = { line: '#6b717d', accent: '#5d54a6', dark: false };

  const readColors = () => {
    const cs = getComputedStyle(document.documentElement);
    const dark = document.documentElement.dataset.theme !== 'light';
    colors = {
      /* 深色底上线条要更亮一档才看得见 */
      line: cs.getPropertyValue(dark ? '--ink-1' : '--ink-2').trim() || '#6b717d',
      accent: cs.getPropertyValue('--accent').trim() || '#5d54a6',
      dark,
    };
  };

  const resize = () => {
    w = innerWidth;
    h = innerHeight;
    enabled = w >= MIN_WIDTH;
    canvas.style.display = enabled ? 'block' : 'none';
    if (!enabled) return;
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    cols = Math.ceil(w / CELL) + 2;
    rows = Math.ceil(h / CELL) + 2;
    values = new Float32Array(cols * rows);
    draw(performance.now());
  };

  const draw = (now: number) => {
    if (!enabled) return;
    const t = now * 0.001;
    const z = t * 0.022; // 漂移速度:极慢
    const scroll = scrollY * 0.22; // 视差:场比内容滚得慢
    const half = Math.min(FRAME_HALF, w / 2 - 40);
    const cx = w / 2;
    const skipL = cx - half - 10;
    const skipR = cx + half + 10;

    /* 1. 采样(跳过被正文遮住的中间列) */
    for (let j = 0; j < rows; j++) {
      const y = j * CELL;
      for (let i = 0; i < cols; i++) {
        const x = i * CELL;
        if (x > skipL + CELL && x < skipR - CELL) continue;
        values[j * cols + i] = field(x, y + scroll, z);
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    /* 热源:光标附近的线段收集起来,再用径向渐隐的强调色加描一遍 */
    const heat = mouse.heat > 0.01;
    const R = 320;
    const R2 = R * R;
    let hotStyle: CanvasGradient | null = null;
    if (heat) {
      hotStyle = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, R);
      hotStyle.addColorStop(0, withAlpha(colors.accent, 0.95 * mouse.heat));
      hotStyle.addColorStop(0.55, withAlpha(colors.accent, 0.55 * mouse.heat));
      hotStyle.addColorStop(1, withAlpha(colors.accent, 0));
    }

    /* 2. 逐条等温线描边(每 4 条一条"索引线",更粗更亮,像地形图) */
    for (let k = 0; k < LEVELS; k++) {
      const level = 0.5 + (k - (LEVELS - 1) / 2) * LEVEL_STEP;
      const index = k % 4 === 0;
      ctx.beginPath();
      const hot = heat ? new Path2D() : null;
      for (let j = 0; j < rows - 1; j++) {
        for (let i = 0; i < cols - 1; i++) {
          const x0 = i * CELL;
          if (x0 > skipL && x0 < skipR - CELL) continue;
          const a = values[j * cols + i];
          const b = values[j * cols + i + 1];
          const c = values[(j + 1) * cols + i + 1];
          const d = values[(j + 1) * cols + i];
          const idx = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
          const segs = SEGMENTS[idx];
          if (!segs.length) continue;
          const y0 = j * CELL;
          for (const [e1, e2] of segs) {
            const p1 = edgePoint(e1, x0, y0, a, b, c, d, level);
            const p2 = edgePoint(e2, x0, y0, a, b, c, d, level);
            ctx.moveTo(p1[0], p1[1]);
            ctx.lineTo(p2[0], p2[1]);
            if (hot) {
              const dx = p1[0] - mouse.x, dy = p1[1] - mouse.y;
              if (dx * dx + dy * dy < R2) {
                hot.moveTo(p1[0], p1[1]);
                hot.lineTo(p2[0], p2[1]);
              }
            }
          }
        }
      }
      ctx.strokeStyle = colors.line;
      ctx.globalAlpha = index ? 0.62 : 0.34;
      ctx.lineWidth = index ? 1.25 : 0.85;
      ctx.stroke();
      if (hot && hotStyle) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = hotStyle;
        ctx.lineWidth = (index ? 1.25 : 0.85) + 0.6;
        ctx.stroke(hot);
      }
    }
    ctx.globalAlpha = 1;

    /* 3. 向正文列渐隐 + 靠近视口外缘稍淡,留出"呼吸" */
    ctx.globalCompositeOperation = 'destination-in';
    const mask = ctx.createLinearGradient(0, 0, w, 0);
    const fadeIn = Math.max(0, (cx - half - 220) / w);
    const edgeL = Math.max(0, (cx - half) / w);
    mask.addColorStop(0, 'rgba(0,0,0,0.55)');
    mask.addColorStop(Math.min(fadeIn, edgeL), 'rgba(0,0,0,1)');
    mask.addColorStop(edgeL, 'rgba(0,0,0,0)');
    mask.addColorStop(1 - edgeL, 'rgba(0,0,0,0)');
    mask.addColorStop(1 - Math.min(fadeIn, edgeL), 'rgba(0,0,0,1)');
    mask.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  };

  const tick = (now: number) => {
    raf = 0;
    if (!running) return;
    /* 约 30fps */
    if (now - last >= 33) {
      last = now;
      mouse.x += (mouse.tx - mouse.x) * 0.12;
      mouse.y += (mouse.ty - mouse.y) * 0.12;
      mouse.heat += (mouse.theatTarget - mouse.heat) * 0.08;
      draw(now);
    }
    raf = requestAnimationFrame(tick);
  };

  const start = () => {
    if (running || reduced || !enabled) return;
    running = true;
    raf = requestAnimationFrame(tick);
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
  };

  readColors();
  resize();
  if (!reduced) start();

  addEventListener('resize', () => {
    stop();
    resize();
    start();
  });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  addEventListener('scroll', () => {
    if (reduced) draw(performance.now());
  }, { passive: true });
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    mouse.tx = e.clientX;
    mouse.ty = e.clientY;
    mouse.theatTarget = 1;
    if (mouse.x < -900) { mouse.x = e.clientX; mouse.y = e.clientY; }
  }, { passive: true });
  document.addEventListener('pointerleave', () => (mouse.theatTarget = 0));
  addEventListener('blur', () => (mouse.theatTarget = 0));

  /* 主题切换 → 重新取色 */
  new MutationObserver(() => {
    readColors();
    if (reduced) draw(performance.now());
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

/* 边上的交点(线性插值) */
function edgePoint(edge: number, x0: number, y0: number, a: number, b: number, c: number, d: number, level: number): [number, number] {
  switch (edge) {
    case 0: return [x0 + CELL * ((level - a) / (b - a)), y0];
    case 1: return [x0 + CELL, y0 + CELL * ((level - b) / (c - b))];
    case 2: return [x0 + CELL * ((level - d) / (c - d)), y0 + CELL];
    default: return [x0, y0 + CELL * ((level - a) / (d - a))];
  }
}

/* '#rrggbb' + alpha → rgba() */
function withAlpha(hex: string, alpha: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(139,130,217,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
