import type { Dispose, UiBus, UiSound } from '@featherlog/contracts';
import { useSyncExternalStore } from 'react';
import type {
  LowtempAddInput,
  LowtempDay,
  LowtempDayDigest,
  LowtempPresetKind,
  LowtempStatus,
  LowtempUpdatePatch,
} from '../contracts';

export const LOWTEMP_KINDS: readonly LowtempPresetKind[] = ['工程', '研究', '阅读', '生活', '思考'];

export interface LowtempSnapshot {
  loaded: boolean;
  selectedDate: string;
  day: LowtempDay | null;
  days: LowtempDayDigest[];
  status: LowtempStatus | null;
  busy: 'sync' | 'push' | null;
}

export function todayDateKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function nowTimeKey(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function summarizeDay(day: LowtempDay, dirtyDates: string[]): LowtempDayDigest {
  const first = day.entries[0] ?? null;
  const last = day.entries.at(-1) ?? null;
  return {
    date: day.date,
    summary: day.summary,
    preview: day.summary ?? first?.text ?? null,
    count: day.entries.length,
    milestoneCount: day.entries.filter((e) => e.milestone).length,
    firstTime: first?.time ?? null,
    lastTime: last?.time ?? null,
    dirty: dirtyDates.includes(day.date),
  };
}

function upsertDigest(
  days: LowtempDayDigest[],
  day: LowtempDay,
  dirtyDates: string[],
): LowtempDayDigest[] {
  const digest = summarizeDay(day, dirtyDates);
  const rest = days.filter((item) => item.date !== day.date);
  return [digest, ...rest].sort((a, b) => b.date.localeCompare(a.date));
}

export function createLowtempStore(bus: UiBus, sound: UiSound) {
  const today = todayDateKey();
  let snapshot: LowtempSnapshot = {
    loaded: false,
    selectedDate: today,
    day: null,
    days: [],
    status: null,
    busy: null,
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<LowtempSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  };

  let generation = 0;
  const load = async (date = snapshot.selectedDate) => {
    const mine = ++generation;
    try {
      const res = await bus.request('lowtemp/state', { date, limit: 60 });
      if (mine !== generation) return;
      set({
        loaded: true,
        selectedDate: res.day.date,
        day: res.day,
        days: res.days,
        status: res.status,
      });
    } catch (cause) {
      console.error('lowtemp/state failed', cause);
      if (mine === generation) set({ loaded: true });
    }
  };

  const stops: Dispose[] = [
    bus.on('lowtemp/day-changed', ({ day, status }) => {
      set({
        status,
        days: upsertDigest(snapshot.days, day, status.dirtyDates),
        ...(snapshot.selectedDate === day.date ? { day } : {}),
      });
    }),
    bus.on('lowtemp/status-changed', ({ status }) => {
      const dirty = new Set(status.dirtyDates);
      set({
        status,
        days: snapshot.days.map((item) => ({ ...item, dirty: dirty.has(item.date) })),
      });
    }),
  ];

  void load();

  return {
    subscribe(listener: () => void): Dispose {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    async selectDay(date: string) {
      sound.play('page');
      set({ selectedDate: date });
      const res = await bus.request('lowtemp/day', { date });
      set({
        selectedDate: res.day.date,
        day: res.day,
        status: res.status,
        days: upsertDigest(snapshot.days, res.day, res.status.dirtyDates),
      });
    },
    async add(input: LowtempAddInput) {
      const res = await bus.request('lowtemp/add', { input });
      sound.play(res.entry.milestone ? 'stamp' : 'ink');
      set({
        status: res.status,
        days: upsertDigest(snapshot.days, res.day, res.status.dirtyDates),
        ...(snapshot.selectedDate === res.day.date ? { day: res.day } : {}),
      });
      return res.entry;
    },
    async update(date: string, id: string, patch: LowtempUpdatePatch) {
      const res = await bus.request('lowtemp/update', { date, id, patch });
      sound.play('ink');
      set({
        status: res.status,
        days: upsertDigest(snapshot.days, res.day, res.status.dirtyDates),
        ...(snapshot.selectedDate === res.day.date ? { day: res.day } : {}),
      });
      return res.entry;
    },
    async remove(date: string, id: string) {
      const res = await bus.request('lowtemp/delete', { date, id });
      sound.play('erase');
      set({
        status: res.status,
        days: upsertDigest(snapshot.days, res.day, res.status.dirtyDates),
        ...(snapshot.selectedDate === res.day.date ? { day: res.day } : {}),
      });
    },
    async setSummary(date: string, summary: string | null) {
      const res = await bus.request('lowtemp/set-summary', { date, summary });
      sound.play('ink');
      set({
        status: res.status,
        days: upsertDigest(snapshot.days, res.day, res.status.dirtyDates),
        ...(snapshot.selectedDate === res.day.date ? { day: res.day } : {}),
      });
      return res.day;
    },
    async sync(date = snapshot.selectedDate) {
      set({ busy: 'sync' });
      try {
        const res = await bus.request('lowtemp/sync', { date }, { timeoutMs: 15_000 });
        sound.play('tick');
        set({
          day: res.day,
          days: res.days,
          status: res.status,
          busy: null,
        });
        return res;
      } catch (cause) {
        set({ busy: null });
        throw cause;
      }
    },
    async push() {
      set({ busy: 'push' });
      try {
        const res = await bus.request('lowtemp/push', {}, { timeoutMs: 45_000 });
        sound.play(res.pushed ? 'stamp' : 'tick');
        set({ status: res.status, busy: null });
        await load(snapshot.selectedDate);
        return res;
      } catch (cause) {
        set({ busy: null });
        throw cause;
      }
    },
    openBook() {
      void bus.request('shell/open-panel', { tab: 'lowtemp/book' }).catch(console.error);
    },
    dispose() {
      stops.forEach((stop) => stop());
      listeners.clear();
    },
  };
}

export type LowtempStore = ReturnType<typeof createLowtempStore>;

export function useLowtemp(store: LowtempStore): LowtempSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
