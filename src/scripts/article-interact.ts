/**
 * 文章页轻量互动（design.md）：
 * 1. 单篇匿名去重阅读人数（有效停留满 4s 或滚动 ≥15% 计入，零 Cookie）
 * 2. 划词气泡「复制为引文 | 就此探讨」
 * 3. 文末无框线性「研讨与反例」原生评论（免登录、零点赞、零头像、页内作者口令直管）
 */

export interface ArticleInteractOptions {
  prose: HTMLElement;
  archiveId: string;
  articleTitle: string;
  signal: AbortSignal;
}

interface CommentItem {
  id: number;
  parent_id: number | null;
  reply_to_name: string | null;
  nickname: string;
  quote: string | null;
  content: string;
  is_author: number;
  hidden: number;
  created_at: string;
}

const ADMIN_STORAGE_KEY = 'lowtemp:admin_token';
const READER_STORAGE_KEY = 'lowtemp:reader_profile';
const fmtNum = new Intl.NumberFormat('zh-CN');

function fmtCommentTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getSavedAdminToken(): string {
  try {
    return localStorage.getItem(ADMIN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function bindImeSafeEnter(
  input: HTMLInputElement,
  onEnter: () => void,
  signal: AbortSignal
): void {
  let lastCompositionEndAt: number | null = null;
  input.addEventListener(
    'compositionend',
    (e) => {
      lastCompositionEndAt = e.timeStamp;
    },
    { signal }
  );
  input.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.isComposing || e.keyCode === 229) return;
        if (lastCompositionEndAt !== null && Math.abs(e.timeStamp - lastCompositionEndAt) < 50) {
          return;
        }
        onEnter();
      }
    },
    { signal }
  );
}

export function initArticleInteract(opts: ArticleInteractOptions): void {
  const { prose, archiveId, articleTitle, signal } = opts;
  if (!archiveId) return;

  const readersEl = document.getElementById('post-readers');
  const devReadersKey = `lowtemp:dev:readers:${archiveId}`;
  const devCommentsKey = `lowtemp:dev:comments:${archiveId}`;
  const readSessionKey = `lowtemp:read:${archiveId}`;

  const renderReaders = (count: number | null | undefined, isDevMock = false) => {
    if (!readersEl || typeof count !== 'number' || Number.isNaN(count) || count <= 0) return;
    readersEl.textContent = `${fmtNum.format(count)} 人读过`;
    if (isDevMock) readersEl.title = '本地预览模拟数据';
    readersEl.hidden = false;
  };

  /* ---------- 研讨区状态与 DOM ---------- */
  const section = document.getElementById('discussion');
  const countEl = document.getElementById('discussion-count');
  const emptyEl = document.getElementById('disc-empty');
  const listEl = document.getElementById('disc-list');

  const adminToggleBtn = document.getElementById('disc-admin-btn') as HTMLButtonElement | null;
  const adminForm = document.getElementById('disc-admin-form') as HTMLFormElement | null;
  const adminInput = document.getElementById('disc-admin-input') as HTMLInputElement | null;
  const adminCancelBtn = document.getElementById('disc-admin-cancel');
  const adminErrorEl = document.getElementById('disc-admin-error');

  const composeHome = document.getElementById('disc-compose-home');
  const composeWrap = document.getElementById('disc-compose-wrap');
  const form = document.getElementById('disc-form') as HTMLFormElement | null;
  const replyBanner = document.getElementById('disc-reply-banner');
  const replyTargetEl = document.getElementById('disc-reply-target');
  const replyCancelBtn = document.getElementById('disc-reply-cancel');
  const quoteWrap = document.getElementById('disc-quote-wrap');
  const quoteTextEl = document.getElementById('disc-quote-text');
  const quoteClearBtn = document.getElementById('disc-quote-clear');

  const identityRow = document.getElementById('disc-identity-row');
  const nicknameInput = document.getElementById('disc-nickname') as HTMLInputElement | null;
  const emailField = document.getElementById('disc-email-field');
  const emailInput = document.getElementById('disc-email') as HTMLInputElement | null;
  const growWrap = document.getElementById('disc-grow');
  const contentInput = document.getElementById('disc-content') as HTMLTextAreaElement | null;
  const errorEl = document.getElementById('disc-error');
  const statusEl = document.getElementById('disc-status');
  const submitBtn = document.getElementById('disc-submit') as HTMLButtonElement | null;

  let isAdmin = false;
  let comments: CommentItem[] = [];
  let replyToId: number | null = null;
  let attachedQuote = '';

  /* 恢复读者上次填写的称呼与邮箱 */
  const restoreReaderProfile = () => {
    if (!nicknameInput || !emailInput) return;
    if (isAdmin) {
      nicknameInput.value = '暮羽中';
      if (emailField) emailField.hidden = true;
      return;
    }
    if (emailField) emailField.hidden = false;
    try {
      const saved = JSON.parse(localStorage.getItem(READER_STORAGE_KEY) || '{}') as {
        nickname?: string;
        email?: string;
      };
      if (saved.nickname && nicknameInput.value === '暮羽中') nicknameInput.value = '';
      if (saved.nickname && !nicknameInput.value) nicknameInput.value = saved.nickname;
      if (saved.email && !emailInput.value) emailInput.value = saved.email;
    } catch {}
    if (!isAdmin && nicknameInput.value === '暮羽中') nicknameInput.value = '';
  };

  const syncAdminUi = () => {
    if (!adminToggleBtn) return;
    if (isAdmin) {
      adminToggleBtn.innerHTML = '<i class="temp-dot" style="background: var(--teal)"></i>作者模式 · 退出';
      adminToggleBtn.classList.add('is-active');
    } else {
      adminToggleBtn.textContent = '作者';
      adminToggleBtn.classList.remove('is-active');
    }
    if (identityRow) identityRow.classList.toggle('is-admin', isAdmin);
    restoreReaderProfile();
  };

  const setAttachedQuote = (q: string) => {
    attachedQuote = q.trim().slice(0, 600);
    if (!quoteWrap || !quoteTextEl) return;
    if (attachedQuote && !replyToId) {
      quoteTextEl.textContent = attachedQuote;
      quoteWrap.hidden = false;
    } else {
      quoteTextEl.textContent = '';
      quoteWrap.hidden = true;
    }
  };

  const dockComposerHome = () => {
    replyToId = null;
    if (replyBanner) replyBanner.hidden = true;
    if (composeHome && composeWrap && composeWrap.parentElement !== composeHome) {
      composeHome.appendChild(composeWrap);
    }
    if (attachedQuote) setAttachedQuote(attachedQuote);
  };

  const startReply = (target: CommentItem, mountAfterEl: HTMLElement) => {
    replyToId = target.id;
    setAttachedQuote('');
    if (replyBanner && replyTargetEl) {
      replyTargetEl.textContent = target.nickname;
      replyBanner.hidden = false;
    }
    if (composeWrap) {
      mountAfterEl.after(composeWrap);
    }
    requestAnimationFrame(() => contentInput?.focus());
  };

  /* 安全渲染评论树（纯 DOM 节点创建 + textContent，杜绝 XSS） */
  const renderComments = () => {
    if (!listEl) return;
    listEl.replaceChildren();

    const visibleItems = isAdmin ? comments : comments.filter((c) => !c.hidden);
    const publicCount = comments.filter((c) => !c.hidden).length;

    if (countEl) {
      countEl.textContent = publicCount > 0 ? `${fmtNum.format(publicCount)} 条记录` : '';
    }
    if (emptyEl) {
      emptyEl.hidden = visibleItems.length > 0;
    }

    const roots = visibleItems.filter((c) => !c.parent_id);
    const childrenByParent = new Map<number, CommentItem[]>();
    for (const c of visibleItems) {
      if (c.parent_id) {
        const arr = childrenByParent.get(c.parent_id) || [];
        arr.push(c);
        childrenByParent.set(c.parent_id, arr);
      }
    }

    const createEntryDom = (item: CommentItem, isChild: boolean): HTMLElement => {
      const wrap = document.createElement('div');
      wrap.className = isChild ? 'disc-reply-item' : 'disc-item';
      if (item.hidden) wrap.classList.add('is-hidden');
      wrap.dataset.commentId = String(item.id);

      const meta = document.createElement('div');
      meta.className = 'disc-meta';

      const who = document.createElement('div');
      who.className = 'disc-who';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'disc-author';
      nameSpan.textContent = item.nickname;
      who.appendChild(nameSpan);

      if (item.is_author) {
        const badge = document.createElement('span');
        badge.className = 'disc-author-tag';
        const dot = document.createElement('i');
        dot.className = 'temp-dot';
        dot.style.background = 'var(--teal)';
        badge.append(dot, document.createTextNode('作者'));
        who.appendChild(badge);
      }

      if (item.reply_to_name) {
        const toSpan = document.createElement('span');
        toSpan.className = 'disc-reply-to';
        toSpan.textContent = `回复 ${item.reply_to_name}`;
        who.appendChild(toSpan);
      }

      const timeEl = document.createElement('time');
      timeEl.className = 'disc-time';
      timeEl.dateTime = item.created_at;
      timeEl.textContent = fmtCommentTime(item.created_at);
      who.appendChild(timeEl);

      if (item.hidden) {
        const hiddenBadge = document.createElement('span');
        hiddenBadge.className = 'disc-hidden-badge';
        hiddenBadge.textContent = '已隐藏';
        who.appendChild(hiddenBadge);
      }

      const ops = document.createElement('div');
      ops.className = 'disc-ops';

      if (!item.hidden) {
        const replyBtn = document.createElement('button');
        replyBtn.type = 'button';
        replyBtn.className = 'disc-op-btn';
        replyBtn.textContent = '回复';
        replyBtn.addEventListener('click', () => startReply(item, bodyP));
        ops.appendChild(replyBtn);
      }

      if (isAdmin) {
        const toggleHideBtn = document.createElement('button');
        toggleHideBtn.type = 'button';
        toggleHideBtn.className = 'disc-op-btn';
        toggleHideBtn.textContent = item.hidden ? '恢复' : '隐藏';
        toggleHideBtn.addEventListener('click', () => void moderateComment(item.id, item.hidden ? 'restore' : 'hide'));
        ops.appendChild(toggleHideBtn);

        if (item.hidden) {
          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'disc-op-btn is-danger';
          delBtn.textContent = '删除';
          delBtn.addEventListener('click', () => void moderateComment(item.id, 'delete'));
          ops.appendChild(delBtn);
        }
      }

      meta.append(who, ops);
      wrap.appendChild(meta);

      if (item.quote && !isChild) {
        const q = document.createElement('blockquote');
        q.className = 'disc-item-quote';
        q.textContent = item.quote;
        wrap.appendChild(q);
      }

      const bodyP = document.createElement('p');
      bodyP.className = 'disc-body';
      bodyP.textContent = item.content;
      wrap.appendChild(bodyP);

      return wrap;
    };

    for (const rootItem of roots) {
      const li = document.createElement('li');
      li.className = 'disc-thread';
      const rootDom = createEntryDom(rootItem, false);
      li.appendChild(rootDom);

      const kids = childrenByParent.get(rootItem.id);
      if (kids && kids.length > 0) {
        const subList = document.createElement('div');
        subList.className = 'disc-replies';
        for (const kid of kids) {
          subList.appendChild(createEntryDom(kid, true));
        }
        li.appendChild(subList);
      }
      listEl.appendChild(li);
    }
  };

  /* 作者管理动作 */
  const moderateComment = async (commentId: number, op: 'hide' | 'restore' | 'delete') => {
    const token = getSavedAdminToken();
    try {
      const res = await fetch('/api/lab', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { 'x-admin-token': token } : {}),
        },
        body: JSON.stringify({ action: 'moderate', commentId, op }),
        signal,
      });

      if (res.ok || (import.meta.env.DEV && res.status === 404)) {
        if (op === 'hide') {
          comments = comments.map((c) => (c.id === commentId ? { ...c, hidden: 1 } : c));
        } else if (op === 'restore') {
          comments = comments.map((c) => (c.id === commentId ? { ...c, hidden: 0 } : c));
        } else {
          comments = comments.filter((c) => c.id !== commentId && c.parent_id !== commentId);
        }
        if (import.meta.env.DEV && res.status === 404) {
          localStorage.setItem(devCommentsKey, JSON.stringify(comments));
        }
        dockComposerHome();
        renderComments();
      }
    } catch {}
  };

  /* ---------- 1. 首次拉取：阅读人数 + 评论列表 ---------- */
  const loadInitialData = async () => {
    const token = getSavedAdminToken();
    try {
      const res = await fetch(`/api/lab?id=${encodeURIComponent(archiveId)}`, {
        headers: {
          accept: 'application/json',
          ...(token ? { 'x-admin-token': token } : {}),
        },
        signal,
      });
      if (res.ok) {
        const data = (await res.json()) as {
          enabled?: boolean;
          isAdmin?: boolean;
          readers?: number | null;
          comments?: CommentItem[];
        };
        isAdmin = Boolean(data.isAdmin);
        if (token && !isAdmin && data.enabled) {
          /* 已失效的旧口令自动清理 */
          try {
            localStorage.removeItem(ADMIN_STORAGE_KEY);
          } catch {}
        }
        syncAdminUi();
        if (data.enabled && typeof data.readers === 'number' && data.readers > 0) {
          renderReaders(data.readers);
        }
        comments = Array.isArray(data.comments) ? data.comments : [];
        renderComments();
        return;
      }

      if (import.meta.env.DEV && res.status === 404) {
        isAdmin = token === 'dev';
        syncAdminUi();
        const mockReaders = parseInt(localStorage.getItem(devReadersKey) || '0', 10) || 0;
        if (mockReaders > 0) renderReaders(mockReaders, true);
        comments = JSON.parse(localStorage.getItem(devCommentsKey) || '[]') as CommentItem[];
        renderComments();
      }
    } catch {
      syncAdminUi();
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

  /* ---------- 3. 划词气泡：「复制为引文 | 就此探讨」 ---------- */
  const bubble = document.getElementById('quote-bubble');
  const copyBtn = document.getElementById('quote-copy-btn');
  const noteBtn = document.getElementById('quote-note-btn');

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
          const halfW = Math.min(120, bubble.offsetWidth / 2 || 96);
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

    if (noteBtn) {
      noteBtn.addEventListener('mousedown', (e) => e.preventDefault(), { signal });
      noteBtn.addEventListener(
        'click',
        () => {
          if (!activeSelectionQuote) return;
          const captured = activeSelectionQuote;
          hideBubble();
          window.getSelection()?.removeAllRanges();
          dockComposerHome();
          setAttachedQuote(captured);
          composeWrap?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          window.setTimeout(() => {
            if (nicknameInput && !nicknameInput.value.trim()) {
              nicknameInput.focus({ preventScroll: true });
            } else {
              contentInput?.focus({ preventScroll: true });
            }
          }, 260);
        },
        { signal }
      );
    }
  }

  /* ---------- 4. 作者口令开关 ---------- */
  if (adminToggleBtn && adminForm && adminInput) {
    adminToggleBtn.addEventListener(
      'click',
      () => {
        if (isAdmin) {
          try {
            localStorage.removeItem(ADMIN_STORAGE_KEY);
          } catch {}
          isAdmin = false;
          syncAdminUi();
          void loadInitialData();
          return;
        }
        const nextShow = adminForm.hidden;
        adminForm.hidden = !nextShow;
        if (adminErrorEl) adminErrorEl.hidden = true;
        if (nextShow) requestAnimationFrame(() => adminInput.focus());
      },
      { signal }
    );

    adminCancelBtn?.addEventListener(
      'click',
      () => {
        adminForm.hidden = true;
        adminInput.value = '';
        if (adminErrorEl) adminErrorEl.hidden = true;
      },
      { signal }
    );

    bindImeSafeEnter(adminInput, () => adminForm.requestSubmit(), signal);

    adminForm.addEventListener(
      'submit',
      async (e) => {
        e.preventDefault();
        const candidate = adminInput.value.trim();
        if (!candidate) return;
        try {
          const res = await fetch('/api/lab', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'verify_admin', token: candidate }),
            signal,
          });
          if (res.ok || (import.meta.env.DEV && res.status === 404 && candidate === 'dev')) {
            try {
              localStorage.setItem(ADMIN_STORAGE_KEY, candidate);
            } catch {}
            isAdmin = true;
            adminInput.value = '';
            adminForm.hidden = true;
            if (adminErrorEl) adminErrorEl.hidden = true;
            syncAdminUi();
            await loadInitialData();
          } else {
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            if (adminErrorEl) {
              adminErrorEl.textContent = data.error || '口令不正确';
              adminErrorEl.hidden = false;
            }
          }
        } catch {
          if (adminErrorEl) {
            adminErrorEl.textContent = '验证请求失败，请检查网络';
            adminErrorEl.hidden = false;
          }
        }
      },
      { signal }
    );
  }

  /* ---------- 5. 发表研讨表单校验与提交 ---------- */
  if (!section || !form || !nicknameInput || !contentInput || !submitBtn) return;

  replyCancelBtn?.addEventListener(
    'click',
    () => {
      dockComposerHome();
      contentInput.focus();
    },
    { signal }
  );

  quoteClearBtn?.addEventListener(
    'click',
    () => {
      setAttachedQuote('');
      contentInput.focus();
    },
    { signal }
  );

  const syncGrowFallback = () => {
    if (growWrap && typeof CSS !== 'undefined' && !CSS.supports('field-sizing', 'content')) {
      growWrap.dataset.replicatedValue = contentInput.value;
    }
  };

  const setError = (msg: string, invalidField?: HTMLElement | null) => {
    if (!errorEl) return;
    nicknameInput.removeAttribute('aria-invalid');
    contentInput.removeAttribute('aria-invalid');
    emailInput?.removeAttribute('aria-invalid');
    if (msg) {
      errorEl.textContent = msg;
      errorEl.hidden = false;
      invalidField?.setAttribute('aria-invalid', 'true');
    } else {
      errorEl.textContent = '';
      errorEl.hidden = true;
    }
  };

  let contentTouched = false;
  nicknameInput.addEventListener('input', () => setError(''), { signal });
  emailInput?.addEventListener('input', () => setError(''), { signal });
  contentInput.addEventListener(
    'input',
    () => {
      contentTouched = true;
      syncGrowFallback();
      if (contentInput.value.trim().length >= 2) setError('');
    },
    { signal }
  );
  contentInput.addEventListener(
    'blur',
    () => {
      const v = contentInput.value.trim();
      if (contentTouched && v.length > 0 && v.length < 2) {
        setError('讨论内容至少写 2 个字。', contentInput);
      }
    },
    { signal }
  );

  /* 多行内容支持 Cmd/Ctrl + Enter 提交 */
  contentInput.addEventListener(
    'keydown',
    (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        form.requestSubmit();
      }
    },
    { signal }
  );

  /* 单行输入框 IME 安全回车跳转 / 提交 */
  bindImeSafeEnter(nicknameInput, () => contentInput.focus(), signal);
  if (emailInput) bindImeSafeEnter(emailInput, () => contentInput.focus(), signal);

  let submitting = false;
  form.addEventListener(
    'submit',
    async (e) => {
      e.preventDefault();
      if (submitting) return;

      const nickname = isAdmin ? nicknameInput.value.trim() || '暮羽中' : nicknameInput.value.trim();
      const email = isAdmin ? '' : emailInput?.value.trim() || '';
      const content = contentInput.value.trim();

      if (!nickname) {
        setError('请先填一个称呼。', nicknameInput);
        nicknameInput.focus();
        return;
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setError('邮箱格式不正确（选填，可直接留空）。', emailInput);
        emailInput?.focus();
        return;
      }
      if (content.length < 2) {
        setError('请写下你的反例、补充或探讨内容。', contentInput);
        contentInput.focus();
        return;
      }
      setError('');

      const fd = new FormData(form);
      const token = getSavedAdminToken();
      const payload = {
        action: 'comment',
        id: archiveId,
        title: articleTitle,
        url: location.href,
        parentId: replyToId,
        nickname,
        email,
        quote: replyToId ? '' : attachedQuote,
        content,
        website: String(fd.get('website') || ''),
      };

      submitting = true;
      submitBtn.disabled = true;
      const origText = submitBtn.textContent;
      submitBtn.textContent = '发布中…';

      try {
        const res = await fetch('/api/lab', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { 'x-admin-token': token } : {}),
          },
          body: JSON.stringify(payload),
          signal,
        });

        let created: CommentItem | null = null;
        let errMsg = '';

        if (res.ok) {
          const data = (await res.json()) as { ok?: boolean; comment?: CommentItem; error?: string };
          if (data.ok && data.comment) created = data.comment;
          else errMsg = data.error || '';
        } else if (import.meta.env.DEV && res.status === 404) {
          /* 本地 npm run dev 模拟写入 */
          const parentObj = replyToId ? comments.find((c) => c.id === replyToId) : null;
          created = {
            id: Date.now(),
            parent_id: parentObj ? parentObj.parent_id ?? parentObj.id : null,
            reply_to_name: parentObj?.parent_id ? parentObj.nickname : null,
            nickname,
            quote: replyToId ? null : attachedQuote || null,
            content,
            is_author: isAdmin ? 1 : 0,
            hidden: 0,
            created_at: new Date().toISOString(),
          };
          const saved = [...comments, created];
          localStorage.setItem(devCommentsKey, JSON.stringify(saved));
        } else {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          errMsg = data.error || '';
        }

        if (!created) {
          setError(errMsg || '未能成功发布，请稍后重试。');
          return;
        }

        if (!isAdmin) {
          try {
            localStorage.setItem(READER_STORAGE_KEY, JSON.stringify({ nickname, email }));
          } catch {}
        }

        comments = [...comments, created];
        contentInput.value = '';
        contentTouched = false;
        setAttachedQuote('');
        syncGrowFallback();
        dockComposerHome();
        renderComments();

        if (statusEl) {
          statusEl.textContent = '记录已发布';
          window.setTimeout(() => {
            statusEl.textContent = '';
          }, 2200);
        }

        const newDom = listEl?.querySelector<HTMLElement>(`[data-comment-id="${created.id}"]`);
        newDom?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch {
        setError('网络暂时不可达，请检查连接后重试。');
      } finally {
        submitting = false;
        submitBtn.disabled = false;
        submitBtn.textContent = origText;
      }
    },
    { signal }
  );
}
