import type {
  LowtempDayDigest,
  LowtempEntry,
  LowtempStatus,
} from '../contracts';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { LOWTEMP_KINDS, nowTimeKey, todayDateKey, useLowtemp, type LowtempStore } from './store';
import styles from './book.module.css';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

function monthLabel(dateKey: string): string {
  const [y, m] = dateKey.split('-').map(Number);
  return `${y} 年 ${m} 月`;
}

function dayShortLabel(dateKey: string): string {
  const [, m, d] = dateKey.split('-').map(Number);
  return `${String(m).padStart(2, '0')}月${String(d).padStart(2, '0')}日`;
}

function dayFullLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(y!, m! - 1, d!).getDay()] ?? '';
  return `${y} 年 ${m} 月 ${d} 日 · ${weekday}`;
}

function formatClock(iso: string | null): string {
  if (!iso) return '尚未';
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function describeSchedule(status: LowtempStatus | null, today: string): string {
  if (!status) return '读取同步状态中……';
  if (!status.repoPath || !status.repoReady) {
    return status.repoPath ? `未在「${status.repoPath}」发现 Git 仓库` : '请先在设置中填写低温笔记仓库路径';
  }
  const pushPart = status.dailyPush
    ? status.lastAutoPushDate === today
      ? `每日 ${String(status.pushHour).padStart(2, '0')}:00 推送 · 今日已推`
      : `待每日 ${String(status.pushHour).padStart(2, '0')}:00 自动推送`
    : '已关闭定时自动推送';
  return `本地就绪 · ${pushPart}`;
}

export function TimelineBook({ store }: { store: LowtempStore }) {
  const { loaded, selectedDate, day, days, status, busy } = useLowtemp(store);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const today = todayDateKey();

  useEffect(() => {
    if (!notice || notice.kind === 'err') return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const displayedDays: LowtempDayDigest[] = days.some((item) => item.date === today)
    ? days
    : [
        {
          date: today,
          summary: null,
          preview: null,
          count: 0,
          milestoneCount: 0,
          firstTime: null,
          lastTime: null,
          dirty: false,
        },
        ...days,
      ];

  const groups: { month: string; items: LowtempDayDigest[] }[] = [];
  for (const item of displayedDays) {
    const label = monthLabel(item.date);
    if (groups.at(-1)?.month === label) groups.at(-1)!.items.push(item);
    else groups.push({ month: label, items: [item] });
  }

  const handleSync = async () => {
    setNotice(null);
    try {
      const res = await store.sync(selectedDate);
      setNotice({
        kind: 'ok',
        text: res.syncedDates.length ? `已同步 ${res.syncedDates.length} 天日志文件` : '本地文件与记录均已对齐',
      });
    } catch (cause) {
      setNotice({ kind: 'err', text: cause instanceof Error ? cause.message : '同步失败' });
    }
  };

  const handlePush = async () => {
    setNotice(null);
    try {
      const res = await store.push();
      setNotice({
        kind: 'ok',
        text: res.pushed ? `已推送上线（${res.commitMessage ?? 'log'}）` : '远端仓库已是最新，无需重复推送',
      });
    } catch (cause) {
      setNotice({ kind: 'err', text: cause instanceof Error ? cause.message : '推送失败，请检查 Git 远端与凭据' });
    }
  };

  return (
    <div className={styles.book}>
      <div className={styles.pageWrap}>
        <section className={`${styles.page} ${styles.left} fl-paper`}>
          <header className={styles.head}>
            <h1>时间线</h1>
            <p>同步至低温笔记 · 每日自动归档上线</p>
          </header>

          <div className={styles.statusCard}>
            <div className={styles.statusLine}>
              <span className={`${styles.dot} ${status?.repoReady ? styles.dotReady : styles.dotWarn}`} />
              <span className={styles.statusText}>{describeSchedule(status, today)}</span>
            </div>
            <div className={styles.statusMeta}>
              <span>最近写入：{formatClock(status?.lastSyncedAt ?? null)}</span>
              <span>最近推送：{formatClock(status?.lastPushedAt ?? null)}</span>
              {status && status.dirtyDates.length > 0 && (
                <span className={styles.dirtyTag}>待写回 {status.dirtyDates.length} 天</span>
              )}
            </div>
            {status?.lastError && <p className={styles.errorText}>{status.lastError}</p>}
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.actionBtn}
                disabled={busy !== null || !status?.repoReady}
                onClick={() => void handleSync()}
              >
                {busy === 'sync' ? '同步中……' : '同步本地'}
              </button>
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.pushBtn}`}
                disabled={busy !== null || !status?.repoReady}
                onClick={() => void handlePush()}
              >
                {busy === 'push' ? '推送中……' : '立即推送上线'}
              </button>
            </div>
            {notice && (
              <p className={`${styles.notice} ${notice.kind === 'err' ? styles.noticeErr : ''}`}>{notice.text}</p>
            )}
          </div>

          <div className={styles.index}>
            {groups.map((group) => (
              <div key={group.month} className={styles.monthGroup}>
                <h2 className={styles.month}>{group.month}</h2>
                {group.items.map((item) => (
                  <button
                    key={item.date}
                    type="button"
                    className={`${styles.dayRow} ${item.date === selectedDate ? styles.dayRowOn : ''}`}
                    onClick={() => void store.selectDay(item.date)}
                  >
                    <div className={styles.dayTop}>
                      <span className={styles.dayTitle}>
                        {dayShortLabel(item.date)}
                        {item.date === today && <em>今日</em>}
                        {item.dirty && <small>待写入</small>}
                      </span>
                      <span className={styles.dayCount}>
                        {item.count ? `${item.count} 刻` : '空白'}
                      </span>
                    </div>
                    <p className={styles.dayPreview}>{item.preview ?? '尚无落笔，点开写下第一刻'}</p>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className={styles.pageWrap}>
        <section className={`${styles.page} ${styles.right} fl-paper`}>
          {loaded && day ? (
            <DaySheet
              key={day.date}
              date={day.date}
              summary={day.summary}
              entries={day.entries}
              store={store}
              onError={(message) => setNotice({ kind: 'err', text: message })}
            />
          ) : (
            <div className={styles.loading}>翻开账簿中……</div>
          )}
        </section>
      </div>
      <div className={styles.gutter} />
    </div>
  );
}

interface DaySheetProps {
  date: string;
  summary: string | null;
  entries: LowtempEntry[];
  store: LowtempStore;
  onError(message: string): void;
}

function DaySheet({ date, summary, entries, store, onError }: DaySheetProps) {
  const [summaryDraft, setSummaryDraft] = useState(summary ?? '');
  const [summarySaved, setSummarySaved] = useState(false);

  const [newTime, setNewTime] = useState('');
  const [newKind, setNewKind] = useState<string | null>(null);
  const [newMilestone, setNewMilestone] = useState(false);
  const [newText, setNewText] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    setSummaryDraft(summary ?? '');
  }, [summary]);

  useEffect(() => {
    if (!summarySaved) return;
    const timer = window.setTimeout(() => setSummarySaved(false), 1800);
    return () => window.clearTimeout(timer);
  }, [summarySaved]);

  const commitSummary = async () => {
    const clean = summaryDraft.trim();
    const next = clean || null;
    if (next === (summary ?? null)) return;
    try {
      await store.setSummary(date, next);
      setSummarySaved(true);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : '保存日结失败');
    }
  };

  const handleAdd = async () => {
    const body = newText.trim();
    if (!body || adding) return;
    setAdding(true);
    const time = newTime.trim();
    try {
      await store.add({
        date,
        text: body,
        milestone: newMilestone,
        ...(time ? { time } : {}),
        ...(newKind ? { kind: newKind } : {}),
      });
      setNewText('');
      setNewTime('');
      setNewMilestone(false);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : '新增记录失败');
    } finally {
      setAdding(false);
    }
  };

  const first = entries[0]?.time;
  const last = entries.at(-1)?.time;
  const spanLabel = entries.length === 0 ? '尚未落笔' : first === last ? `${first} · 1 刻` : `${first} — ${last} · ${entries.length} 刻`;

  return (
    <div className={styles.sheet}>
      <header className={styles.sheetHead}>
        <h2>{dayFullLabel(date)}</h2>
        <span>{spanLabel}</span>
      </header>

      <div className={styles.summaryRow}>
        <label htmlFor={`lowtemp-summary-${date}`}>今日日结</label>
        <input
          id={`lowtemp-summary-${date}`}
          className={styles.summaryInput}
          value={summaryDraft}
          placeholder="写一句概括今天的话（回车或失焦保存）"
          onChange={(event) => setSummaryDraft(event.target.value)}
          onBlur={() => void commitSummary()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
        />
        {summarySaved && <small className={styles.savedBadge}>已记</small>}
      </div>

      <div className={styles.timeline}>
        {entries.length === 0 ? (
          <p className={styles.emptyTimeline}>这一页还空着。可以在下方记第一笔，或在卷轴「记一刻」里随时补录。</p>
        ) : (
          entries.map((entry) => (
            <TimelineRow key={entry.id} date={date} entry={entry} store={store} onError={onError} />
          ))
        )}
      </div>

      <footer className={styles.composer}>
        <div className={styles.composerTop}>
          <input
            className={styles.composeTime}
            value={newTime}
            maxLength={5}
            placeholder={nowTimeKey()}
            aria-label="时间"
            onChange={(event) => setNewTime(event.target.value)}
          />
          <select
            className={styles.composeSelect}
            value={newKind ?? ''}
            aria-label="分类"
            onChange={(event) => setNewKind(event.target.value || null)}
          >
            <option value="">无分类</option>
            {LOWTEMP_KINDS.map((item) => (
              <option key={item} value={item}>
                [{item}]
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`${styles.composeStar} ${newMilestone ? styles.composeStarOn : ''}`}
            onClick={() => setNewMilestone((prev) => !prev)}
          >
            ★ 节点
          </button>
        </div>
        <div className={styles.composerBottom}>
          <input
            className={styles.composeInput}
            value={newText}
            disabled={adding}
            placeholder={`记入 ${dayShortLabel(date)} 时间线……（Enter 落笔）`}
            aria-label="新增时间线内容"
            onChange={(event) => setNewText(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void handleAdd();
              }
            }}
          />
          <button
            type="button"
            className={styles.composeBtn}
            disabled={adding || !newText.trim()}
            onClick={() => void handleAdd()}
          >
            落笔
          </button>
        </div>
      </footer>
    </div>
  );
}

interface TimelineRowProps {
  date: string;
  entry: LowtempEntry;
  store: LowtempStore;
  onError(message: string): void;
}

function TimelineRow({ date, entry, store, onError }: TimelineRowProps) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [time, setTime] = useState(entry.time);
  const [kind, setKind] = useState(entry.kind ?? '');
  const [milestone, setMilestone] = useState(entry.milestone);
  const [text, setText] = useState(entry.text);
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setTime(entry.time);
    setKind(entry.kind ?? '');
    setMilestone(entry.milestone);
    setText(entry.text);
    setEditing(true);
    setConfirmDelete(false);
  };

  const saveEdit = async () => {
    const clean = text.trim();
    if (!clean || saving) return;
    setSaving(true);
    try {
      await store.update(date, entry.id, {
        time: time.trim(),
        text: clean,
        kind: kind.trim() || null,
        milestone,
      });
      setEditing(false);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : '修改失败');
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className={`${styles.item} ${styles.itemEditing}`}>
        <div className={styles.editTop}>
          <input
            className={styles.composeTime}
            value={time}
            maxLength={5}
            aria-label="修改时间"
            onChange={(event) => setTime(event.target.value)}
          />
          <input
            className={styles.editKind}
            value={kind}
            maxLength={24}
            placeholder="分类（可选）"
            aria-label="修改分类"
            onChange={(event) => setKind(event.target.value)}
          />
          <button
            type="button"
            className={`${styles.composeStar} ${milestone ? styles.composeStarOn : ''}`}
            onClick={() => setMilestone((prev) => !prev)}
          >
            ★ 节点
          </button>
        </div>
        <div className={styles.editBottom}>
          <input
            className={styles.composeInput}
            value={text}
            autoFocus
            aria-label="修改内容"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void saveEdit();
              } else if (event.key === 'Escape') {
                event.stopPropagation();
                setEditing(false);
              }
            }}
          />
          <button type="button" className={styles.miniAction} disabled={saving} onClick={() => void saveEdit()}>
            存
          </button>
          <button type="button" className={styles.miniAction} onClick={() => setEditing(false)}>
            退
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.item}>
      <span className={`${styles.node} ${entry.milestone ? styles.nodeMilestone : ''}`} aria-hidden />
      <span className={styles.itemTime}>{entry.time}</span>
      <div className={styles.itemBody}>
        {entry.kind && <span className={styles.kindTag}>[{entry.kind}]</span>}
        <span className={styles.itemText}>{entry.text}</span>
      </div>
      <div className={styles.itemActions}>
        <button type="button" className={styles.miniAction} onClick={startEdit}>
          改
        </button>
        <button
          type="button"
          className={`${styles.miniAction} ${confirmDelete ? styles.confirming : ''}`}
          onClick={() => {
            if (!confirmDelete) {
              setConfirmDelete(true);
              return;
            }
            void store.remove(date, entry.id).catch((cause: unknown) => {
              onError(cause instanceof Error ? cause.message : '删除失败');
            });
          }}
          onBlur={() => setConfirmDelete(false)}
        >
          {confirmDelete ? '删?' : '删'}
        </button>
      </div>
    </div>
  );
}
