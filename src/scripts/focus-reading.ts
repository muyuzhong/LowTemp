/* 聚焦阅读 — 自动高亮视口中的"当前行"，上下邻行渐变过渡。
 *
 * 实现：把正文拆成"视觉行"（Range），用 CSS Custom Highlight API 给每一行分级上色：
 *   当前行      → 不加高亮，保持正文原色（最亮）
 *   ±1 行       → ::highlight(read-l1)
 *   ±2 行       → ::highlight(read-l2)
 *   其余        → ::highlight(read-dim)
 * 不改动 DOM（不包 span），链接 / 行内代码 / 加粗等结构不受影响。
 * 不支持该 API 的浏览器：功能整体不生效，正文保持原样可读。
 */

interface Line {
  top: number; // 文档坐标
  bottom: number;
  mid: number;
  ranges: Range[];
}

interface FocusReading {
  destroy(): void;
  toggle(): boolean;
  isOn(): boolean;
}

const STORAGE_KEY = 'focus-reading';
const FOCUS_RATIO = 0.4; // 阅读线在视口中的位置
const NAMES = ['read-l1', 'read-l2', 'read-dim'] as const;
/* 这些区域保持原样：语法高亮的颜色不能被覆盖，表格 / 公式是整体 */
const SKIP = 'pre, table, .codeblock-wrapper, .katex, button, script, style, svg, [data-no-focus]';

const supported = () =>
  typeof CSS !== 'undefined' &&
  'highlights' in CSS &&
  typeof (window as any).Highlight === 'function';

/** 把 root 内的文字拆成按视觉行排列的 Range 列表 */
function buildLines(root: HTMLElement): Line[] {
  const segs: { top: number; bottom: number; mid: number; h: number; range: Range }[] = [];
  const scrollY = window.scrollY;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const el = n.parentElement;
      if (!el || el.closest(SKIP)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const probe = document.createRange();
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const len = node.length;
    probe.selectNodeContents(node);
    if (probe.getClientRects().length === 0) continue; // display:none / 折叠中

    /* 第 i 个字符所在行的垂直中心；折叠的空白字符没有 rect → null */
    const centerAt = (i: number): { c: number; h: number } | null => {
      for (let j = i; j < Math.min(len, i + 6); j++) {
        probe.setStart(node!, j);
        probe.setEnd(node!, j + 1);
        const rs = probe.getClientRects();
        if (rs.length && rs[0].height > 0) return { c: rs[0].top + rs[0].height / 2, h: rs[0].height };
      }
      return null;
    };

    let start = 0;
    while (start < len) {
      const first = centerAt(start);
      if (!first) {
        start++;
        continue;
      }
      const tol = first.h * 0.6;
      /* 二分：找到第一个"落在下一行"的字符 */
      let lo = start + 1;
      let hi = len;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        const cm = centerAt(m);
        if (cm && cm.c - first.c > tol) hi = m;
        else lo = m + 1;
      }
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, hi);
      const rect = range.getBoundingClientRect();
      if (rect.height > 0) {
        segs.push({
          top: rect.top + scrollY,
          bottom: rect.bottom + scrollY,
          mid: rect.top + scrollY + rect.height / 2,
          h: rect.height,
          range,
        });
      }
      start = hi;
    }
  }

  /* 垂直位置重合的片段（同一行里的 链接 / 加粗 / 代码）合并为一行 */
  segs.sort((a, b) => a.mid - b.mid);
  const lines: Line[] = [];
  let lastH = 0;
  for (const s of segs) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(s.mid - last.mid) < Math.min(s.h, lastH) * 0.45) {
      last.ranges.push(s.range);
      last.top = Math.min(last.top, s.top);
      last.bottom = Math.max(last.bottom, s.bottom);
      last.mid = (last.top + last.bottom) / 2;
      lastH = Math.max(lastH, s.h);
    } else {
      lines.push({ top: s.top, bottom: s.bottom, mid: s.mid, ranges: [s.range] });
      lastH = s.h;
    }
  }
  return lines;
}

/** 最靠近 y 的行下标（lines 按 mid 升序） */
function nearest(lines: Line[], y: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (lines[m].mid < y) lo = m + 1;
    else hi = m;
  }
  if (lo > 0 && Math.abs(lines[lo - 1].mid - y) <= Math.abs(lines[lo].mid - y)) return lo - 1;
  return lo;
}

/** 距离 → 档位：0 当前行（无高亮）/ 1 / 2 / 3 暗 */
const levelOf = (d: number) => (d >= 3 ? 3 : d);

export function initFocusReading(prose: HTMLElement, col: HTMLElement): FocusReading | null {
  if (!supported()) return null;

  const HighlightCtor = (window as any).Highlight;
  const registry = (CSS as any).highlights as Map<string, any>;
  const sets = [new HighlightCtor(), new HighlightCtor(), new HighlightCtor()]; // l1, l2, dim

  const guide = document.createElement('div');
  guide.className = 'focus-guide';
  guide.setAttribute('aria-hidden', 'true');
  guide.style.opacity = '0'; // 首次定位前不显示
  col.appendChild(guide);

  let lines: Line[] = [];
  let levels: number[] = [];
  let focus = -1;
  let on = localStorage.getItem(STORAGE_KEY) !== 'off';
  let raf = 0;
  let destroyed = false;
  let originY = 0;
  let guideX = 0;

  const setOf = (level: number) => (level >= 1 ? sets[level - 1] : null);

  const moveRanges = (i: number, from: number, to: number) => {
    const a = setOf(from);
    const b = setOf(to);
    for (const r of lines[i].ranges) {
      a?.delete(r);
      b?.add(r);
    }
  };

  const clearAll = () => {
    sets.forEach((s) => s.clear());
    NAMES.forEach((n) => registry.delete(n));
  };

  const register = () => {
    NAMES.forEach((n, i) => registry.set(n, sets[i]));
  };

  const placeGuide = () => {
    const l = lines[focus];
    const y = window.scrollY + window.innerHeight * FOCUS_RATIO;
    if (!on || !l || Math.abs(l.mid - y) > 90) {
      guide.style.opacity = '0';
      return;
    }
    guide.style.opacity = '';
    guide.style.height = `${l.bottom - l.top + 4}px`;
    guide.style.transform = `translate3d(${guideX}px, ${l.top - 2 - originY}px, 0)`;
  };

  const applyFocus = (next: number) => {
    const touched = new Set<number>();
    for (const c of [focus, next]) {
      if (c < 0) continue;
      for (let i = c - 3; i <= c + 3; i++) if (i >= 0 && i < lines.length) touched.add(i);
    }
    touched.forEach((i) => {
      const lv = next < 0 ? 3 : levelOf(Math.abs(i - next));
      if (levels[i] !== lv) {
        moveRanges(i, levels[i], lv);
        levels[i] = lv;
      }
    });
    focus = next;
    placeGuide();
  };

  const rebuild = () => {
    if (destroyed) return;
    clearAll();
    const colRect = col.getBoundingClientRect();
    const proseRect = prose.getBoundingClientRect();
    originY = colRect.top + window.scrollY;
    guideX = proseRect.left - colRect.left - 16;
    lines = buildLines(prose);
    levels = lines.map(() => 3);
    lines.forEach((l) => l.ranges.forEach((r) => sets[2].add(r)));
    focus = -1;
    if (!on || lines.length === 0) {
      clearAll();
      guide.style.opacity = '0';
      return;
    }
    register();
    update();
  };

  const update = () => {
    raf = 0;
    if (!on || lines.length === 0) return;
    const y = window.scrollY + window.innerHeight * FOCUS_RATIO;
    const next = nearest(lines, y);
    if (next !== focus) applyFocus(next);
    else placeGuide();
  };

  const onScroll = () => {
    if (!raf) raf = requestAnimationFrame(update);
  };

  let rebuildTimer = 0;
  const scheduleRebuild = () => {
    clearTimeout(rebuildTimer);
    rebuildTimer = window.setTimeout(rebuild, 120);
  };

  const ro = new ResizeObserver(scheduleRebuild);
  ro.observe(prose);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', scheduleRebuild);
  const beforePrint = () => clearAll();
  const afterPrint = () => rebuild();
  window.addEventListener('beforeprint', beforePrint);
  window.addEventListener('afterprint', afterPrint);
  document.fonts?.ready.then(scheduleRebuild);

  /* 布局稳定后再建（代码块外壳等由别的脚本在同一时刻插入） */
  requestAnimationFrame(() => requestAnimationFrame(rebuild));

  const announce = () =>
    document.dispatchEvent(new CustomEvent('focus-reading:change', { detail: { on } }));

  return {
    isOn: () => on,
    toggle() {
      on = !on;
      try {
        localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
      } catch (_) {}
      rebuild();
      announce();
      return on;
    },
    destroy() {
      destroyed = true;
      clearTimeout(rebuildTimer);
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', scheduleRebuild);
      window.removeEventListener('beforeprint', beforePrint);
      window.removeEventListener('afterprint', afterPrint);
      clearAll();
      guide.remove();
    },
  };
}
