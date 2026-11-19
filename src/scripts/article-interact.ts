/**
 * 文章页轻量互动（design.md）：
 * 1. 单篇匿名去重阅读人数（有效停留满 4s 或滚动 ≥15% 计入，零 Cookie）
 * 2. 划词气泡「复制为引文」
 */

export interface ArticleInteractOptions {
  prose: HTMLElement;
  archiveId: string;
  articleTitle: string;
  signal: AbortSignal;
}

const fmtNum = new Intl.NumberFormat('zh-CN');

export function initArticleInteract(opts: ArticleInteractOptions): void {
  const { prose, archiveId, articleTitle, signal } = opts;
  if (!archiveId) return;

  const readersEl = document.getElementById('post-readers');
  const devReadersKey = `lowtemp:dev:readers:${archiveId}`;
  const readSessionKey = `lowtemp:read:${archiveId}`;

  const renderReaders = (count: number | null | undefined, isDevMock = false) => {
    if (!readersEl || typeof count !== 'number' || Number.isNaN(count) || count <= 0) return;
    readersEl.textContent = `${fmtNum.format(count)} 人读过`;
    if (isDevMock) readersEl.title = '本地预览模拟数据';
    readersEl.hidden = false;
  };

  /* ---------- 1. 拉取当前阅读人数 ---------- */
  const loadInitialData = async () => {
    try {
      const res = await fetch(`/api/lab?id=${encodeURIComponent(archiveId)}`, {
        headers: { accept: 'application/json' },
        signal,
      });
      if (res.ok) {
        const data = (await res.json()) as { enabled?: boolean; readers?: number | null };
        if (data.enabled && typeof data.readers === 'number' && data.readers > 0) {
          renderReaders(data.readers);
        }
        return;
      }

      if (import.meta.env.DEV && res.status === 404) {
        const mockReaders = parseInt(localStorage.getItem(devReadersKey) || '0', 10) || 0;
        if (mockReaders > 0) renderReaders(mockReaders, true);
      }
    } catch {
      /* 静默降级 */
    }
  };

  void loadInitialData();

  /* ---------- 2. 有效阅读去重上报（停留满 4s 或滚动 ≥15%） ---------- */
  let alreadyCountedSession = false;
  try {
    alreadyCountedSession = sessionStorage.getItem(readSessionKey) === '1';
  } catch {}

  if (!alreadyCountedSession) {
    let recorded = false;
    let visibleMs = 0;
    let lastVisibleAt = document.visibilityState === 'visible' ? performance.now() : null;

    const commitRead = async () => {
      if (recorded || signal.aborted) return;
      recorded = true;
      clearInterval(readTimer);

      try {
        const res = await fetch('/api/lab', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'read', id: archiveId }),
          signal,
        });
        if (res.ok) {
          const data = (await res.json()) as { enabled?: boolean; readers?: number | null };
          if (data.enabled && typeof data.readers === 'number') {
            try {
              sessionStorage.setItem(readSessionKey, '1');
            } catch {}
            renderReaders(data.readers);
          }
          return;
        }
        if (import.meta.env.DEV && res.status === 404) {
          const next = (parseInt(localStorage.getItem(devReadersKey) || '0', 10) || 0) + 1;
          try {
            localStorage.setItem(devReadersKey, String(next));
            sessionStorage.setItem(readSessionKey, '1');
          } catch {}
          renderReaders(next, true);
        }
      } catch {}
    };

    const readTimer = window.setInterval(() => {
      if (signal.aborted) {
        clearInterval(readTimer);
        return;
      }
      if (document.visibilityState === 'visible') {
        const now = performance.now();
        if (lastVisibleAt !== null) visibleMs += now - lastVisibleAt;
        lastVisibleAt = now;
        if (visibleMs >= 4000) void commitRead();
      } else {
        lastVisibleAt = null;
      }
    }, 1000);

    signal.addEventListener('abort', () => clearInterval(readTimer), { once: true });

    document.addEventListener(
      'visibilitychange',
      () => {
        lastVisibleAt = document.visibilityState === 'visible' ? performance.now() : null;
      },
      { signal }
    );

    window.addEventListener(
      'scroll',
      () => {
        if (recorded || document.visibilityState !== 'visible') return;
        const root = document.documentElement;
        const max = root.scrollHeight - root.clientHeight;
        if (max > 120 && window.scrollY / max >= 0.15) {
          void commitRead();
        }
      },
      { passive: true, signal }
    );
  }

  /* ---------- 3. 划词气泡：「复制为引文」 ---------- */
  const bubble = document.getElementById('quote-bubble');
  const copyBtn = document.getElementById('quote-copy-btn');

  if (bubble && copyBtn) {
    let activeSelectionQuote = '';
    const hideBubble = () => {
      bubble.classList.remove('visible');
      bubble.setAttribute('aria-hidden', 'true');
    };

    const checkSelection = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? '';
      if (text.length >= 4 && sel && sel.rangeCount > 0 && prose.contains(sel.anchorNode)) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        if (rect.width > 0) {
          activeSelectionQuote = text;
          const halfW = Math.min(120, bubble.offsetWidth / 2 || 64);
          const clampedX = Math.max(
            halfW + 12,
            Math.min(window.innerWidth - halfW - 12, rect.left + rect.width / 2)
          );
          bubble.style.left = `${clampedX}px`;
          bubble.style.top = `${Math.max(48, rect.top - 8)}px`;
          bubble.classList.add('visible');
          bubble.setAttribute('aria-hidden', 'false');
          return;
        }
      }
      hideBubble();
    };

    prose.addEventListener('mouseup', () => setTimeout(checkSelection, 30), { signal });
    prose.addEventListener('touchend', () => setTimeout(checkSelection, 60), { passive: true, signal });
    document.addEventListener(
      'selectionchange',
      () => {
        if (!window.getSelection()?.toString().trim()) hideBubble();
      },
      { signal }
    );

    copyBtn.addEventListener('mousedown', (e) => e.preventDefault(), { signal });
    copyBtn.addEventListener(
      'click',
      async () => {
        if (!activeSelectionQuote) return;
        const md = `> ${activeSelectionQuote}\n>\n> —— 暮羽中《${articleTitle}》${location.href}`;
        try {
          await navigator.clipboard.writeText(md);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = md;
          ta.style.cssText = 'position:fixed;opacity:0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        copyBtn.textContent = '已复制 ✓';
        setTimeout(() => {
          copyBtn.textContent = '复制为引文';
          hideBubble();
        }, 1200);
      },
      { signal }
    );
  }
}
