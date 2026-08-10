import { TOMBS_OF_AMASCUT_MONSTER_IDS } from '@/lib/constants';
import { useStore } from '@/store';
import { runSolve } from '@/worker-client';
import MonsterPicker from '@/components/MonsterPicker';
import PlayerPanel from '@/components/PlayerPanel';
import OwnershipPanel from '@/components/OwnershipPanel';
import Results from '@/components/Results';

export default function App() {
  const store = useStore();
  const {
    monster, solving, progress, progressLabel, set,
  } = store;

  const solve = async () => {
    if (!monster || solving) return;
    set({
      solving: true, progress: 0, progressLabel: 'starting...', result: null,
    });
    try {
      const isToa = TOMBS_OF_AMASCUT_MONSTER_IDS.includes(monster.id);
      const result = await runSolve({
        monsterId: monster.id,
        monsterVersion: monster.version,
        monsterInputs: isToa ? {
          toaInvocationLevel: store.toaInvocationLevel,
          partySize: store.partySize,
        } : {},
        skills: store.skills,
        potionPreset: store.potionPreset,
        usePrayers: store.usePrayers,
        onSlayerTask: store.onSlayerTask,
        ownedIds: store.hasImportedBank ? store.ownedIds : null,
        restrictToOwned: store.restrictToOwned,
        excludedIds: [],
        weaponsPerStyle: 8,
      }, (pct, label) => set({ progress: pct, progressLabel: label }));
      set({ result, solving: false });
    } catch (err) {
      set({ solving: false, progressLabel: `error: ${err instanceof Error ? err.message : err}` });
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-panel px-4 py-2.5 flex items-center gap-4 sticky top-0 z-30">
        <h1 className="text-gold font-bold tracking-wide">GearFinder</h1>
        <span className="text-muted text-xs hidden sm:block">best-in-slot, next-best, and what you own - per boss</span>
        <div className="flex-1" />
        {solving && (
          <div className="flex items-center gap-2 w-64">
            <div className="flex-1 h-1.5 bg-panel-2 rounded overflow-hidden">
              <div className="h-full bg-gold transition-all" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-xs text-muted whitespace-nowrap">{progressLabel}</span>
          </div>
        )}
        <button
          type="button"
          className="px-4 py-1.5 rounded bg-gold/20 border border-gold/60 text-gold text-sm font-semibold hover:bg-gold/30 disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={!monster || solving}
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
        <main className="flex-1 p-4 overflow-y-auto">
          <Results />
        </main>
      </div>
    </div>
  );
}
