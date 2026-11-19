/* 首页低温光谱调谐带交互（ThermoStrip）：
 *   - 驻留式调谐读数：SSR 默认停靠最新发布文章；指针横掠光栅槽时实时磁吸锁定最近谱线，离开后保持停靠在当前调谐频道（如物理收音机旋钮）
 *   - 幽灵游丝与对称光栅起伏（prefers-reduced-motion: no-preference）：横掠时显示 1px 游丝，邻近 0.2°C 光栅线从中心对称舒张
 *   - 底栏物态透镜：悬停或聚焦四档物态时压暗异相谱线，临时预览该物态最新文章，移开后恢复原停靠频道
 *   - 键盘支持：聚焦谱线同步调谐，← / → / Home / End 逐根调台，Esc 清除过滤或失焦 */

let thermoAc: AbortController | undefined;
let swapBound = false;

const SIGMA = 22;
const INV_2_SIGMA2 = 1 / (2 * SIGMA * SIGMA);
const TICK_CUTOFF = SIGMA * 2.8;

export function initThermo() {
  thermoAc?.abort();

  if (!swapBound) {
    swapBound = true;
    document.addEventListener('astro:before-swap', () => thermoAc?.abort());
  }

  const thermo = document.querySelector<HTMLElement>('main .thermo');
  if (!thermo) return;

  const track = thermo.querySelector<HTMLElement>('.thermo-track');
  const pinList = thermo.querySelector<HTMLElement>('.thermo-pins');
  const pins = [...thermo.querySelectorAll<HTMLAnchorElement>('.thermo-pin')];
  const phases = [...thermo.querySelectorAll<HTMLAnchorElement>('.thermo-phase')];
  const ticks = [...thermo.querySelectorAll<SVGLineElement>('.thermo-ticks-svg line')];

  const readoutLink = thermo.querySelector<HTMLAnchorElement>('.thermo-readout-link');
  const readoutId = thermo.querySelector<HTMLElement>('.thermo-readout-id');
  const readoutTitle = thermo.querySelector<HTMLElement>('.thermo-readout-title');
  const readoutTemp = thermo.querySelector<HTMLElement>('.thermo-readout-temp');
  const readoutDot = thermo.querySelector<HTMLElement>('.thermo-readout-dot');

  if (!track || !pins.length) return;

  thermoAc = new AbortController();
  const { signal } = thermoAc;
  const motionOk = matchMedia('(prefers-reduced-motion: no-preference)');

  const pinRatio = pins.map((p) => Number(p.dataset.x || 0) / 100);
  const tickCount = ticks.length;
  const tickRatio = ticks.map((_, j) => (tickCount > 1 ? j / (tickCount - 1) : 0));
  const tickTier = ticks.map((l) => Number(l.dataset.tier || 0)); // 0: 0.2°C, 1: 1°C, 2: 4°C
  const tickScaled = new Uint8Array(tickCount);

  /* 每个物态内最新发布的一篇，供底栏物态透镜悬停时临时预览 */
  const newestByPhase = new Map<string, HTMLAnchorElement>();
  for (const p of pins) {
    const ph = p.dataset.phase;
    if (!ph) continue;
    const prev = newestByPhase.get(ph);
    if (!prev || Number(p.dataset.published || 0) > Number(prev.dataset.published || 0)) {
      newestByPhase.set(ph, p);
    }
  }

  let parkedPin: HTMLAnchorElement =
    pins.find((p) => p.classList.contains('is-active')) ?? pins[0];
  let displayedPin: HTMLAnchorElement = parkedPin;

  let trackLeft = 0;
  let trackWidth = 0;
  let downX: number | null = null;
  let scrubbed = false;

  const refreshRect = () => {
    const r = track.getBoundingClientRect();
    trackLeft = r.left;
    trackWidth = r.width;
  };

  const resetTicks = () => {
    for (let j = 0; j < tickCount; j++) {
      if (tickScaled[j]) {
        ticks[j].style.removeProperty('--ts');
        tickScaled[j] = 0;
      }
    }
  };

  const setDisplayedPin = (pin: HTMLAnchorElement, commitPark: boolean) => {
    if (commitPark) {
      parkedPin = pin;
    }
    if (displayedPin !== pin) {
      displayedPin.classList.remove('is-active');
      displayedPin = pin;
      pin.classList.add('is-active');
    } else if (!pin.classList.contains('is-active')) {
      pin.classList.add('is-active');
    }

    if (pin.dataset.x) {
      thermo.style.setProperty('--pointer-x', `${pin.dataset.x}%`);
    }
    if (readoutLink) readoutLink.href = pin.href;
    if (readoutId) readoutId.textContent = pin.dataset.id || '';
    if (readoutTitle) readoutTitle.textContent = pin.dataset.title || '';
    if (readoutTemp) {
      readoutTemp.textContent = `${pin.dataset.state || ''} · ${pin.dataset.temp || ''}`.trim();
    }
    if (readoutDot && pin.dataset.color) {
      readoutDot.style.background = pin.dataset.color;
    }
  };

  const updateAtClientX = (clientX: number) => {
    if (trackWidth <= 0) refreshRect();
    if (trackWidth <= 0) return;

    const relX = Math.max(0, Math.min(trackWidth, clientX - trackLeft));
    track.classList.add('is-scrubbing');
    track.style.setProperty('--ghost-x', `${relX.toFixed(1)}px`);
    delete thermo.dataset.filterPhase;

    let nearest = pins[0];
    let minDist = Infinity;
    for (let i = 0; i < pins.length; i++) {
      const d = Math.abs(pinRatio[i] * trackWidth - relX);
      if (d < minDist) {
        minDist = d;
        nearest = pins[i];
      }
    }
    setDisplayedPin(nearest, true);

    if (motionOk.matches && tickCount > 0) {
      for (let j = 0; j < tickCount; j++) {
        const dx = tickRatio[j] * trackWidth - relX;
        if (Math.abs(dx) > TICK_CUTOFF) {
          if (tickScaled[j]) {
            ticks[j].style.removeProperty('--ts');
            tickScaled[j] = 0;
          }
        } else {
          const g = Math.exp(-dx * dx * INV_2_SIGMA2);
          const tier = tickTier[j];
          const boost = tier === 2 ? 0.28 : tier === 1 ? 0.42 : 0.56;
          ticks[j].style.setProperty('--ts', (1 + boost * g).toFixed(3));
          tickScaled[j] = 1;
        }
      }
    }
  };

  const endScrub = () => {
    track.classList.remove('is-scrubbing');
    resetTicks();
    downX = null;
  };

  /* 1. 光栅槽指针调谐 */
  track.addEventListener(
    'pointerenter',
    (e) => {
      refreshRect();
      if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
        updateAtClientX(e.clientX);
      }
    },
    { signal }
  );

  track.addEventListener(
    'pointerdown',
    (e) => {
      refreshRect();
      downX = e.clientX;
      scrubbed = false;
      updateAtClientX(e.clientX);
    },
    { signal }
  );

  track.addEventListener(
    'pointermove',
    (e) => {
      if (downX != null && Math.abs(e.clientX - downX) > 10) {
        scrubbed = true;
      }
      updateAtClientX(e.clientX);
    },
    { passive: true, signal }
  );

  track.addEventListener('pointerup', endScrub, { signal });
  track.addEventListener('pointercancel', endScrub, { signal });
  track.addEventListener('pointerleave', endScrub, { signal });

  track.addEventListener(
    'click',
    (e) => {
      if (scrubbed) {
        scrubbed = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const directLink = (e.target as HTMLElement | null)?.closest?.('a');
      if (directLink) return;
      if (displayedPin) {
        if (e.metaKey || e.ctrlKey) {
          window.open(displayedPin.href, '_blank', 'noopener');
        } else {
          displayedPin.click();
        }
      }
    },
    { signal }
  );

  /* 2. 键盘聚焦与左右方向键调台 */
  if (pinList) {
    pinList.addEventListener(
      'focusin',
      (e) => {
        const pin = (e.target as HTMLElement | null)?.closest?.<HTMLAnchorElement>('.thermo-pin');
        if (pin) {
          delete thermo.dataset.filterPhase;
          setDisplayedPin(pin, true);
        }
      },
      { signal }
    );

    pinList.addEventListener(
      'keydown',
      (e) => {
        const pin = (e.target as HTMLElement | null)?.closest?.<HTMLAnchorElement>('.thermo-pin');
        if (!pin) return;
        const idx = pins.indexOf(pin);
        if (idx < 0) return;

        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          pins[Math.min(pins.length - 1, idx + 1)]?.focus();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          pins[Math.max(0, idx - 1)]?.focus();
        } else if (e.key === 'Home') {
          e.preventDefault();
          pins[0]?.focus();
        } else if (e.key === 'End') {
          e.preventDefault();
          pins[pins.length - 1]?.focus();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          delete thermo.dataset.filterPhase;
          pin.blur();
        }
      },
      { signal }
    );
  }

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape') {
        if (thermo.dataset.filterPhase) {
          delete thermo.dataset.filterPhase;
          setDisplayedPin(parkedPin, false);
        }
        const activeEl = document.activeElement as HTMLElement | null;
        if (activeEl && thermo.contains(activeEl)) activeEl.blur();
      }
    },
    { signal }
  );

  /* 3. 底栏四档物态透镜过滤（临时预览该物态最新文章，移开恢复停靠频道） */
  for (const ph of phases) {
    const phase = ph.dataset.phase;
    if (!phase) continue;

    const previewPhase = () => {
      thermo.dataset.filterPhase = phase;
      const preview = newestByPhase.get(phase);
      if (preview) {
        setDisplayedPin(preview, false);
      }
    };

    const restorePhase = () => {
      if (thermo.dataset.filterPhase === phase) {
        delete thermo.dataset.filterPhase;
        setDisplayedPin(parkedPin, false);
      }
    };

    ph.addEventListener('pointerenter', previewPhase, { signal });
    ph.addEventListener('pointerleave', restorePhase, { signal });
    ph.addEventListener('focus', previewPhase, { signal });
    ph.addEventListener('blur', restorePhase, { signal });
  }

  window.addEventListener('resize', refreshRect, { passive: true, signal });
}
