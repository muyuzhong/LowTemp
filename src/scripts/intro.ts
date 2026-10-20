/* 首页入场:ASCII 锦鲤池(画面见 koi-pond.ts,design.md §2.6)
 *
 * 这里只管「门」:遮罩与进入。
 * 点击任意处 / 按任意键 / 向下滚动:整页淡出,进入首页。
 * 是否出现由 Base.astro <head> 的内联脚本在绘制前决定(每个会话一次,?intro 强制重播)。
 */
import { createKoiPond } from './koi-pond';

const SEEN_KEY = 'intro-seen';
const FADE_OUT = 700;

export function initIntro() {
  const root = document.documentElement;
  const gate = document.getElementById('intro');
  if (!gate || root.dataset.intro !== 'on' || gate.dataset.bound) return;
  gate.dataset.bound = 'true';
  (window as Window & { __introBound?: boolean }).__introBound = true;

  const canvas = gate.querySelector<HTMLCanvasElement>('.intro-canvas');
  const hud = gate.querySelector<HTMLElement>('.intro-hud');
  /* 文字浮在池面上,它下面的字符压暗;点击是「进入」,所以这里不撒鱼食 */
  const scene = canvas && createKoiPond(canvas, { textZone: hud });
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

  const enter = () => {
    if (leaving) return;
    leaving = true;
    try {
      sessionStorage.setItem(SEEN_KEY, '1');
    } catch (_) {}
    if (reduced) return finish();
    root.dataset.intro = 'leaving';
    gate.classList.add('is-leaving');
    setTimeout(finish, FADE_OUT);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return; // 不拦浏览器快捷键
    if (e.key.length !== 1 && !['Enter', 'Escape', 'ArrowDown', 'PageDown'].includes(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation(); // 别让站内快捷键(T / Z / /)在遮罩后面触发
    enter();
  };

  gate.addEventListener('click', enter);
  gate.addEventListener('wheel', (e) => e.deltaY > 0 && enter(), { passive: true });
  addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => gate.classList.add('is-ready'));
}
