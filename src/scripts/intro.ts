/* 首页入场:点阵锦鲤池(画面见 koi-pond.ts,design.md §2.6)
 *
 * 这里只管「门」:遮罩与进入。
 * 点击任意处:从点击处荡开一圈水波,波里一点点露出首页(koi-pond.ts 的 reveal);
 * 按任意键 / 向下滚动:水波从「点击进入」那里荡开。
 * 是否出现由 Base.astro <head> 的内联脚本在绘制前决定(每个会话一次,?intro 强制重播)。
 */
import { createKoiPond } from './koi-pond';

const SEEN_KEY = 'intro-seen';

export function initIntro() {
  const root = document.documentElement;
  const gate = document.getElementById('intro');
  if (!gate || root.dataset.intro !== 'on' || gate.dataset.bound) return;
  gate.dataset.bound = 'true';
  (window as Window & { __introBound?: boolean }).__introBound = true;

  const canvas = gate.querySelector<HTMLCanvasElement>('.intro-canvas');
  const hud = gate.querySelector<HTMLElement>('.intro-hud');
  /* 文字浮在池面上,它下面的字符压暗;点击是「进入」,所以这里不撒鱼食 */
  const scene = canvas && createKoiPond(canvas, { textZone: hud, floor: '/assets/riverbed-background.webp' });
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
  const finish = () => {
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
    if (x === undefined || y === undefined) {
      const b = gate.querySelector('.intro-enter')?.getBoundingClientRect();
      x = b ? b.left + b.width / 2 : innerWidth / 2;
      y = b ? b.top + b.height / 2 : innerHeight * 0.8;
    }
    root.dataset.intro = 'leaving';
    gate.classList.add('is-leaving');
    scene.reveal(x, y).then(finish);
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
