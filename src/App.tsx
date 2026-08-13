import { useEffect } from 'react';
import clsx from 'clsx';
import { buildBaseRequest, useStore } from '@/store';
import { runRankTargets, runSolve } from '@/worker-client';
import { getPrices } from '@/prices';
import { SolveRequest } from '@/solver/types';
import MonsterPicker from '@/components/MonsterPicker';
import PlayerPanel from '@/components/PlayerPanel';
import OwnershipPanel from '@/components/OwnershipPanel';
import Results from '@/components/Results';
import TrainingSpots from '@/components/TrainingSpots';

export default function App() {
  const store = useStore();
  const {
    monster, mode, solving, rankingSpots, progress, progressLabel, set,
  } = store;

  useEffect(() => {
    getPrices().then((p) => {
      set({ prices: p, havePrices: p !== null });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const solve = async () => {
    const request = buildBaseRequest(store);
    if (!request || solving) return;
    set({
      solving: true, progress: 0, progressLabel: 'starting...', result: null,
    });
    try {
      const result = await runSolve(request, (pct, label) => set({ progress: pct, progressLabel: label }));
      set({ result, solving: false });
    } catch (err) {
      set({ solving: false, progressLabel: `error: ${err instanceof Error ? err.message : err}` });
    }
  };

  const rankSpots = async () => {
    if (rankingSpots || solving) return;
    const request: SolveRequest = {
      ...buildBaseRequest(store) ?? {
        monsterId: 415,
        monsterVersion: '',
        monsterInputs: {},
        skills: store.skills,
        slayerLevel: store.slayerLevel,
        potionPreset: store.potionPreset,
        usePrayers: store.usePrayers,
        onSlayerTask: false,
        ownedIds: store.hasImportedBank ? store.ownedIds : null,
        restrictToOwned: store.restrictToOwned,
        excludedIds: [],
      },
      mode: 'training',
      trainedSkill: store.trainedSkill,
      downtimeSeconds: store.downtimeSeconds,
      prices: store.prices ?? undefined,
      includeUpgrades: false,
    };
    set({ rankingSpots: true, progress: 0, progressLabel: 'ranking spots...' });
    try {
      const spots = await runRankTargets(request, (pct, label) => set({ progress: pct, progressLabel: label }));
      set({ spots, rankingSpots: false });
    } catch (err) {
      set({ rankingSpots: false, progressLabel: `error: ${err instanceof Error ? err.message : err}` });
    }
  };

  const busy = solving || rankingSpots;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-panel px-4 py-2.5 flex items-center gap-3 sticky top-0 z-30">
        <h1 className="text-gold font-bold tracking-wide">GearFinder</h1>
        <div className="flex rounded overflow-hidden border border-border text-sm">
          {(['boss', 'training'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={clsx('px-3 py-1 capitalize', mode === m ? 'bg-gold/20 text-gold' : 'text-muted hover:text-parchment')}
              onClick={() => set({ mode: m, result: null })}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {busy && (
          <div className="flex items-center gap-2 w-64">
            <div className="flex-1 h-1.5 bg-panel-2 rounded overflow-hidden">
              <div className="h-full bg-gold transition-all" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-xs text-muted whitespace-nowrap">{progressLabel}</span>
          </div>
        )}
        {mode === 'training' && (
          <button
            type="button"
            className="px-3 py-1.5 rounded bg-panel-2 border border-border text-sm hover:border-gold disabled:opacity-40"
            disabled={busy}
            onClick={rankSpots}
          >
            {rankingSpots ? 'Ranking...' : 'Rank training spots'}
          </button>
        )}
        <button
          type="button"
          className="px-4 py-1.5 rounded bg-gold/20 border border-gold/60 text-gold text-sm font-semibold hover:bg-gold/30 disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={!monster || busy}
          onClick={solve}
        >
          {solving ? 'Working...' : 'Find gear'}
        </button>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="w-80 shrink-0 border-r border-border bg-panel/50 p-4 space-y-6 overflow-y-auto">
          <MonsterPicker />
          <PlayerPanel />
          <OwnershipPanel />
        </aside>
        <main className="flex-1 p-4 overflow-y-auto space-y-6">
          {mode === 'training' && <TrainingSpots />}
          <Results />
          <footer className="text-[11px] text-muted pt-4 border-t border-border/40">
            DPS engine and item/monster data from the{' '}
            <a className="underline hover:text-parchment" href="https://github.com/weirdgloop/osrs-dps-calc" target="_blank" rel="noreferrer">OSRS Wiki DPS calculator</a>
            {' '}(GPL-3.0). GE prices from the{' '}
            <a className="underline hover:text-parchment" href="https://prices.runescape.wiki" target="_blank" rel="noreferrer">wiki prices API</a>.
            {' '}<a className="underline hover:text-parchment" href="https://github.com/rRexhepi/osrs-gearfinder" target="_blank" rel="noreferrer">Source</a>.
            Bank imports never leave your browser.
          </footer>
        </main>
      </div>
    </div>
  );
}
