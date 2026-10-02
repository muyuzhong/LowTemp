/* 全站交互：主题、键盘、站内链接预览、代码块、diff 块。
 * 页面切换由 Astro ClientRouter 完成，所以：
 *   - 全局委托（document / window 上的监听）只绑一次
 *   - 针对当前页面 DOM 的增强放在 astro:page-load 里每次重做 */

import { initBgField } from './bg-field';

type Win = Window & {
  openCommandPalette?: () => void;
  closeCommandPalette?: () => void;
  __focusReading?: { toggle(): boolean; isOn(): boolean } | null;
  __siteBound?: boolean;
};
const w = window as Win;

/* ---------- 主题 ---------- */
export const currentTheme = () => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';

export function setTheme(next: 'light' | 'dark') {
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('theme', next);
  } catch (_) {}
}

export const toggleTheme = () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark');

/* ---------- 站内链接即刻预览 ---------- */
function setupLinkPopover() {
  const popover = document.getElementById('link-popover');
  const data = document.getElementById('post-previews-data');
  if (!popover || !data || popover.dataset.bound) return;
  popover.dataset.bound = 'true';

  let previews: Record<string, any> = {};
  try {
    previews = JSON.parse(data.textContent || '{}');
  } catch (_) {
    return;
  }

  const $ = (id: string) => document.getElementById(id);
  let timer: number | undefined;

  const hide = () => {
    clearTimeout(timer);
    popover.classList.remove('visible');
    popover.setAttribute('aria-hidden', 'true');
  };
  w.addEventListener('keydown', (e) => e.key === 'Escape' && hide());

  document.addEventListener('mouseover', (e) => {
    const a = (e.target as HTMLElement)?.closest?.('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href) return;
    let url: URL;
    try {
      url = new URL(href, location.origin);
    } catch (_) {
      return;
    }
    if (url.origin !== location.origin) return;
    const path = url.pathname.endsWith('/') ? url.pathname : url.pathname + '/';
    const post = previews[path];
    if (!post || path === location.pathname) return;

    clearTimeout(timer);
    timer = window.setTimeout(() => {
      $('popover-id')!.textContent = post.id;
      $('popover-status-text')!.textContent = `${post.statusLabel} · ${post.tempStr}`;
      $('popover-dot')!.style.backgroundColor = post.statusColor;
      $('popover-time')!.textContent = `${post.minutes} 分钟`;
      $('popover-title')!.textContent = post.title;
      $('popover-excerpt')!.textContent = post.excerpt;

      const rect = a.getBoundingClientRect();
      const cardW = 320;
      const cardH = popover.offsetHeight || 150;
      const left = Math.max(16, Math.min(innerWidth - cardW - 16, rect.left));
      const top = rect.top - cardH - 10 < 16 ? rect.bottom + 10 : rect.top - cardH - 10;
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
      popover.classList.add('visible');
      popover.setAttribute('aria-hidden', 'false');
    }, 260);
  });
  document.addEventListener('mouseout', (e) => {
    if ((e.target as HTMLElement)?.closest?.('a')) hide();
  });
  document.addEventListener('astro:before-swap', hide);
}

/* ---------- 代码块：顶栏 + 复制 ---------- */
async function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {}
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (_) {
    return false;
  }
}

function enhanceCode() {
  document.querySelectorAll<HTMLPreElement>('.prose pre').forEach((pre) => {
    if (pre.dataset.enhanced) return;
    pre.dataset.enhanced = 'true';

    const code = pre.querySelector('code');
    const langClass = [...(code?.classList ?? [])].find((c) => c.startsWith('language-'));
    const lang = (langClass ? langClass.slice(9) : pre.dataset.language || 'code').toUpperCase();
    const first = (code?.textContent || '').split('\n')[0]?.trim() || '';
    const filename = /^(\/\/|#)\s+\S+[./]\S+/.test(first) ? first.replace(/^(\/\/|#)\s+/, '') : '';

    const wrapper = document.createElement('div');
    wrapper.className = 'codeblock-wrapper';
    const header = document.createElement('div');
    header.className = 'codeblock-header mono';
    const label = document.createElement('span');
    label.className = 'codeblock-lang';
    label.textContent = filename || lang;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-btn mono';
    btn.setAttribute('aria-label', '复制代码');
    btn.textContent = '复制';
    btn.addEventListener('click', async () => {
      if (await copyText(code?.innerText ?? pre.innerText)) {
        btn.textContent = '已复制';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = '复制';
          btn.classList.remove('copied');
        }, 1800);
      }
    });
    header.append(label, btn);
    pre.replaceWith(wrapper);
    wrapper.append(header, pre);
  });
}

/* ---------- 列表页 J / K 选择 ---------- */
function moveSelection(down: boolean) {
  const items = [...document.querySelectorAll<HTMLElement>('[data-nav-item]')].filter((el) => el.offsetParent);
  if (!items.length) return false;
  let i = items.findIndex((el) => el.classList.contains('is-selected'));
  i = down ? (i < items.length - 1 ? i + 1 : 0) : i > 0 ? i - 1 : items.length - 1;
  items.forEach((el) => el.classList.remove('is-selected'));
  items[i].classList.add('is-selected');
  items[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  return true;
}

/* ---------- 文章页 J / K 跳章节 ---------- */
function jumpHeading(down: boolean) {
  const hs = [...document.querySelectorAll<HTMLElement>('.prose h2')];
  if (!hs.length) return false;
  const target = down
    ? hs.find((h) => h.getBoundingClientRect().top > 80) ?? hs[hs.length - 1]
    : [...hs].reverse().find((h) => h.getBoundingClientRect().top < -40) ?? hs[0];
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}

/* ---------- 全局委托（只绑一次） ---------- */
function bindGlobal() {
  if (w.__siteBound) return;
  w.__siteBound = true;

  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('#theme-toggle')) toggleTheme();
    else if (t.closest('#cmd-toggle-btn')) w.openCommandPalette?.();
  });

  /* 切换页面后 <html> 属性会被新文档覆盖，立刻补回主题，避免闪烁 */
  document.addEventListener('astro:after-swap', () => {
    try {
      const saved = localStorage.getItem('theme');
      document.documentElement.dataset.theme =
        saved || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    } catch (_) {}
  });

  w.addEventListener('keydown', (e) => {
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;

    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyK') {
      e.preventDefault();
      w.openCommandPalette?.();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    switch (e.code) {
      case 'Slash':
        if (!e.shiftKey) {
          e.preventDefault();
          w.openCommandPalette?.();
        }
        break;
      case 'Escape':
        w.closeCommandPalette?.();
        document.querySelector('.is-selected')?.classList.remove('is-selected');
        break;
      case 'KeyT':
        e.preventDefault();
        toggleTheme();
        break;
      case 'KeyZ':
        if (w.__focusReading) {
          e.preventDefault();
          w.__focusReading.toggle();
        }
        break;
      case 'KeyJ':
      case 'KeyK': {
        const down = e.code === 'KeyJ';
        if (jumpHeading(down) || moveSelection(down)) e.preventDefault();
        break;
      }
      case 'Enter': {
        const a = document.querySelector<HTMLElement>('[data-nav-item].is-selected a, a[data-nav-item].is-selected');
        if (a && el !== a) {
          e.preventDefault();
          a.click();
        }
        break;
      }
    }
  });
}

function enhancePage() {
  setupLinkPopover();
  enhanceCode();
  document.querySelectorAll<HTMLElement>('.diff').forEach((d) => {
    if (d.dataset.bound) return;
    d.dataset.bound = 'true';
    d.addEventListener('click', () => d.classList.toggle('active'));
  });
}

bindGlobal();
initBgField();
enhancePage(); // 首次加载（以下各步都是幂等的）
document.addEventListener('astro:page-load', enhancePage);
