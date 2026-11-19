/**
 * Cloudflare Pages Function — `/api/lab`
 *
 * 基于 Cloudflare D1 (`LOWTEMP_DB`) 提供单篇匿名去重阅读人数统计：
 * `post_reads` 表主键去重，零 Cookie、不存原始 IP。
 */

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run(): Promise<{ success: boolean; meta?: { changes?: number; last_row_id?: number } }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface Env {
  /** Cloudflare D1 数据库绑定（变量名：LOWTEMP_DB） */
  LOWTEMP_DB?: D1Database;
  /** 可选：匿名去重哈希盐值 */
  HASH_SALT?: string;
}

interface PagesContext {
  request: Request;
  env: Env;
}

const ARCHIVE_ID_RE = /^(LTN|LAB)-\d{3,4}$/i;
const BOT_UA_RE =
  /bot|spider|crawler|slurp|headless|lighthouse|pagespeed|curl|wget|python|go-http|insomnia|postman|facebookexternalhit|twitterbot|discordbot|telegrambot|slackbot|Applebot|bingpreview/i;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

let schemaInitializedForDb: WeakSet<D1Database> | undefined;

async function ensureSchema(db: D1Database): Promise<void> {
  if (!schemaInitializedForDb) schemaInitializedForDb = new WeakSet();
  if (schemaInitializedForDb.has(db)) return;

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS post_reads (
        archive_id TEXT NOT NULL,
        visitor_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (archive_id, visitor_hash)
      )`
    )
    .run();

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

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function getClientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    '0.0.0.0'
  );
}

function isSameOrigin(req: Request): boolean {
  const reqOrigin = new URL(requestOriginUrl(req));
  const origin = req.headers.get('origin');
  if (origin) return origin === reqOrigin.origin;
  const referer = req.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).origin === reqOrigin.origin;
    } catch {
      return false;
    }
  }
  return false;
}

function requestOriginUrl(req: Request): string {
  return req.url;
}

/* ---------- GET：读取单篇阅读人数 ---------- */
export async function onRequestGet(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const id = normalizeId(url.searchParams.get('id'));
  if (!id) {
    return json({ ok: false, error: 'Invalid archive id' }, 400);
  }

  const db = env.LOWTEMP_DB;
  if (!db) {
    return json({ ok: true, id, enabled: false, readers: null });
  }

  await ensureSchema(db);

  const countRow = await db
    .prepare('SELECT COUNT(*) AS cnt FROM post_reads WHERE archive_id = ?')
    .bind(id)
    .first<{ cnt: number }>();

  return json({
    ok: true,
    id,
    enabled: true,
    readers: Number(countRow?.cnt ?? 0),
  });
}

/* ---------- POST：匿名去重阅读人数计入 ---------- */
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

  if (body.action !== 'read') {
    return json({ ok: false, error: 'Unsupported action' }, 400);
  }

  const db = env.LOWTEMP_DB;
  if (!db) {
    return json({ ok: false, enabled: false, error: '数据库 LOWTEMP_DB 尚未绑定' }, 503);
  }

  const id = normalizeId(body.id);
  if (!id) {
    return json({ ok: false, error: 'Invalid archive id' }, 400);
  }

  await ensureSchema(db);

  const salt = env.HASH_SALT || 'lowtemp-notes-v1';
  const ip = getClientIp(request);
  const ua = (request.headers.get('user-agent') || '').slice(0, 240);

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
