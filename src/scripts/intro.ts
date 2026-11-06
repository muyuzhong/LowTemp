/* 首页入场:一根弦(画面见 intro-string.ts,design.md §2.6)
 *
 * 这里只管「门」:遮罩、进入,以及进入时首页各部分怎样接上那根弦。
 * 点击任意处 / 按任意键 / 向下滚动 → 弦按 LAND 时间线落到温度尺的色带上;
 * 咬合的同时,文章立杆从左到右从色带上长出来,页头、标题、文章列表顺着这根基准线浮现。
 * 是否出现由 Base.astro <head> 的内联脚本在绘制前决定(每个会话一次,?intro 强制重播)。
 */
import { createStringScene, LAND, type Axis, type Landing } from './intro-string';

const SEEN_KEY = 'intro-seen';
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
/* 立杆破土:冒出来时略微过头再落定 */
const GROW = 'cubic-bezier(0.3, 1.4, 0.55, 1)';
/* 与 global.css 的 .thermo-ticks 一致:色带下 3px 起,半度 6px,主刻度 12px */
const TICK_GAP = 3;
const TICK_HALF = 6;
const TICK_MAJOR = 12;

export function initIntro() {
  const root = document.documentElement;
  const gate = document.getElementById('intro');
  if (!gate || root.dataset.intro !== 'on' || gate.dataset.bound) return;
  gate.dataset.bound = 'true';
  (window as Window & { __introBound?: boolean }).__introBound = true;

  const thermo = document.querySelector<HTMLElement>('main .thermo');
  const band = thermo?.querySelector<HTMLElement>('.thermo-band') ?? null;
  const tickRow = thermo?.querySelector<HTMLElement>('.thermo-ticks') ?? null;
  const max = Number(thermo?.dataset.max ?? 20);
  const min = Number(thermo?.dataset.min ?? 3);
  const majors = (thermo?.dataset.majors ?? '20,16,12,8,4').split(',').map(Number);

  /* 弦的横坐标 = 温度尺的横坐标;没有温度尺时假装版心居中 */
  const measure = (): Axis => {
    const r = band?.getBoundingClientRect();
    if (r && r.width > 40) return { left: r.left, right: r.right, max, min, majors };
    const w = Math.min(1024, innerWidth - 40);
    return { left: (innerWidth - w) / 2, right: (innerWidth + w) / 2, max, min, majors };
  };
  const landing = (): Landing | null => {
    if (!band || !tickRow) return null;
    const b = band.getBoundingClientRect();
    if (b.width < 40) return null;
    return {
      y: b.top + b.height / 2,
      thick: b.height,
      bandAlpha: Number(getComputedStyle(band).opacity) || 0.45,
      gap: tickRow.getBoundingClientRect().top + TICK_GAP - b.bottom,
      half: TICK_HALF,
      major: TICK_MAJOR,
    };
  };

  const canvas = gate.querySelector<HTMLCanvasElement>('.intro-canvas');
  const scene = canvas && createStringScene(canvas, measure);
  if (!scene) {
    root.removeAttribute('data-intro');
    return;
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* 遮罩期间页面其余部分不可聚焦、不可点 */
  const inerted = [...document.body.children].filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el !== gate && !(el instanceof HTMLScriptElement) && !el.inert
  );
  inerted.forEach((el) => (el.inert = true));

  let leaving = false;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    scene.destroy();
    removeEventListener('keydown', onKey, true);
    inerted.forEach((el) => (el.inert = false));
    root.removeAttribute('data-intro');
    gate.remove();
  };

  const enter = (x?: number, y?: number) => {
    if (leaving) return;
    leaving = true;
    try {
      sessionStorage.setItem(SEEN_KEY, '1');
    } catch (_) {}
    if (reduced) return finish();
    const to = landing(); // 先量,再让页面元素进入动画的起始态
    root.dataset.intro = 'leaving';
    gate.classList.add('is-leaving');
    const anims = choreograph(to);
    const done = scene.land(x ?? innerWidth / 2, y ?? scene.lineY, to);
    const safety = new Promise((r) => setTimeout(r, 3000));
    Promise.race([Promise.allSettled([done, ...anims.map((a) => a.finished)]), safety]).then(finish);
  };

  /* 进入时首页各部分的编排(Web Animations,fill: backwards —— 结束后回到样式表本来的样子) */
  const choreograph = (to: Landing | null): Animation[] => {
    const anims: Animation[] = [];
    const play = (el: Element, frames: Keyframe[], opts: KeyframeAnimationOptions) => {
      try {
        anims.push(el.animate(frames, { fill: 'backwards', ...opts }));
      } catch (_) {}
    };
    const baseY = to?.y ?? scene.lineY;
    const vh = innerHeight;

    /* 1. 色带与刻度:画布在 handoff 时把画面交过来 */
    if (to && band && tickRow) {
      const handoff = { delay: LAND.handoff, duration: LAND.fade, easing: 'linear' };
      play(band, [{ opacity: 0 }, { opacity: to.bandAlpha }], handoff);
      play(tickRow, [{ opacity: 0 }, { opacity: 1 }], handoff);
      tickRow.querySelectorAll('.major b').forEach((b) =>
        play(b, [{ opacity: 0, translate: '0 -3px' }, { opacity: 1, translate: '0 0' }], {
          delay: LAND.handoff + 40,
          duration: 420,
          easing: EASE,
        })
      );
    } else {
      [band, tickRow].forEach((el) => el && play(el, [{ opacity: 0 }, { opacity: getComputedStyle(el).opacity }], { delay: 300, duration: 500, easing: EASE }));
    }

    /* 2. 文章立杆:咔嗒之后从左到右、间隔 15ms,从色带上长出来;杆顶圆点随杆尖升起 */
    const pins = [...document.querySelectorAll<HTMLElement>('main .thermo-pin')]
      .map((el) => ({ el, x: el.getBoundingClientRect().left, h: getComputedStyle(el).height }))
      .sort((a, b) => a.x - b.x);
    const pseudo = typeof KeyframeEffect !== 'undefined' && 'pseudoElement' in KeyframeEffect.prototype;
    pins.forEach(({ el, h }, i) => {
      const delay = LAND.lock + 40 + Math.min(i * 15, 240);
      play(el, [{ height: '0px' }, { height: h }], { delay, duration: 440, easing: GROW });
      if (pseudo) play(el, [{ scale: '0.2', opacity: 0 }, { scale: '1', opacity: 1 }], { pseudoElement: '::before', delay, duration: 280, easing: EASE });
      const label = el.querySelector('.thermo-label');
      if (label) play(label, [{ opacity: 0 }, { opacity: 1 }], { delay: delay + 240, duration: 360, easing: EASE });
    });

    /* 3. 其余内容顺着基准线浮现:离线越近越早;线上方的往上浮,线下方的往下沉。
     *    温度尺的图例要等刻度交到 DOM 之后,不然尺子还没出现,说明先到了 */
    const legend = document.querySelector('main .thermo-legend');
    const blocks = [
      '.site-header',
      'main .intro > h1',
      'main .intro-sub',
      'main .intro-tags',
      'main .thermo-legend',
      'main .section-head',
      'main .entries > .entry',
      '.site-footer',
    ].flatMap((s) => [...document.querySelectorAll<HTMLElement>(s)]);
    blocks
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.bottom > 0 && r.top < vh) // 视口外的不用动
      .forEach(({ el, r }) => {
        const d = (r.top + r.bottom) / 2 - baseY;
        const delay = el === legend ? LAND.handoff + 60 : LAND.lock - 40 + Math.min(260, Math.abs(d) * 0.3);
        play(el, [{ opacity: 0, translate: `0 ${d < 0 ? 10 : -10}px` }, { opacity: getComputedStyle(el).opacity, translate: '0 0' }], {
          delay,
          duration: 520,
          easing: EASE,
        });
      });
    return anims;
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return; // 不拦浏览器快捷键
    if (e.key.length !== 1 && !['Enter', 'Escape', 'ArrowDown', 'PageDown'].includes(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation(); // 别让站内快捷键(T / Z / /)在遮罩后面触发
    enter();
  };

  /* 键盘激活按钮时 detail 为 0,没有真实坐标 */
  gate.addEventListener('click', (e) => (e.detail ? enter(e.clientX, e.clientY) : enter()));
  gate.addEventListener('wheel', (e) => e.deltaY > 0 && enter(), { passive: true });
  addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => gate.classList.add('is-ready'));
}
