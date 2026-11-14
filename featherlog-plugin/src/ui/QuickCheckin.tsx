import type { PreviewHost } from '@featherlog/contracts';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { LOWTEMP_KINDS, nowTimeKey, todayDateKey, useLowtemp, type LowtempStore } from './store';
import styles from './quick.module.css';

/** The scroll dock's quick timeline check-in sticky note. */
export function QuickCheckin({ store, host }: { store: LowtempStore; host: PreviewHost }) {
  const { days, status } = useLowtemp(store);
  const root = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [time, setTime] = useState('');
  const [kind, setKind] = useState<string | null>(null);
  const [milestone, setMilestone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const today = todayDateKey();
  const todayCount = days.find((item) => item.date === today)?.count ?? 0;

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new ResizeObserver(() => host.setHeight(Math.ceil(el.getBoundingClientRect().height)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [host]);

  useEffect(() => {
    if (!feedback || feedback.kind === 'err') return;
    const timer = window.setTimeout(() => setFeedback(null), 2800);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const submit = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setFeedback(null);
    const customTime = time.trim();
    try {
      const entry = await store.add({
        text: body,
        milestone,
        ...(customTime ? { time: customTime } : {}),
        ...(kind ? { kind } : {}),
      });
      setText('');
      setTime('');
      setMilestone(false);
      setFeedback({
        kind: 'ok',
        text: `已记 ${entry.time}${entry.kind ? ` [${entry.kind}]` : ''}${status?.autoSync && status.repoReady ? ' · 已写入本地' : ''}`,
      });
    } catch (cause) {
      setFeedback({
        kind: 'err',
        text: cause instanceof Error ? cause.message : '没能记下，请检查时间格式后重试',
      });
    } finally {
      setBusy(false);
    }
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submit();
    } else if (event.key === 'Escape' && text) {
      event.stopPropagation();
      setText('');
      setTime('');
      setFeedback(null);
    }
  };

  return (
    <div ref={root} className={styles.note}>
      <div className={styles.head}>
        <span className={styles.kicker}>记一刻</span>
        <div className={styles.controls}>
          <input
            className={styles.timeInput}
            value={time}
            disabled={busy}
            maxLength={5}
            placeholder={nowTimeKey()}
            aria-label="时间（HH:MM）"
            title="留空则取当前时间"
            onChange={(event) => setTime(event.target.value)}
          />
          <button
            type="button"
            className={`${styles.star} ${milestone ? styles.starOn : ''}`}
            aria-pressed={milestone}
            onClick={() => setMilestone((prev) => !prev)}
            title="标为关键节点"
          >
            ★ 节点
          </button>
        </div>
      </div>

      <div className={styles.facets} role="radiogroup" aria-label="日志分类">
        <button
          type="button"
          role="radio"
          aria-checked={kind === null}
          className={kind === null ? styles.on : ''}
          onClick={() => setKind(null)}
        >
          无
        </button>
        {LOWTEMP_KINDS.map((item) => (
          <button
            key={item}
            type="button"
            role="radio"
            aria-checked={kind === item}
            className={kind === item ? styles.on : ''}
            onClick={() => setKind(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <textarea
        className={styles.writing}
        value={text}
        rows={3}
        disabled={busy}
        placeholder="此刻在做什么、发现了什么……（Ctrl + Enter 落笔）"
        aria-label="记录时间线"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKey}
      />

      <div className={styles.row}>
        <button type="button" className={styles.openBook} onClick={() => store.openBook()}>
          翻阅时间线（今日 {todayCount} 刻）
        </button>
        <button
          type="button"
          className={styles.write}
          disabled={busy || !text.trim()}
          onClick={() => void submit()}
          title="Ctrl + Enter"
        >
          落笔
        </button>
      </div>

      {feedback && (
        <p className={`${styles.after} ${feedback.kind === 'err' ? styles.trouble : ''}`}>{feedback.text}</p>
      )}
    </div>
  );
}
