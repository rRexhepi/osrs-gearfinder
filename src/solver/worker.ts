import { solve } from './solve';
import { WorkerRequest, WorkerResponse } from './types';

const post = (r: WorkerResponse) => (self as unknown as Worker).postMessage(r);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type !== 'solve') return;
  try {
    let lastPct = -1;
    const result = solve(msg.request, (pct, label) => {
      const rounded = Math.round(pct * 100);
      if (rounded !== lastPct) {
        lastPct = rounded;
        post({ type: 'progress', id: msg.id, pct: rounded, label });
      }
    });
    post({ type: 'result', id: msg.id, result });
  } catch (err) {
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
