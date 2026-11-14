import type {
  Dispose,
  Envelope,
  Json,
  MainContext,
  PluginSetup,
  RequestPayload,
  ResponseData,
} from '@featherlog/contracts';
import type {
  LowtempAddInput,
  LowtempDay,
  LowtempDayDigest,
  LowtempEntry,
  LowtempErrorCode,
  LowtempPushResult,
  LowtempRequests,
  LowtempStatus,
  LowtempUpdatePatch,
} from '../contracts';
import { entrySignature, parseLogMarkdown, serializeLogMarkdown } from './markdown';

export interface LowtempBridge {
  checkRepo(repoPath: string): Promise<boolean>;
  listLogDates(repoPath: string): Promise<string[]>;
  readLogFile(repoPath: string, date: string): Promise<string | null>;
  writeLogFile(repoPath: string, date: string, content: string): Promise<void>;
  pushLogs(repoPath: string, dates: string[]): Promise<{ pushed: boolean; commitMessage: string | null }>;
}

interface SyncMeta {
  lastSyncedAt: string | null;
  lastPushedAt: string | null;
  lastAutoPushDate: string | null;
  lastError: string | null;
  dirtyDates: string[];
}

interface Config {
  repoPath: string;
  autoSync: boolean;
  dailyPush: boolean;
  pushHour: number;
}

const DAY_PREFIX = 'day:';
const META_KEY = 'meta:sync';
const CATCHUP_DELAY_MS = 15_000;
const RETRY_DELAY_MS = 15 * 60_000;

/**
 * In-memory bridge used when running in the browser playground or unit tests
 * that do not supply a Node filesystem / git implementation.
 */
export function createMemoryBridge(initialFiles: Record<string, string> = {}): LowtempBridge {
  const files = new Map<string, string>(Object.entries(initialFiles));
  return {
    async checkRepo(repoPath) {
      return repoPath.trim().length > 0;
    },
    async listLogDates() {
      return [...files.keys()].sort();
    },
    async readLogFile(_repoPath, date) {
      return files.get(date) ?? null;
    },
    async writeLogFile(_repoPath, date, content) {
      files.set(date, content);
    },
    async pushLogs(_repoPath, dates) {
      if (files.size === 0 && dates.length === 0) return { pushed: false, commitMessage: null };
      const label = dates.length === 1 ? `log: ${dates[0]}` : dates.length > 1 ? `log: ${dates[0]}..${dates.at(-1)}` : 'log: sync timeline';
      return { pushed: true, commitMessage: label };
    },
  };
}

function fail(message: string, code: LowtempErrorCode = 'lowtemp/invalid-input'): never {
  throw Object.assign(new Error(message), { code });
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected an object');
  return value as Record<string, unknown>;
}

function asIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) fail('Expected a nonempty id');
  return value;
}

function parseDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail('Expected date in YYYY-MM-DD format');
  }
  const [y, m, d] = value.split('-').map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d!));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() + 1 !== m || utc.getUTCDate() !== d) {
    fail('Invalid calendar date');
  }
  return value;
}

function parseTime(value: unknown): string {
  if (typeof value !== 'string') fail('Expected time in HH:MM format');
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) fail('Expected time in HH:MM format');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    fail('Time out of range');
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeText(value: unknown): string {
  if (typeof value !== 'string') fail('Expected timeline text string');
  const clean = value.replace(/\r?\n/g, ' ').trim();
  if (!clean || clean.length > 1000) fail('Timeline entry text must be 1 to 1000 characters');
  return clean;
}

function normalizeKind(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') fail('Expected facet tag string or null');
  const clean = value.trim();
  if (!clean) return null;
  if (/[\r\n[\]]/.test(clean) || clean.length > 24) {
    fail('Facet tag must be at most 24 chars without brackets or line breaks');
  }
  return clean;
}

function normalizeSummary(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') fail('Expected summary string or null');
  const clean = value.replace(/\r?\n/g, ' ').trim();
  if (!clean) return null;
  if (clean.length > 200) fail('Summary must be at most 200 characters');
  return clean;
}

function parseIso(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    fail('Expected an ISO timestamp');
  }
  if (!Number.isFinite(Date.parse(value))) fail('Invalid ISO timestamp');
  return value;
}

function formatLocalDate(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatLocalTime(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function sortEntries(entries: LowtempEntry[]): LowtempEntry[] {
  return [...entries].sort(
    (a, b) => a.time.localeCompare(b.time) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

function validateEntry(value: unknown, expectedDate: string): LowtempEntry {
  const raw = asObject(value);
  const id = asIdentifier(raw.id);
  const date = parseDate(raw.date);
  if (date !== expectedDate) fail('Stored entry date does not match day key');
  const time = parseTime(raw.time);
  const text = normalizeText(raw.text);
  const kind = normalizeKind(raw.kind);
  if (typeof raw.milestone !== 'boolean') fail('Expected boolean milestone');
  const createdAt = parseIso(raw.createdAt);
  const updatedAt = parseIso(raw.updatedAt);
  return { id, date, time, text, kind, milestone: raw.milestone, createdAt, updatedAt };
}

function validateStoredDay(value: unknown, key: string): LowtempDay {
  const record = asObject(value);
  if (record.schemaVersion !== 1) fail('Unsupported lowtemp day schemaVersion');
  const rawDay = asObject(record.day);
  const date = parseDate(rawDay.date);
  if (key !== `${DAY_PREFIX}${date}`) fail('Stored day date does not match storage key');
  const summary = rawDay.summary === null ? null : normalizeSummary(rawDay.summary);
  if (!Array.isArray(rawDay.entries)) fail('Expected entries array');
  const entries = sortEntries(rawDay.entries.map((entry) => validateEntry(entry, date)));
  const updatedAt = parseIso(rawDay.updatedAt);
  return { date, summary, entries, updatedAt };
}

function validateStoredMeta(value: unknown): SyncMeta {
  const record = asObject(value);
  if (record.schemaVersion !== 1) fail('Unsupported lowtemp meta schemaVersion');
  const rawMeta = asObject(record.meta);
  const lastSyncedAt = rawMeta.lastSyncedAt === null ? null : parseIso(rawMeta.lastSyncedAt);
  const lastPushedAt = rawMeta.lastPushedAt === null ? null : parseIso(rawMeta.lastPushedAt);
  const lastAutoPushDate = rawMeta.lastAutoPushDate === null ? null : parseDate(rawMeta.lastAutoPushDate);
  const lastError =
    rawMeta.lastError === null
      ? null
      : typeof rawMeta.lastError === 'string'
        ? rawMeta.lastError
        : fail('Expected string or null lastError');
  if (!Array.isArray(rawMeta.dirtyDates)) fail('Expected dirtyDates array');
  const dirtyDates = [...new Set(rawMeta.dirtyDates.map(parseDate))].sort();
  return { lastSyncedAt, lastPushedAt, lastAutoPushDate, lastError, dirtyDates };
}

function toDigest(day: LowtempDay, dirty: boolean): LowtempDayDigest {
  const milestoneCount = day.entries.filter((entry) => entry.milestone).length;
  const first = day.entries[0] ?? null;
  const last = day.entries.at(-1) ?? null;
  return {
    date: day.date,
    summary: day.summary,
    preview: day.summary ?? first?.text ?? null,
    count: day.entries.length,
    milestoneCount,
    firstTime: first?.time ?? null,
    lastTime: last?.time ?? null,
    dirty,
  };
}

function emptyDay(date: string, updatedAt: string): LowtempDay {
  return { date, summary: null, entries: [], updatedAt };
}

export function createSetup(bridge: LowtempBridge = createMemoryBridge()): PluginSetup<MainContext> {
  return async function setup(ctx: MainContext): Promise<void> {
    let disposed = false;
    let tail = Promise.resolve();
    let repoReady = false;
    let cancelSchedule: Dispose = () => {};
    let scheduledTargetMs = Infinity;

    const guard = () => {
      if (disposed) fail('Lowtemp plugin is disposed');
    };
    const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
      const job = tail.then(() => {
        guard();
        return work();
      });
      tail = job.then(
        () => {},
        () => {},
      );
      return job;
    };

    const readConfig = (): Config => {
      const repoRaw = ctx.settings.get<string>('repoPath');
      const autoRaw = ctx.settings.get<boolean>('autoSync');
      const dailyRaw = ctx.settings.get<boolean>('dailyPush');
      const hourRaw = ctx.settings.get<number>('pushHour');
      return {
        repoPath: typeof repoRaw === 'string' ? repoRaw.trim() : '',
        autoSync: autoRaw === undefined ? true : autoRaw === true,
        dailyPush: dailyRaw === undefined ? true : dailyRaw === true,
        pushHour:
          typeof hourRaw === 'number' && Number.isInteger(hourRaw) && hourRaw >= 0 && hourRaw <= 23 ? hourRaw : 22,
      };
    };

    const days = new Map<string, LowtempDay>();
    let meta: SyncMeta = {
      lastSyncedAt: null,
      lastPushedAt: null,
      lastAutoPushDate: null,
      lastError: null,
      dirtyDates: [],
    };

    // Strict startup validation: fail cleanly without overwriting damaged storage.
    const keys = await ctx.storage.keys();
    guard();
    if (keys.includes(META_KEY)) {
      const rawMeta = await ctx.storage.get(META_KEY);
      guard();
      if (rawMeta !== undefined) meta = validateStoredMeta(rawMeta);
    }

    const dayKeys = keys.filter((key) => key.startsWith(DAY_PREFIX));
    for (let offset = 0; offset < dayKeys.length; offset += 16) {
      const chunk = dayKeys.slice(offset, offset + 16);
      const records = await Promise.all(chunk.map(async (key) => ({ key, value: await ctx.storage.get(key) })));
      guard();
      for (const { key, value } of records) {
        if (value === undefined) continue;
        const parsed = validateStoredDay(value, key);
        days.set(parsed.date, parsed);
      }
    }

    const buildStatus = (cfg = readConfig()): LowtempStatus => ({
      repoPath: cfg.repoPath,
      repoReady,
      autoSync: cfg.autoSync,
      dailyPush: cfg.dailyPush,
      pushHour: cfg.pushHour,
      lastSyncedAt: meta.lastSyncedAt,
      lastPushedAt: meta.lastPushedAt,
      lastAutoPushDate: meta.lastAutoPushDate,
      lastError: meta.lastError,
      dirtyDates: [...meta.dirtyDates],
    });

    const listDigests = (): LowtempDayDigest[] => {
      const dirty = new Set(meta.dirtyDates);
      return [...days.values()]
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((day) => toDigest(day, dirty.has(day.date)));
    };

    const saveDay = async (day: LowtempDay) => {
      guard();
      await ctx.storage.set(`${DAY_PREFIX}${day.date}`, { schemaVersion: 1, day } as unknown as Json);
      days.set(day.date, day);
    };

    const saveMeta = async (next: SyncMeta) => {
      guard();
      const sorted: SyncMeta = { ...next, dirtyDates: [...new Set(next.dirtyDates)].sort() };
      await ctx.storage.set(META_KEY, { schemaVersion: 1, meta: sorted } as unknown as Json);
      meta = sorted;
    };

    const emitDayChanged = (day: LowtempDay, causedBy?: string) => {
      if (!disposed) {
        ctx.bus.emit('lowtemp/day-changed', { day, status: buildStatus() }, causedBy ? { causedBy } : undefined);
      }
    };

    const emitStatusChanged = (causedBy?: string) => {
      if (!disposed) {
        ctx.bus.emit('lowtemp/status-changed', { status: buildStatus() }, causedBy ? { causedBy } : undefined);
      }
    };

    const notify = (title: string, body: string, variant: 'success' | 'info' | 'warning' = 'info') => {
      if (disposed) return;
      void ctx.bus
        .request('shell/notify', { title, body, icon: 'clock', variant, durationMs: 4500 })
        .catch(() => {});
    };

    const refreshRepoStatus = async (cfg = readConfig()): Promise<boolean> => {
      if (!cfg.repoPath) {
        repoReady = false;
        return false;
      }
      try {
        repoReady = await bridge.checkRepo(cfg.repoPath);
      } catch {
        repoReady = false;
      }
      return repoReady;
    };

    const mergeDiskForDate = async (
      cfg: Config,
      date: string,
    ): Promise<{ day: LowtempDay; preserved: { extraFrontmatter: string[]; extraBody: string[] } }> => {
      const existing = days.get(date);
      const nowIso = new Date(ctx.clock.now()).toISOString();
      if (!cfg.repoPath || !repoReady) {
        return {
          day: existing ?? emptyDay(date, nowIso),
          preserved: { extraFrontmatter: [], extraBody: [] },
        };
      }

      const raw = await bridge.readLogFile(cfg.repoPath, date).catch(() => null);
      guard();
      if (raw === null) {
        return {
          day: existing ?? emptyDay(date, nowIso),
          preserved: { extraFrontmatter: [], extraBody: [] },
        };
      }

      const parsed = parseLogMarkdown(raw);
      const preserved = { extraFrontmatter: parsed.extraFrontmatter, extraBody: parsed.extraBody };

      // Keep legacy prose essays untouched unless entries already exist in Featherlog.
      if (parsed.isProseOnly && !existing) {
        return { day: emptyDay(date, nowIso), preserved };
      }

      // When local unsynced changes exist (autoSync off), avoid resurrecting entries deleted locally.
      if (meta.dirtyDates.includes(date) && existing) {
        return { day: existing, preserved };
      }

      const base = existing ?? emptyDay(date, nowIso);
      const known = new Set(base.entries.map(entrySignature));
      const added: LowtempEntry[] = [];
      for (const bullet of parsed.bullets) {
        const sig = entrySignature(bullet);
        if (known.has(sig)) continue;
        known.add(sig);
        added.push({
          id: globalThis.crypto.randomUUID(),
          date,
          time: bullet.time,
          text: bullet.text,
          kind: bullet.kind,
          milestone: bullet.milestone,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }

      const adoptedSummary = base.summary === null && parsed.summary !== null ? parsed.summary : base.summary;
      if (added.length === 0 && adoptedSummary === base.summary) {
        return { day: base, preserved };
      }

      const merged: LowtempDay = {
        date,
        summary: adoptedSummary,
        entries: sortEntries([...base.entries, ...added]),
        updatedAt: nowIso,
      };
      await saveDay(merged);
      return { day: merged, preserved };
    };

    const writeDateToDisk = async (
      cfg: Config,
      date: string,
      preserved?: { extraFrontmatter: string[]; extraBody: string[] },
    ): Promise<void> => {
      const target = days.get(date);
      if (!target) return;
      const content = serializeLogMarkdown(target, preserved);
      await bridge.writeLogFile(cfg.repoPath, date, content);
      guard();
    };

    const markDirtyAndMaybeSync = async (
      cfg: Config,
      date: string,
      preserved: { extraFrontmatter: string[]; extraBody: string[] },
      throwOnSyncError: boolean,
    ): Promise<void> => {
      const nextDirty = meta.dirtyDates.includes(date) ? meta.dirtyDates : [...meta.dirtyDates, date];
      await saveMeta({ ...meta, dirtyDates: nextDirty });

      if (!cfg.autoSync || !cfg.repoPath || !repoReady) return;
      try {
        await writeDateToDisk(cfg, date, preserved);
        await saveMeta({
          ...meta,
          lastSyncedAt: new Date(ctx.clock.now()).toISOString(),
          lastError: null,
          dirtyDates: meta.dirtyDates.filter((d) => d !== date),
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        ctx.log.warn('Failed to write LowTemp log file', { date, cause });
        await saveMeta({ ...meta, lastError: message });
        if (throwOnSyncError) fail(message, 'lowtemp/sync-failed');
      }
    };

    const syncAll = async (targetDate?: string): Promise<string[]> => {
      const cfg = readConfig();
      const ready = await refreshRepoStatus(cfg);
      if (!cfg.repoPath || !ready) {
        fail('LowTemp 仓库路径未配置或不可用', 'lowtemp/repo-unavailable');
      }

      const diskDates = await bridge.listLogDates(cfg.repoPath);
      guard();
      const datesToCheck = new Set(diskDates);
      if (targetDate) datesToCheck.add(targetDate);

      const preservedByDate = new Map<string, { extraFrontmatter: string[]; extraBody: string[] }>();
      for (const date of [...datesToCheck].sort()) {
        const merged = await mergeDiskForDate(cfg, date);
        preservedByDate.set(date, merged.preserved);
      }

      const datesToWrite = new Set(meta.dirtyDates);
      if (targetDate && days.has(targetDate)) datesToWrite.add(targetDate);

      const syncedDates: string[] = [];
      for (const date of [...datesToWrite].sort()) {
        if (!days.has(date)) continue;
        try {
          await writeDateToDisk(cfg, date, preservedByDate.get(date));
          syncedDates.push(date);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          await saveMeta({ ...meta, lastError: message });
          fail(message, 'lowtemp/sync-failed');
        }
      }

      const nowIso = new Date(ctx.clock.now()).toISOString();
      await saveMeta({
        ...meta,
        lastSyncedAt: nowIso,
        lastError: null,
        dirtyDates: meta.dirtyDates.filter((d) => !syncedDates.includes(d)),
      });
      return syncedDates;
    };

    const pushInternal = async (isScheduled: boolean): Promise<LowtempPushResult> => {
      const cfg = readConfig();
      const ready = await refreshRepoStatus(cfg);
      if (!cfg.repoPath || !ready) {
        fail('LowTemp 仓库路径未配置或不可用', 'lowtemp/repo-unavailable');
      }

      const today = formatLocalDate(ctx.clock.now());
      const syncedDates = await syncAll(days.has(today) ? today : undefined);
      const pushDates = syncedDates.length ? syncedDates : days.has(today) ? [today] : [];

      let result: { pushed: boolean; commitMessage: string | null };
      try {
        result = await bridge.pushLogs(cfg.repoPath, pushDates);
        guard();
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        await saveMeta({ ...meta, lastError: message });
        emitStatusChanged();
        fail(message, 'lowtemp/push-failed');
      }

      const nowIso = new Date(ctx.clock.now()).toISOString();
      const nextMeta: SyncMeta = {
        ...meta,
        lastSyncedAt: nowIso,
        lastPushedAt: result.pushed ? nowIso : meta.lastPushedAt,
        lastAutoPushDate: isScheduled ? today : meta.lastAutoPushDate,
        lastError: null,
        dirtyDates: [],
      };
      await saveMeta(nextMeta);
      const status = buildStatus(cfg);
      emitStatusChanged();
      return {
        pushed: result.pushed,
        syncedDates,
        commitMessage: result.commitMessage,
        status,
      };
    };

    const scheduleNext = (delayOverrideMs?: number) => {
      cancelSchedule();
      cancelSchedule = () => {};
      scheduledTargetMs = Infinity;
      if (disposed) return;

      const cfg = readConfig();
      if (!cfg.dailyPush || !cfg.repoPath) return;

      const now = ctx.clock.now();
      const local = new Date(now);
      const todayDate = formatLocalDate(now);
      const todayTargetMs = new Date(
        local.getFullYear(),
        local.getMonth(),
        local.getDate(),
        cfg.pushHour,
        0,
        0,
        0,
      ).getTime();

      let targetMs: number;
      if (delayOverrideMs !== undefined) {
        targetMs = now + delayOverrideMs;
      } else if (now < todayTargetMs) {
        targetMs = todayTargetMs;
      } else if (meta.lastAutoPushDate !== todayDate) {
        // Delay slightly after startup/wake so Electron startup and smoke tests settle first.
        targetMs = now + CATCHUP_DELAY_MS;
      } else {
        targetMs = new Date(
          local.getFullYear(),
          local.getMonth(),
          local.getDate() + 1,
          cfg.pushHour,
          0,
          0,
          0,
        ).getTime();
      }

      const waitMs = Math.max(100, targetMs - now);
      scheduledTargetMs = targetMs;
      cancelSchedule = ctx.clock.setTimeout(() => {
        scheduledTargetMs = Infinity;
        void enqueue(async () => {
          const latest = readConfig();
          const currentToday = formatLocalDate(ctx.clock.now());
          if (!latest.dailyPush || !latest.repoPath || meta.lastAutoPushDate === currentToday) {
            scheduleNext();
            return;
          }
          try {
            const outcome = await pushInternal(true);
            if (outcome.pushed) {
              notify('低温笔记已自动推送上线', `${currentToday} 的时间线记录已同步至线上博客。`, 'success');
            }
            scheduleNext();
          } catch (cause) {
            const message = cause instanceof Error ? cause.message : String(cause);
            ctx.log.warn('Scheduled LowTemp push failed', cause);
            notify('低温笔记定时推送失败', `${message}，稍后将自动重试。`, 'warning');
            scheduleNext(RETRY_DELAY_MS);
          }
        }).catch(() => {});
      }, waitMs);
    };

    // Detect computer sleep/wake where OS clocks jumped past the scheduled trigger time.
    const ensureScheduleCurrent = () => {
      const cfg = readConfig();
      if (!cfg.dailyPush || !cfg.repoPath) return;
      if (ctx.clock.now() >= scheduledTargetMs) {
        scheduleNext(CATCHUP_DELAY_MS);
      }
    };

    ctx.onDispose(() => {
      disposed = true;
      cancelSchedule();
      cancelSchedule = () => {};
    });

    const offSettings = ctx.settings.onChange((key) => {
      if (disposed) return;
      if (key === 'repoPath') {
        void enqueue(async () => {
          await refreshRepoStatus();
          scheduleNext();
          emitStatusChanged();
        }).catch(() => {});
      } else if (key === 'dailyPush' || key === 'pushHour' || key === 'autoSync') {
        scheduleNext();
        emitStatusChanged();
      }
    });
    ctx.onDispose(offSettings);

    const register = <K extends keyof LowtempRequests>(
      type: K,
      handler: (payload: RequestPayload<K>, envelope: Envelope) => Promise<ResponseData<K>>,
    ) =>
      ctx.bus.handle(type, (payload, envelope) =>
        enqueue(() => {
          asObject(payload);
          ensureScheduleCurrent();
          return handler(payload, envelope);
        }),
      );

    register('lowtemp/state', async (payload) => {
      const cfg = readConfig();
      await refreshRepoStatus(cfg);
      const today = formatLocalDate(ctx.clock.now());
      const date = payload.date === undefined ? today : parseDate(payload.date);
      const limit = payload.limit === undefined ? 60 : payload.limit;
      if (!Number.isSafeInteger(limit) || limit < 1) fail('Limit must be a positive integer');
      const { day } = await mergeDiskForDate(cfg, date);
      return {
        day,
        days: listDigests().slice(0, limit),
        status: buildStatus(cfg),
      };
    });

    register('lowtemp/day', async (payload) => {
      const cfg = readConfig();
      await refreshRepoStatus(cfg);
      const date = parseDate(payload.date);
      const { day } = await mergeDiskForDate(cfg, date);
      return { day, status: buildStatus(cfg) };
    });

    register('lowtemp/add', async (payload, envelope) => {
      const input = asObject(payload.input) as unknown as LowtempAddInput & Record<string, unknown>;
      const now = ctx.clock.now();
      const nowIso = new Date(now).toISOString();
      const date = input.date === undefined ? formatLocalDate(now) : parseDate(input.date);
      const time = input.time === undefined ? formatLocalTime(now) : parseTime(input.time);
      const text = normalizeText(input.text);
      const kind = normalizeKind(input.kind);
      const milestone = input.milestone === undefined ? false : Boolean(input.milestone);
      if (input.milestone !== undefined && typeof input.milestone !== 'boolean') {
        fail('Expected boolean milestone');
      }

      const cfg = readConfig();
      await refreshRepoStatus(cfg);
      const { day: current, preserved } = await mergeDiskForDate(cfg, date);
      const entry: LowtempEntry = {
        id: globalThis.crypto.randomUUID(),
        date,
        time,
        text,
        kind,
        milestone,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      const updated: LowtempDay = {
        date,
        summary: current.summary,
        entries: sortEntries([...current.entries, entry]),
        updatedAt: nowIso,
      };
      await saveDay(updated);
      await markDirtyAndMaybeSync(cfg, date, preserved, false);
      emitDayChanged(updated, envelope.id);
      return { entry, day: updated, status: buildStatus(cfg) };
    });

    register('lowtemp/update', async (payload, envelope) => {
      const date = parseDate(payload.date);
      const id = asIdentifier(payload.id);
      const patch = asObject(payload.patch) as unknown as LowtempUpdatePatch & Record<string, unknown>;

      const cfg = readConfig();
      await refreshRepoStatus(cfg);
      const { day: current, preserved } = await mergeDiskForDate(cfg, date);
      const index = current.entries.findIndex((item) => item.id === id);
      if (index === -1) fail('Timeline entry not found', 'lowtemp/not-found');

      const existing = current.entries[index]!;
      const nextTime = patch.time === undefined ? existing.time : parseTime(patch.time);
      const nextText = patch.text === undefined ? existing.text : normalizeText(patch.text);
      const nextKind = patch.kind === undefined ? existing.kind : normalizeKind(patch.kind);
      if (patch.milestone !== undefined && typeof patch.milestone !== 'boolean') {
        fail('Expected boolean milestone');
      }
      const nextMilestone = patch.milestone === undefined ? existing.milestone : patch.milestone;

      if (
        nextTime === existing.time &&
        nextText === existing.text &&
        nextKind === existing.kind &&
        nextMilestone === existing.milestone
      ) {
        return { entry: existing, day: current, status: buildStatus(cfg) };
      }

      const nowIso = new Date(ctx.clock.now()).toISOString();
      const updatedEntry: LowtempEntry = {
        ...existing,
        time: nextTime,
        text: nextText,
        kind: nextKind,
        milestone: nextMilestone,
        updatedAt: nowIso,
      };
      const nextEntries = [...current.entries];
      nextEntries[index] = updatedEntry;
      const updatedDay: LowtempDay = {
        ...current,
        entries: sortEntries(nextEntries),
        updatedAt: nowIso,
      };
      await saveDay(updatedDay);
      await markDirtyAndMaybeSync(cfg, date, preserved, false);
      emitDayChanged(updatedDay, envelope.id);
      return { entry: updatedEntry, day: updatedDay, status: buildStatus(cfg) };
    });

    register('lowtemp/delete', async (payload, envelope) => {
      const date = parseDate(payload.date);
      const id = asIdentifier(payload.id);

      const cfg = readConfig();
      await refreshRepoStatus(cfg);
      const { day: current, preserved } = await mergeDiskForDate(cfg, date);
      const index = current.entries.findIndex((item) => item.id === id);
      if (index === -1) fail('Timeline entry not found', 'lowtemp/not-found');

      const nowIso = new Date(ctx.clock.now()).toISOString();
      const nextEntries = current.entries.filter((item) => item.id !== id);
      const updatedDay: LowtempDay = {
        ...current,
        entries: nextEntries,
        updatedAt: nowIso,
      };
      await saveDay(updatedDay);
      await markDirtyAndMaybeSync(cfg, date, preserved, false);
      emitDayChanged(updatedDay, envelope.id);
      return { day: updatedDay, status: buildStatus(cfg) };
    });

    register('lowtemp/set-summary', async (payload, envelope) => {
      const date = parseDate(payload.date);
      const summary = normalizeSummary(payload.summary);

      const cfg = readConfig();
      await refreshRepoStatus(cfg);
      const { day: current, preserved } = await mergeDiskForDate(cfg, date);
      if (current.summary === summary && days.has(date)) {
        return { day: current, status: buildStatus(cfg) };
      }

      const nowIso = new Date(ctx.clock.now()).toISOString();
      const updatedDay: LowtempDay = {
        ...current,
        summary,
        updatedAt: nowIso,
      };
      await saveDay(updatedDay);
      await markDirtyAndMaybeSync(cfg, date, preserved, false);
      emitDayChanged(updatedDay, envelope.id);
      return { day: updatedDay, status: buildStatus(cfg) };
    });

    register('lowtemp/sync', async (payload, envelope) => {
      const date = payload.date === undefined ? formatLocalDate(ctx.clock.now()) : parseDate(payload.date);
      const syncedDates = await syncAll(date);
      const cfg = readConfig();
      const day = days.get(date) ?? emptyDay(date, new Date(ctx.clock.now()).toISOString());
      emitStatusChanged(envelope.id);
      return {
        syncedDates,
        day,
        days: listDigests().slice(0, 60),
        status: buildStatus(cfg),
      };
    });

    register('lowtemp/push', async () => {
      const outcome = await pushInternal(false);
      notify(
        outcome.pushed ? '低温笔记已推送上线' : '无需重复推送',
        outcome.pushed
          ? `${outcome.commitMessage ?? '时间线更新'} 已推送至远端仓库。`
          : '日志目录与远端仓库均已是最新状态。',
        outcome.pushed ? 'success' : 'info',
      );
      return outcome;
    });

    let readyHandled = false;
    ctx.bus.on('kernel/ready', () => {
      if (readyHandled) return;
      readyHandled = true;
      void enqueue(async () => {
        const cfg = readConfig();
        const ready = await refreshRepoStatus(cfg);
        if (ready && cfg.repoPath) {
          try {
            await syncAll();
          } catch (cause) {
            ctx.log.warn('Initial LowTemp disk sync skipped/failed', cause);
          }
        }
        scheduleNext();
        emitStatusChanged();
      }).catch(() => {});
    });
  };
}

export const setup = createSetup();
