import { Solver, solve } from './solve';
import { rankSpotStyles, rankTrainingTargets } from './targets';
import { WorkerRequest, WorkerResponse } from './types';

const post = (r: WorkerResponse) => (self as unknown as Worker).postMessage(r);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    let lastPct = -1;
    const progress = (pct: number, label: string) => {
      const rounded = Math.round(pct * 100);
      if (rounded !== lastPct) {
        lastPct = rounded;
        post({ type: 'progress', id: msg.id, pct: rounded, label });
      }
    };
    if (msg.type === 'solve') {
      post({ type: 'result', id: msg.id, result: solve(msg.request, progress) });
    } else if (msg.type === 'rankTargets') {
      post({ type: 'targetsResult', id: msg.id, result: rankTrainingTargets(msg.request, progress) });
    } else if (msg.type === 'evaluate') {
      post({ type: 'evalResult', id: msg.id, result: new Solver(msg.request).evaluateLoadout(msg.request.loadout) });
    } else if (msg.type === 'spotStyles') {
      post({ type: 'spotStylesResult', id: msg.id, result: rankSpotStyles(msg.request, msg.spotGroup) });
    }
  } catch (err) {
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
