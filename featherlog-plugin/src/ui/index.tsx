import type { UiContext } from '@featherlog/contracts';
import { createRoot } from 'react-dom/client';
import { QuickCheckin } from './QuickCheckin';
import { TimelineBook } from './TimelineBook';
import { createLowtempStore } from './store';

/** Renderer entry of @featherlog/plugin-lowtemp: dock quick check-in & timeline book tab. */
export function setup(ctx: UiContext): void {
  const store = createLowtempStore(ctx.bus, ctx.sound);
  ctx.onDispose(() => store.dispose());

  ctx.slots.provide('collapsed.preview', 'lowtemp/quick', (el, host) => {
    const root = createRoot(el);
    root.render(<QuickCheckin store={store} host={host} />);
    return () => root.unmount();
  });

  ctx.slots.provide('panel.tab', 'lowtemp/book', (el) => {
    const root = createRoot(el);
    root.render(<TimelineBook store={store} />);
    return () => root.unmount();
  });
}
