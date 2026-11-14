import type { IsoDateTime } from '@featherlog/contracts';

/** Built-in facet presets shown as quick-pick chips for LowTemp timeline check-ins. */
export type LowtempPresetKind = '工程' | '研究' | '阅读' | '生活' | '思考';

export interface LowtempEntry {
  id: string;
  /** Calendar date in YYYY-MM-DD. */
  date: string;
  /** Local 24-hour clock time in HH:MM. */
  time: string;
  /** Single-line timeline content. */
  text: string;
  /** Optional facet tag rendered as `[分类]` in LowTemp Markdown. */
  kind: string | null;
  /** Whether marked as a milestone (`- * HH:MM`). */
  milestone: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface LowtempDay {
  date: string;
  summary: string | null;
  entries: LowtempEntry[];
  updatedAt: IsoDateTime;
}

export interface LowtempDayDigest {
  date: string;
  summary: string | null;
  preview: string | null;
  count: number;
  milestoneCount: number;
  firstTime: string | null;
  lastTime: string | null;
  dirty: boolean;
}

export interface LowtempStatus {
  repoPath: string;
  repoReady: boolean;
  autoSync: boolean;
  dailyPush: boolean;
  pushHour: number;
  lastSyncedAt: IsoDateTime | null;
  lastPushedAt: IsoDateTime | null;
  lastAutoPushDate: string | null;
  lastError: string | null;
  dirtyDates: string[];
}

export interface LowtempAddInput {
  date?: string;
  time?: string;
  text: string;
  kind?: string | null;
  milestone?: boolean;
}

export interface LowtempUpdatePatch {
  time?: string;
  text?: string;
  kind?: string | null;
  milestone?: boolean;
}

export interface LowtempPushResult {
  pushed: boolean;
  syncedDates: string[];
  commitMessage: string | null;
  status: LowtempStatus;
}

/** Error codes thrown by lowtemp handlers. */
export type LowtempErrorCode =
  | 'lowtemp/invalid-input'
  | 'lowtemp/not-found'
  | 'lowtemp/repo-unavailable'
  | 'lowtemp/sync-failed'
  | 'lowtemp/push-failed';

export interface LowtempEvents {
  'lowtemp/day-changed': { day: LowtempDay; status: LowtempStatus };
  'lowtemp/status-changed': { status: LowtempStatus };
}

export interface LowtempRequests {
  'lowtemp/state': {
    req: { date?: string; limit?: number };
    res: { day: LowtempDay; days: LowtempDayDigest[]; status: LowtempStatus };
  };
  'lowtemp/day': {
    req: { date: string };
    res: { day: LowtempDay; status: LowtempStatus };
  };
  'lowtemp/add': {
    req: { input: LowtempAddInput };
    res: { entry: LowtempEntry; day: LowtempDay; status: LowtempStatus };
  };
  'lowtemp/update': {
    req: { date: string; id: string; patch: LowtempUpdatePatch };
    res: { entry: LowtempEntry; day: LowtempDay; status: LowtempStatus };
  };
  'lowtemp/delete': {
    req: { date: string; id: string };
    res: { day: LowtempDay; status: LowtempStatus };
  };
  'lowtemp/set-summary': {
    req: { date: string; summary: string | null };
    res: { day: LowtempDay; status: LowtempStatus };
  };
  'lowtemp/sync': {
    req: { date?: string };
    res: { syncedDates: string[]; day: LowtempDay; days: LowtempDayDigest[]; status: LowtempStatus };
  };
  'lowtemp/push': {
    req: Record<string, never>;
    res: LowtempPushResult;
  };
}

declare module '@featherlog/contracts' {
  interface EventMap extends LowtempEvents {}
  interface RequestMap extends LowtempRequests {}
}
