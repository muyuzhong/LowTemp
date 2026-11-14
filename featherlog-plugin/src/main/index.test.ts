import { describe, expect, it, vi } from 'vitest';
import { createKernel } from '@featherlog/kernel';
import type {
  Clock,
  Envelope,
  Json,
  PluginStorage,
  RequestPayload,
  ResponseData,
  ShellNotification,
} from '@featherlog/contracts';
import type { LowtempRequests } from '../contracts';
import { createMemoryBridge, createSetup, setup as defaultSetup, type LowtempBridge } from './index';
import { entrySignature, parseLogMarkdown, serializeLogMarkdown } from './markdown';

function localMs(year: number, month: number, day: number, hour: number, minute = 0, second = 0): number {
  return new Date(year, month - 1, day, hour, minute, second, 0).getTime();
}

async function flushMicrotasks(rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

interface FixtureOptions {
  startMs?: number;
  data?: Map<string, Json>;
  initialFiles?: Record<string, string>;
  bridge?: LowtempBridge;
  settings?: Record<string, Json | undefined>;
}

async function createFixture(options: FixtureOptions = {}) {
  let time = options.startMs ?? localMs(2026, 11, 13, 9, 30);
  const timers = new Map<() => void, number>();
  const clock: Clock = {
    now: () => time,
    setTimeout(callback, ms) {
      timers.set(callback, time + ms);
      return () => {
        timers.delete(callback);
      };
    },
  };

  const data = options.data ?? new Map<string, Json>();
  const storage: PluginStorage = {
    async get<T extends Json>(key: string) {
      return structuredClone(data.get(key)) as T | undefined;
    },
    set: vi.fn(async (key, value) => {
      data.set(key, structuredClone(value));
    }),
    delete: vi.fn(async (key) => {
      data.delete(key);
    }),
    keys: vi.fn(async () => [...data.keys()]),
  };

  const settingsState: Record<string, Json | undefined> = {
    repoPath: '/mock/lowtemp',
    autoSync: true,
    dailyPush: true,
    pushHour: 22,
    ...options.settings,
  };
  const settingListeners = new Set<(key: string, value: Json | undefined) => void>();

  const bridge = options.bridge ?? createMemoryBridge(options.initialFiles);
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const kernel = createKernel({
    development: true,
    clock,
    log,
    createServices: () => ({
      clock,
      log,
      storage,
      settings: {
        get: <T extends Json>(key: string) => structuredClone(settingsState[key]) as T | undefined,
        onChange: (listener) => {
          settingListeners.add(listener);
          return () => settingListeners.delete(listener);
        },
      },
      secrets: { get: async () => undefined, onChange: () => () => {} },
    }),
  });

  const shellBus = kernel.createBus('shell');
  const notifications: ShellNotification[] = [];
  shellBus.handle('shell/notify', (payload) => {
    notifications.push(payload);
    return null;
  });

  const user = kernel.createBus('quest');
  const messages: Envelope[] = [];
  kernel.observe((message) => messages.push(message));

  await kernel.load([
    {
      manifest: { id: 'lowtemp', name: '低温值班簿', version: '0.1.0' },
      setup: createSetup(bridge),
    },
  ]);
  await flushMicrotasks();

  const failed = messages.find((m) => m.type === 'kernel/plugin-failed');
  const request = <K extends keyof LowtempRequests>(type: K, payload: RequestPayload<K>) =>
    user.request(type, payload) as Promise<ResponseData<K>>;
  const events = () => messages.filter((m) => m.kind === 'event' && m.type.startsWith('lowtemp/'));

  const fireDueTimers = async () => {
    for (const [cb, at] of [...timers.entries()].sort((a, b) => a[1] - b[1])) {
      if (at <= time) {
        timers.delete(cb);
        cb();
      }
    }
    await flushMicrotasks(12);
  };

  return {
    kernel,
    user,
    request,
    messages,
    events,
    failed,
    storage,
    data,
    bridge,
    log,
    timers,
    notifications,
    setTime: (next: number) => {
      time = next;
    },
    advanceBy: async (ms: number) => {
      time += ms;
      await fireDueTimers();
    },
    changeSetting: async (key: string, value: Json | undefined) => {
      settingsState[key] = value;
      for (const listener of settingListeners) listener(key, value);
      await flushMicrotasks(8);
    },
    fireDueTimers,
  };
}

describe('markdown parser and serializer', () => {
  it('parses frontmatter, summary quotes, extra frontmatter, facets, milestones, and BOM', () => {
    const raw =
      '\uFEFF---\r\npublished: 2026-11-13\r\nsummary: "完成 \\"核心\\" 同步"\r\ntags:\r\n  - dev\r\n---\r\n\r\n- \r\n- * 9:05 [工程] 完成初版\r\n- 14:30 阅读论文\r\n- 25:99 [工程] 越界时间变成正文\r\n- 18:00\r\n\r\n补充散文段落。\r\n';
    const parsed = parseLogMarkdown(raw);
    expect(parsed.summary).toBe('完成 "核心" 同步');
    expect(parsed.extraFrontmatter).toEqual(['tags:', '  - dev']);
    expect(parsed.bullets).toEqual([
      { time: '09:05', kind: '工程', milestone: true, text: '完成初版' },
      { time: '14:30', kind: null, milestone: false, text: '阅读论文' },
    ]);
    expect(parsed.extraBody).toEqual(['- 25:99 [工程] 越界时间变成正文', '补充散文段落。']);
    expect(parsed.isProseOnly).toBe(false);

    const out = serializeLogMarkdown(
      {
        date: '2026-11-13',
        summary: parsed.summary,
        entries: parsed.bullets.map((b, i) => ({
          id: String(i),
          date: '2026-11-13',
          ...b,
          createdAt: '2026-11-13T01:00:00.000Z',
          updatedAt: '2026-11-13T01:00:00.000Z',
        })),
      },
      { extraFrontmatter: parsed.extraFrontmatter, extraBody: parsed.extraBody },
    );
    expect(out).toContain('published: 2026-11-13');
    expect(out).toContain('summary: "完成 \\"核心\\" 同步"');
    expect(out).toContain('- * 09:05 [工程] 完成初版');
    expect(out).toContain('- 14:30 阅读论文');
    expect(out).toContain('补充散文段落。');
  });

  it('handles single-quoted and unquoted summaries, prose-only detection, and signatures', () => {
    const single = parseLogMarkdown("---\nsummary: 'It''s fine'\n---\n- 08:00 测试\n");
    expect(single.summary).toBe("It's fine");

    const bare = parseLogMarkdown('---\nsummary: 简洁一句话\n---\n');
    expect(bare.summary).toBe('简洁一句话');

    const prose = parseLogMarkdown('---\npublished: 2026-08-11\n---\n\n今天只写了长文，没有时间线。\n');
    expect(prose.isProseOnly).toBe(true);

    expect(entrySignature({ time: '08:00', kind: null, milestone: false, text: '测试' })).not.toBe(
      entrySignature({ time: '08:00', kind: '工程', milestone: false, text: '测试' }),
    );
  });
});

describe('lowtemp CRUD and validation', () => {
  it('adds, sorts chronologically, edits, sets summary, and deletes entries while syncing Markdown', async () => {
    const f = await createFixture({ startMs: localMs(2026, 11, 13, 14, 15) });

    const late = await f.request('lowtemp/add', {
      input: { text: '下午测试\n第二行', kind: '工程', milestone: true },
    });
    expect(late.entry.date).toBe('2026-11-13');
    expect(late.entry.time).toBe('14:15');
    expect(late.entry.text).toBe('下午测试 第二行');
    expect(late.entry.kind).toBe('工程');
    expect(late.entry.milestone).toBe(true);

    const early = await f.request('lowtemp/add', {
      input: { time: '9:05', text: '晨会复盘', kind: '' },
    });
    expect(early.entry.time).toBe('09:05');
    expect(early.entry.kind).toBeNull();
    expect(early.day.entries.map((e) => e.time)).toEqual(['09:05', '14:15']);
    expect(late.status.dirtyDates).toEqual([]);

    const mdAfterAdd = await f.bridge.readLogFile('/mock/lowtemp', '2026-11-13');
    expect(mdAfterAdd).toBe(
      '---\npublished: 2026-11-13\n---\n\n- 09:05 晨会复盘\n- * 14:15 [工程] 下午测试 第二行\n',
    );

    const summarized = await f.request('lowtemp/set-summary', {
      date: '2026-11-13',
      summary: '稳步推进的一天',
    });
    expect(summarized.day.summary).toBe('稳步推进的一天');
    // Repeating identical summary is a clean no-op
    await f.request('lowtemp/set-summary', { date: '2026-11-13', summary: '稳步推进的一天' });

    const updated = await f.request('lowtemp/update', {
      date: '2026-11-13',
      id: early.entry.id,
      patch: { time: '16:40', kind: '研究', milestone: true, text: '补充实验' },
    });
    expect(updated.day.entries.map((e) => e.time)).toEqual(['14:15', '16:40']);
    // No-op update does not fail or mutate updatedAt
    const noop = await f.request('lowtemp/update', {
      date: '2026-11-13',
      id: early.entry.id,
      patch: {},
    });
    expect(noop.entry).toEqual(updated.entry);

    const state = await f.request('lowtemp/state', {});
    expect(state.days).toHaveLength(1);
    expect(state.days[0]).toMatchObject({
      date: '2026-11-13',
      summary: '稳步推进的一天',
      count: 2,
      milestoneCount: 2,
      firstTime: '14:15',
      lastTime: '16:40',
      dirty: false,
    });

    const deleted = await f.request('lowtemp/delete', { date: '2026-11-13', id: late.entry.id });
    expect(deleted.day.entries).toHaveLength(1);
    const fetchedDay = await f.request('lowtemp/day', { date: '2026-11-13' });
    expect(fetchedDay.day.entries).toHaveLength(1);

    expect(f.events().some((e) => e.type === 'lowtemp/day-changed')).toBe(true);
  });

  it('rejects malformed dates, times, texts, facets, summaries, limits, and missing entry ids', async () => {
    const f = await createFixture();
    await expect(f.request('lowtemp/day', { date: '2026-02-30' })).rejects.toMatchObject({ code: 'lowtemp/invalid-input' });
    await expect(f.request('lowtemp/state', { limit: 0 })).rejects.toMatchObject({ code: 'lowtemp/invalid-input' });
    await expect(
      f.request('lowtemp/add', { input: { text: '   ' } }),
    ).rejects.toMatchObject({ code: 'lowtemp/invalid-input' });
    await expect(
      f.request('lowtemp/add', { input: { text: 'ok', time: '24:00' } }),
    ).rejects.toMatchObject({ code: 'lowtemp/invalid-input' });
    await expect(
      f.request('lowtemp/add', { input: { text: 'ok', kind: '[非法]' } }),
    ).rejects.toMatchObject({ code: 'lowtemp/invalid-input' });
    await expect(
      f.request('lowtemp/add', { input: { text: 'ok', milestone: 'yes' as unknown as boolean } }),
    ).rejects.toMatchObject({ code: 'lowtemp/invalid-input' });
    await expect(
      f.request('lowtemp/set-summary', { date: '2026-11-13', summary: 'x'.repeat(201) }),
    ).rejects.toMatchObject({ code: 'lowtemp/invalid-input' });
    await expect(
      f.request('lowtemp/update', { date: '2026-11-13', id: 'missing', patch: { text: 'x' } }),
    ).rejects.toMatchObject({ code: 'lowtemp/not-found' });
    await expect(
      f.request('lowtemp/delete', { date: '2026-11-13', id: 'missing' }),
    ).rejects.toMatchObject({ code: 'lowtemp/not-found' });
  });
});

describe('bidirectional sync, push, and scheduled automation', () => {
  it('imports external CLI/Obsidian timelines on ready while leaving prose-only files untouched', async () => {
    const initialFiles: Record<string, string> = {
      '2026-08-11': '---\npublished: 2026-08-11\n---\n\n一段早期纯文本日志。\n',
      '2026-11-12': '---\npublished: 2026-11-12\nsummary: "外部写入的一天"\n---\n\n- 10:00 [研究] 从 Obsidian 写入\n',
    };
    const f = await createFixture({ initialFiles });

    const state = await f.request('lowtemp/state', {});
    expect(state.days.map((d) => d.date)).toEqual(['2026-11-12']);
    const imported = await f.request('lowtemp/day', { date: '2026-11-12' });
    expect(imported.day.summary).toBe('外部写入的一天');
    expect(imported.day.entries[0]).toMatchObject({ time: '10:00', kind: '研究', text: '从 Obsidian 写入' });

    // Adding an entry via external CLI later should merge automatically without losing either side
    await f.bridge.writeLogFile(
      '/mock/lowtemp',
      '2026-11-12',
      '---\npublished: 2026-11-12\nsummary: "外部写入的一天"\n---\n\n- 10:00 [研究] 从 Obsidian 写入\n- 20:00 [工程] CLI 追加\n',
    );
    const afterMerge = await f.request('lowtemp/day', { date: '2026-11-12' });
    expect(afterMerge.day.entries.map((e) => e.time)).toEqual(['10:00', '20:00']);
  });

  it('tracks dirtyDates when autoSync is false or write fails, and flushes on lowtemp/sync', async () => {
    const baseBridge = createMemoryBridge();
    let failWrites = true;
    const bridge: LowtempBridge = {
      ...baseBridge,
      async writeLogFile(repo, date, content) {
        if (failWrites) throw new Error('EACCES disk locked');
        return baseBridge.writeLogFile(repo, date, content);
      },
    };
    const f = await createFixture({ bridge, settings: { autoSync: true } });

    const added = await f.request('lowtemp/add', { input: { text: '写入失败仍保留本地' } });
    expect(added.day.entries).toHaveLength(1);
    expect(added.status.dirtyDates).toEqual(['2026-11-13']);
    expect(added.status.lastError).toContain('EACCES');

    await expect(f.request('lowtemp/sync', {})).rejects.toMatchObject({ code: 'lowtemp/sync-failed' });

    failWrites = false;
    const synced = await f.request('lowtemp/sync', {});
    expect(synced.syncedDates).toEqual(['2026-11-13']);
    expect(synced.status.dirtyDates).toEqual([]);
    expect(synced.status.lastError).toBeNull();
  });

  it('runs manual push and handles repo-unavailable and push-failed errors cleanly', async () => {
    const f = await createFixture();
    await f.request('lowtemp/add', { input: { text: '准备推送上线' } });
    const pushed = await f.request('lowtemp/push', {});
    expect(pushed.pushed).toBe(true);
    expect(pushed.commitMessage).toBe('log: 2026-11-13');
    expect(f.notifications.at(-1)?.variant).toBe('success');

    // No-op push
    const emptyBridge = createMemoryBridge();
    const fEmpty = await createFixture({ bridge: emptyBridge });
    const noopPush = await fEmpty.request('lowtemp/push', {});
    expect(noopPush.pushed).toBe(false);
    expect(fEmpty.notifications.at(-1)?.variant).toBe('info');

    // Unconfigured repo path
    await f.changeSetting('repoPath', '');
    await expect(f.request('lowtemp/push', {})).rejects.toMatchObject({ code: 'lowtemp/repo-unavailable' });

    // Git remote error
    const errBridge = createMemoryBridge();
    errBridge.pushLogs = async () => {
      throw new Error('git push rejected');
    };
    const fErr = await createFixture({ bridge: errBridge });
    await fErr.request('lowtemp/add', { input: { text: '待推' } });
    await expect(fErr.request('lowtemp/push', {})).rejects.toMatchObject({ code: 'lowtemp/push-failed' });
    expect((await fErr.request('lowtemp/state', {})).status.lastError).toContain('git push rejected');
  });

  it('fires scheduled daily push at pushHour, prevents duplicate runs same day, retries on failure, and catches up after wake', async () => {
    const startMs = localMs(2026, 11, 13, 21, 50);
    const f = await createFixture({ startMs, settings: { pushHour: 22, dailyPush: true } });
    await f.request('lowtemp/add', { input: { text: '夜间复盘' } });

    // Before 22:00: has not auto-pushed yet
    expect(f.notifications).toHaveLength(0);

    // Advance 10 minutes to 22:00
    await f.advanceBy(10 * 60_000);
    const statusAfterPush = (await f.request('lowtemp/state', {})).status;
    expect(statusAfterPush.lastAutoPushDate).toBe('2026-11-13');
    expect(statusAfterPush.lastPushedAt).not.toBeNull();
    expect(f.notifications.at(-1)).toMatchObject({ variant: 'success' });

    // Change pushHour to 23: should NOT push a second time on 2026-11-13
    const beforeCount = f.notifications.length;
    await f.changeSetting('pushHour', 23);
    await f.advanceBy(60 * 60_000);
    expect(f.notifications.length).toBe(beforeCount);

    // Simulate sleep/wake jump into 2026-11-14 23:30 + incoming request
    f.setTime(localMs(2026, 11, 14, 23, 30));
    await f.request('lowtemp/add', { input: { text: '次日唤醒后的记录' } });
    await f.advanceBy(15_000);
    expect((await f.request('lowtemp/state', {})).status.lastAutoPushDate).toBe('2026-11-14');

    // Simulate scheduled push failure -> retry 15m later succeeds
    const pushSpy = vi.spyOn(f.bridge, 'pushLogs').mockRejectedValueOnce(new Error('network timeout'));
    f.setTime(localMs(2026, 11, 15, 23, 30));
    await f.request('lowtemp/add', { input: { text: '网络波动时记录' } });
    await f.advanceBy(15_000);
    expect(f.notifications.at(-1)?.variant).toBe('warning');
    expect(pushSpy).toHaveBeenCalledTimes(1);

    await f.advanceBy(15 * 60_000);
    expect(pushSpy).toHaveBeenCalledTimes(2);
    expect((await f.request('lowtemp/state', {})).status.lastAutoPushDate).toBe('2026-11-15');
  });

  it('cleans up timers and refuses late work on unload, and rejects corrupt stored data without overwriting', async () => {
    const f = await createFixture();
    expect(f.timers.size).toBe(1);
    f.kernel.unload('lowtemp');
    expect(f.timers.size).toBe(0);
    await expect(f.request('lowtemp/state', {})).rejects.toMatchObject({ code: 'no-handler' });

    const badData = new Map<string, Json>([
      ['day:2026-11-13', { schemaVersion: 99, day: {} } as unknown as Json],
    ]);
    const corrupt = await createFixture({ data: badData });
    expect(corrupt.failed).toMatchObject({ payload: { error: { code: 'lowtemp/invalid-input' } } });
    expect(corrupt.storage.set).not.toHaveBeenCalled();

    // Verify default browser-safe export exists
    expect(typeof defaultSetup).toBe('function');
  });

  it('reloads persisted days and meta, rejects corrupt meta/day records, and handles autoSync=false + dailyPush=false', async () => {
    const f = await createFixture({ settings: { autoSync: false, dailyPush: false } });
    expect(f.timers.size).toBe(0);

    const added = await f.request('lowtemp/add', { input: { text: '先只存在本地', kind: '思考' } });
    expect(added.status.dirtyDates).toEqual(['2026-11-13']);
    // Disk has not been written yet while autoSync is false
    expect(await f.bridge.readLogFile('/mock/lowtemp', '2026-11-13')).toBeNull();

    // Toggling autoSync / dailyPush dynamically schedules and emits status-changed
    await f.changeSetting('dailyPush', true);
    expect(f.timers.size).toBe(1);
    await f.changeSetting('autoSync', true);
    await f.request('lowtemp/set-summary', { date: '2026-11-13', summary: null });

    // Unload and reload from persisted storage (`day:*` + `meta:sync`)
    const savedData = structuredClone(f.data);
    f.kernel.unload('lowtemp');
    const reloaded = await createFixture({ data: savedData });
    const state = await reloaded.request('lowtemp/state', {});
    expect(state.days).toHaveLength(1);
    expect(state.days[0]?.count).toBe(1);

    // Turning repoPath invalid causes repoReady: false on settings change
    await reloaded.changeSetting('repoPath', '   ');
    expect((await reloaded.request('lowtemp/state', {})).status.repoReady).toBe(false);
    await expect(reloaded.request('lowtemp/sync', {})).rejects.toMatchObject({ code: 'lowtemp/repo-unavailable' });

    // Corrupt meta:sync refuses startup without overwriting storage
    const badMeta = new Map<string, Json>([
      ['meta:sync', { schemaVersion: 1, meta: { lastSyncedAt: 'bad' } } as unknown as Json],
    ]);
    const corruptMeta = await createFixture({ data: badMeta });
    expect(corruptMeta.failed).toMatchObject({ payload: { error: { code: 'lowtemp/invalid-input' } } });
    expect(corruptMeta.storage.set).not.toHaveBeenCalled();

    // Additional validation edge cases
    await expect(
      reloaded.request('lowtemp/add', { input: { text: 'ok', kind: 'x'.repeat(25) } }),
    ).rejects.toMatchObject({ code: 'lowtemp/invalid-input' });
    await expect(
      reloaded.request('lowtemp/add', { input: { text: 123 as unknown as string } }),
    ).rejects.toMatchObject({ code: 'lowtemp/invalid-input' });
    await expect(
      reloaded.request('lowtemp/add', { input: { text: 'ok', kind: 99 as unknown as string } }),
    ).rejects.toMatchObject({ code: 'lowtemp/invalid-input' });
    await expect(
      reloaded.request('lowtemp/set-summary', { date: '2026-11-13', summary: 99 as unknown as string }),
    ).rejects.toMatchObject({ code: 'lowtemp/invalid-input' });
    await expect(
      reloaded.request('lowtemp/update', {
        date: '2026-11-13',
        id: added.entry.id,
        patch: { milestone: 'nope' as unknown as boolean },
      }),
    ).rejects.toMatchObject({ code: 'lowtemp/invalid-input' });
  });
});
