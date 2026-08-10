import {
  RankTargetsResult, SolveRequest, SolveResult, WorkerRequest, WorkerResponse,
} from '@/solver/types';

let worker: Worker | null = null;
let nextId = 1;

const getWorker = () => {
  if (!worker) {
    worker = new Worker(new URL('./solver/worker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
};

function run<T>(
  type: WorkerRequest['type'],
  resultType: 'result' | 'targetsResult',
  request: SolveRequest,
  onProgress: (pct: number, label: string) => void,
): Promise<T> {
  const w = getWorker();
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    const handler = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.id !== id) return;
      if (msg.type === 'progress') {
        onProgress(msg.pct, msg.label);
      } else if (msg.type === resultType) {
        w.removeEventListener('message', handler);
        resolve((msg as unknown as { result: T }).result);
      } else if (msg.type === 'error') {
        w.removeEventListener('message', handler);
        reject(new Error(msg.message));
      }
    };
    w.addEventListener('message', handler);
    w.postMessage({ type, id, request });
  });
}

export const runSolve = (
  request: SolveRequest,
  onProgress: (pct: number, label: string) => void,
): Promise<SolveResult> => run('solve', 'result', request, onProgress);

export const runRankTargets = (
  request: SolveRequest,
  onProgress: (pct: number, label: string) => void,
): Promise<RankTargetsResult> => run('rankTargets', 'targetsResult', request, onProgress);
