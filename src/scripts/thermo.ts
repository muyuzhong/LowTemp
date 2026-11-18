/* 首页低温光谱尺交互（ThermoStrip）：
 *   - 轨道磁性游标：指针横掠时 0ms 锁定最近谱线立杆，顶栏实时切换为编号 · 标题 · 物态温度读数
 *   - 游标卡尺细刻度起伏（仅 prefers-reduced-motion: no-preference）：高斯钟形拉伸邻近 SVG 刻度线
 *   - 物态透镜：悬停或聚焦顶栏四档物态时按物态高亮对应立杆、压暗其余
 *   - 键盘支持：聚焦立杆同步读数，← / → 在谱线上逐根移动，Esc 复位 */

let thermoAc: AbortController | undefined;
let swapBound = false;

const SIGMA = 26;
const INV_2_SIGMA2 = 1 / (2 * SIGMA * SIGMA);
const TICK_CUTOFF = SIGMA * 3;

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
  const tickMajor = ticks.map((l) => l.dataset.major === '1');
  const tickScaled = new Uint8Array(tickCount);

  let trackLeft = 0;
  let trackWidth = 0;
  let activePin: HTMLAnchorElement | null = null;
  let pointerInside = false;
  let touchPinned = false;
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

  const setReadout = (pin: HTMLAnchorElement) => {
    if (activePin !== pin) {
      activePin?.classList.remove('is-active');
      activePin = pin;
      pin.classList.add('is-active');
      if (readoutId) readoutId.textContent = pin.dataset.id || '';
      if (readoutTitle) readoutTitle.textContent = pin.dataset.title || '';
      if (readoutTemp) {
        readoutTemp.textContent = `${pin.dataset.statusLabel || ''} ${pin.dataset.temp || ''}`.trim();
      }
      if (readoutDot) readoutDot.style.backgroundColor = pin.dataset.color || '';
    }
    thermo.classList.add('is-live');
    delete thermo.dataset.filterPhase;
  };

  const clearActive = () => {
    activePin?.classList.remove('is-active');
    activePin = null;
    thermo.classList.remove('is-live');
    resetTicks();
  };

  const updateAtClientX = (clientX: number) => {
    if (trackWidth <= 0) refreshRect();
    if (trackWidth <= 0) return;

    const relX = clientX - trackLeft;

    /* 寻找水平方向最近的谱线立杆（全轨道磁吸，也可在 80px 邻域内瞬时锁定） */
    let nearest = pins[0];
    let minDist = Infinity;
    for (let i = 0; i < pins.length; i++) {
      const d = Math.abs(pinRatio[i] * trackWidth - relX);
      if (d < minDist) {
        minDist = d;
        nearest = pins[i];
      }
    }
    setReadout(nearest);

    /* 游标卡尺刻度响应：仅在允许动效时按高斯钟形缩放邻近 SVG 刻度 */
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
          const scale = 1 + (tickMajor[j] ? 0.2 : 0.7) * g;
          ticks[j].style.setProperty('--ts', scale.toFixed(3));
          tickScaled[j] = 1;
        }
      }
    }
  };

  /* 1. 轨道指针交互 */
  track.addEventListener(
    'pointerenter',
    (e) => {
      refreshRect();
      if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
        pointerInside = true;
        touchPinned = false;
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
      if (e.pointerType !== 'mouse') {
        touchPinned = true;
      }
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
      if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
        pointerInside = true;
      }
      updateAtClientX(e.clientX);
    },
    { passive: true, signal }
  );

  const onPointerEnd = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') {
      resetTicks();
    }
    downX = null;
  };
  track.addEventListener('pointerup', onPointerEnd, { signal });
  track.addEventListener('pointercancel', onPointerEnd, { signal });

  track.addEventListener(
    'pointerleave',
    (e) => {
      if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
        pointerInside = false;
        downX = null;
        const focusedPin = pinList?.querySelector<HTMLAnchorElement>('.thermo-pin:focus');
        if (focusedPin) {
          resetTicks();
          setReadout(focusedPin);
        } else {
          clearActive();
        }
      }
    },
    { signal }
  );

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
      if (activePin) {
        if (e.metaKey || e.ctrlKey) {
          window.open(activePin.href, '_blank', 'noopener');
        } else {
          activePin.click();
        }
      }
    },
    { signal }
  );

  /* 触屏横掠后点击尺外区域收起读数 */
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (touchPinned && !thermo.contains(e.target as Node)) {
        touchPinned = false;
        clearActive();
      }
    },
    { signal }
  );

  /* 2. 键盘聚焦与左右方向键漫游 */
  if (pinList) {
    pinList.addEventListener(
      'focusin',
      (e) => {
        const pin = (e.target as HTMLElement | null)?.closest?.<HTMLAnchorElement>('.thermo-pin');
        if (pin) setReadout(pin);
      },
      { signal }
    );

    pinList.addEventListener(
      'focusout',
      (e) => {
        const next = e.relatedTarget as Node | null;
        if (!next || !pinList.contains(next)) {
          if (!pointerInside && !touchPinned) clearActive();
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
          touchPinned = false;
          pin.blur();
          clearActive();
        }
      },
      { signal }
    );
  }

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && thermo.classList.contains('is-live')) {
        touchPinned = false;
        const activeEl = document.activeElement as HTMLElement | null;
        if (activeEl && thermo.contains(activeEl)) activeEl.blur();
        clearActive();
      }
    },
    { signal }
  );

  /* 3. 顶栏四档物态透镜过滤 */
  for (const ph of phases) {
    const phase = ph.dataset.phase;
    if (!phase) continue;

    ph.addEventListener(
      'pointerenter',
      () => {
        if (!thermo.classList.contains('is-live')) {
          thermo.dataset.filterPhase = phase;
        }
      },
      { signal }
    );

    ph.addEventListener(
      'pointerleave',
      () => {
        if (thermo.dataset.filterPhase === phase) {
          delete thermo.dataset.filterPhase;
        }
      },
      { signal }
    );

    ph.addEventListener(
      'focus',
      () => {
        touchPinned = false;
        clearActive();
        thermo.dataset.filterPhase = phase;
      },
      { signal }
    );

    ph.addEventListener(
      'blur',
      () => {
        if (thermo.dataset.filterPhase === phase) {
          delete thermo.dataset.filterPhase;
        }
      },
      { signal }
    );
  }

  window.addEventListener('resize', refreshRect, { passive: true, signal });
}
