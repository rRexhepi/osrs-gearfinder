import { SolveRequest, SolveResult, WorkerResponse } from '@/solver/types';

let worker: Worker | null = null;
let nextId = 1;

const getWorker = () => {
  if (!worker) {
    worker = new Worker(new URL('./solver/worker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
};

export function runSolve(
  request: SolveRequest,
  onProgress: (pct: number, label: string) => void,
): Promise<SolveResult> {
  const w = getWorker();
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    const handler = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.id !== id) return;
      if (msg.type === 'progress') {
        onProgress(msg.pct, msg.label);
      } else if (msg.type === 'result') {
        w.removeEventListener('message', handler);
        resolve(msg.result);
      } else if (msg.type === 'error') {
        w.removeEventListener('message', handler);
        reject(new Error(msg.message));
      }
    };
    w.addEventListener('message', handler);
    w.postMessage({ type: 'solve', id, request });
  });
}
