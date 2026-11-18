/**
 * Cloudflare Pages Function — `/api/lab`
 *
 * 基于 Cloudflare D1 (`LOWTEMP_DB`) 提供低温笔记的两项同域能力：
 * 1. 单篇匿名去重阅读人数（`post_reads` 表主键去重，零 Cookie、不存原始 IP）
 * 2. 文末无框「研讨与反例」原生评论系统：
 *    - 免登录发言（称呼 + 选填保密邮箱 + 可选划词引文 + 嵌套回复）
 *    - 作者口令验证（`ADMIN_TOKEN`）：防他人冒用作者名，支持页内直接以「● 作者」身份回复、隐藏、恢复或删除
 */

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }>;
  run(): Promise<{ success: boolean; meta?: { changes?: number; last_row_id?: number } }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(
    statements: D1PreparedStatement[]
  ): Promise<Array<{ results?: T[]; success: boolean; meta?: Record<string, unknown> }>>;
}

interface Env {
  /** Cloudflare D1 数据库绑定（变量名：LOWTEMP_DB） */
  LOWTEMP_DB?: D1Database;
  /** 作者管理口令（用于页内作者身份发言与隐藏/删除管理） */
  ADMIN_TOKEN?: string;
  /** 可选：匿名去重哈希盐值 */
  HASH_SALT?: string;
  /** 可选：新评论通知 Webhook（自动适配 Bark / 飞书 / 企微 / 钉钉 / Discord / Slack） */
  WEBHOOK_URL?: string;
}

interface PagesContext {
  request: Request;
  env: Env;
  waitUntil(promise: Promise<unknown>): void;
}

export interface CommentRow {
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

const ARCHIVE_ID_RE = /^(LTN|LAB)-\d{3,4}$/i;
const BOT_UA_RE =
  /bot|spider|crawler|slurp|headless|lighthouse|pagespeed|curl|wget|python|go-http|insomnia|postman|facebookexternalhit|twitterbot|discordbot|telegrambot|slackbot|Applebot|bingpreview/i;

/* 禁止未持口令的访客冒用的作者称呼 */
const RESERVED_AUTHOR_NAMES = new Set([
  '暮羽中',
  '作者',
  '博主',
  '站长',
  'muyuzhong',
  'admin',
  'lowtemp',
]);

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

let schemaInitializedForDb: WeakSet<D1Database> | undefined;

async function ensureSchema(db: D1Database): Promise<void> {
  if (!schemaInitializedForDb) schemaInitializedForDb = new WeakSet();
  if (schemaInitializedForDb.has(db)) return;

  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS post_reads (
        archive_id TEXT NOT NULL,
        visitor_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (archive_id, visitor_hash)
      )`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        archive_id TEXT NOT NULL,
        parent_id INTEGER,
        reply_to_name TEXT,
        nickname TEXT NOT NULL,
        email TEXT,
        quote TEXT,
        content TEXT NOT NULL,
        is_author INTEGER NOT NULL DEFAULT 0,
        hidden INTEGER NOT NULL DEFAULT 0,
        ip_hash TEXT,
        created_at TEXT NOT NULL
      )`
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_comments_archive ON comments(archive_id, id)`
    ),
  ]);

  schemaInitializedForDb.add(db);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function normalizeId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toUpperCase();
  return ARCHIVE_ID_RE.test(trimmed) ? trimmed : null;
}

function clampText(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\r\n/g, '\n').trim().slice(0, maxLen);
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function checkAdmin(req: Request, env: Env, bodyToken?: unknown): boolean {
  const expected = env.ADMIN_TOKEN?.trim() || '';
  if (!expected) return false;
  const headerToken =
    req.headers.get('x-admin-token')?.trim() ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ||
    '';
  const candidate = headerToken || (typeof bodyToken === 'string' ? bodyToken.trim() : '');
  return timingSafeEqualStr(candidate, expected);
}

function getClientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    '0.0.0.0'
  );
}

function isSameOrigin(req: Request): boolean {
  const reqOrigin = new URL(req.url).origin;
  const origin = req.headers.get('origin');
  if (origin) return origin === reqOrigin;
  const referer = req.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).origin === reqOrigin;
    } catch {
      return false;
    }
  }
  return false;
}

async function notifyWebhook(
  env: Env,
  payload: { archiveId: string; title: string; url: string; nickname: string; quote: string; content: string }
): Promise<void> {
  const hook = env.WEBHOOK_URL?.trim();
  if (!hook) return;
  const heading = `[${payload.archiveId}] ${payload.nickname} 发表了研讨`;
  const text = [
    `${heading} · ${payload.title}`,
    payload.url ? `链接：${payload.url}` : '',
    payload.quote ? `> 「${payload.quote}」` : '',
    payload.content,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    if (hook.includes('api.day.app')) {
      await fetch(hook, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ title: heading, body: payload.content.slice(0, 200), group: 'LowTemp', url: payload.url || undefined }),
      });
    } else if (hook.includes('open.feishu.cn') || hook.includes('open.larksuite.com')) {
      await fetch(hook, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ msg_type: 'text', content: { text } }),
      });
    } else if (hook.includes('qyapi.weixin.qq.com') || hook.includes('oapi.dingtalk.com')) {
      await fetch(hook, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ msgtype: 'markdown', markdown: { title: heading, content: text, text } }),
      });
    } else if (hook.includes('discord.com/api/webhooks')) {
      await fetch(hook, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ content: text.slice(0, 1950) }),
      });
    } else if (hook.includes('hooks.slack.com')) {
      await fetch(hook, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ text }),
      });
    } else {
      await fetch(hook, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ event: 'lowtemp.comment', ...payload }),
      });
    }
  } catch {
    /* 通知失败不影响主流程 */
  }
}

/* ---------- GET：读取单篇阅读人数 + 研讨评论列表 ---------- */
export async function onRequestGet(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const id = normalizeId(url.searchParams.get('id'));
  if (!id) {
    return json({ ok: false, error: 'Invalid archive id' }, 400);
  }

  const isAdmin = checkAdmin(request, env);
  const db = env.LOWTEMP_DB;
  if (!db) {
    return json({ ok: true, id, enabled: false, isAdmin, readers: null, comments: [] });
  }

  await ensureSchema(db);

  const countRow = await db
    .prepare('SELECT COUNT(*) AS cnt FROM post_reads WHERE archive_id = ?')
    .bind(id)
    .first<{ cnt: number }>();

  const commentsQuery = isAdmin
    ? db
        .prepare(
          `SELECT id, parent_id, reply_to_name, nickname, quote, content, is_author, hidden, created_at
           FROM comments WHERE archive_id = ? ORDER BY id ASC`
        )
        .bind(id)
    : db
        .prepare(
          `SELECT id, parent_id, reply_to_name, nickname, quote, content, is_author, 0 AS hidden, created_at
           FROM comments WHERE archive_id = ? AND hidden = 0 ORDER BY id ASC`
        )
        .bind(id);

  const { results } = await commentsQuery.all<CommentRow>();
  return json({
    ok: true,
    id,
    enabled: true,
    isAdmin,
    readers: Number(countRow?.cnt ?? 0),
    comments: results ?? [],
  });
}

/* ---------- POST：阅读计数 / 发表评论 / 作者口令验证与管理 ---------- */
export async function onRequestPost(context: PagesContext): Promise<Response> {
  const { request, env } = context;

  if (!isSameOrigin(request)) {
    return json({ ok: false, error: 'Forbidden origin' }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: 'Invalid JSON payload' }, 400);
  }

  const action = body.action;

  /* 0. 验证作者口令 */
  if (action === 'verify_admin') {
    if (!env.ADMIN_TOKEN?.trim()) {
      return json({ ok: false, error: '服务端尚未设置 ADMIN_TOKEN 环境变量' }, 503);
    }
    const valid = checkAdmin(request, env, body.token);
    if (!valid) {
      return json({ ok: false, error: '作者口令不正确' }, 401);
    }
    return json({ ok: true, isAdmin: true });
  }

  const db = env.LOWTEMP_DB;
  if (!db) {
    return json({ ok: false, enabled: false, error: '数据库 LOWTEMP_DB 尚未绑定' }, 503);
  }

  await ensureSchema(db);

  const salt = env.HASH_SALT || 'lowtemp-notes-v1';
  const ip = getClientIp(request);
  const ua = (request.headers.get('user-agent') || '').slice(0, 240);

  /* 1. 匿名去重阅读人数计入 */
  if (action === 'read') {
    const id = normalizeId(body.id);
    if (!id) {
      return json({ ok: false, error: 'Invalid archive id' }, 400);
    }

    let counted = false;
    if (ua && !BOT_UA_RE.test(ua)) {
      const visitorHash = (await sha256Hex(`${salt}|read|${id}|${ip}|${ua}`)).slice(0, 28);
      const res = await db
        .prepare('INSERT OR IGNORE INTO post_reads (archive_id, visitor_hash, created_at) VALUES (?, ?, ?)')
        .bind(id, visitorHash, Date.now())
        .run();
      counted = Boolean(res.meta?.changes && res.meta.changes > 0);
    }

    const countRow = await db
      .prepare('SELECT COUNT(*) AS cnt FROM post_reads WHERE archive_id = ?')
      .bind(id)
      .first<{ cnt: number }>();

    return json({
      ok: true,
      id,
      enabled: true,
      counted,
      readers: Number(countRow?.cnt ?? 0),
    });
  }

  /* 2. 发表研讨评论或回复 */
  if (action === 'comment') {
    /* 蜜罐拦截机器人 */
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      return json({ ok: true });
    }

    const archiveId = normalizeId(body.id);
    if (!archiveId) {
      return json({ ok: false, error: '档案编号无效' }, 400);
    }

    const isAdmin = checkAdmin(request, env, body.adminToken);
    let nickname = clampText(body.nickname, 32);
    if (isAdmin && !nickname) nickname = '暮羽中';

    if (!nickname) {
      return json({ ok: false, error: '请填写一个称呼' }, 400);
    }

    if (!isAdmin && RESERVED_AUTHOR_NAMES.has(nickname.toLowerCase())) {
      return json(
        { ok: false, error: '该称呼保留给作者本人；如你是作者，请先点右上角「作者」输入口令' },
        403
      );
    }

    const content = clampText(body.content, 3000);
    if (content.length < 2) {
      return json({ ok: false, error: '讨论内容至少需要 2 个字' }, 400);
    }

    const email = clampText(body.email, 120);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, error: '邮箱格式看起来不太对（选填，也可留空）' }, 400);
    }

    const quote = clampText(body.quote, 600);
    const ipHash = (await sha256Hex(`${salt}|comment|${ip}`)).slice(0, 20);

    /* 非作者频控：5 分钟内同一来源最多 5 条 */
    if (!isAdmin) {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const recent = await db
        .prepare('SELECT COUNT(*) AS cnt FROM comments WHERE ip_hash = ? AND created_at > ?')
        .bind(ipHash, fiveMinAgo)
        .first<{ cnt: number }>();
      if (Number(recent?.cnt ?? 0) >= 5) {
        return json({ ok: false, error: '发言太频繁，请稍等几分钟再试' }, 429);
      }
    }

    /* 处理父评论（自动收敛为两层结构：顶层评论 + 子回复流） */
    let rootParentId: number | null = null;
    let replyToName: string | null = null;
    const rawParentId = typeof body.parentId === 'number' ? body.parentId : Number(body.parentId || 0);

    if (rawParentId > 0 && Number.isInteger(rawParentId)) {
      const parent = await db
        .prepare('SELECT id, parent_id, nickname FROM comments WHERE id = ? AND archive_id = ? AND hidden = 0')
        .bind(rawParentId, archiveId)
        .first<{ id: number; parent_id: number | null; nickname: string }>();
      if (!parent) {
        return json({ ok: false, error: '所回复的条目不存在或已被移除' }, 404);
      }
      rootParentId = parent.parent_id ?? parent.id;
      replyToName = parent.parent_id ? parent.nickname : null;
    }

    const createdAt = new Date().toISOString();
    const isAuthorInt = isAdmin ? 1 : 0;

    const insertRes = await db
      .prepare(
        `INSERT INTO comments
          (archive_id, parent_id, reply_to_name, nickname, email, quote, content, is_author, hidden, ip_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .bind(
        archiveId,
        rootParentId,
        replyToName,
        nickname,
        email || null,
        rootParentId ? null : quote || null,
        content,
        isAuthorInt,
        ipHash,
        createdAt
      )
      .run();

    const newId = Number(insertRes.meta?.last_row_id ?? 0);
    const created: CommentRow = {
      id: newId,
      parent_id: rootParentId,
      reply_to_name: replyToName,
      nickname,
      quote: rootParentId ? null : quote || null,
      content,
      is_author: isAuthorInt,
      hidden: 0,
      created_at: createdAt,
    };

    if (!isAdmin) {
      context.waitUntil(
        notifyWebhook(env, {
          archiveId,
          title: clampText(body.title, 160) || archiveId,
          url: clampText(body.url, 300),
          nickname,
          quote,
          content,
        })
      );
    }

    return json({ ok: true, comment: created });
  }

  /* 3. 作者页内管理（隐藏 / 恢复 / 彻底删除） */
  if (action === 'moderate') {
    if (!checkAdmin(request, env, body.adminToken)) {
      return json({ ok: false, error: '需要有效的作者口令' }, 401);
    }
    const commentId = typeof body.commentId === 'number' ? body.commentId : Number(body.commentId || 0);
    const op = body.op;
    if (!commentId || !Number.isInteger(commentId)) {
      return json({ ok: false, error: '评论 ID 无效' }, 400);
    }

    if (op === 'hide') {
      await db.prepare('UPDATE comments SET hidden = 1 WHERE id = ?').bind(commentId).run();
    } else if (op === 'restore') {
      await db.prepare('UPDATE comments SET hidden = 0 WHERE id = ?').bind(commentId).run();
    } else if (op === 'delete') {
      await db
        .prepare('DELETE FROM comments WHERE id = ? OR parent_id = ?')
        .bind(commentId, commentId)
        .run();
    } else {
      return json({ ok: false, error: '不支持的管理操作' }, 400);
    }

    return json({ ok: true, commentId, op });
  }

  return json({ ok: false, error: 'Unsupported action' }, 400);
}
