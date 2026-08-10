import { useMemo, useState } from 'react';
import { getMonsters } from '@/lib/Monsters';
import { TOMBS_OF_AMASCUT_MONSTER_IDS } from '@/lib/constants';
import { getWikiImage } from '@/utils';
import { useStore } from '@/store';

const allMonsters = getMonsters().filter((m) => m.skills.hp > 0);

export default function MonsterPicker() {
  const { monster, toaInvocationLevel, partySize, set } = useStore();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const starts = [];
    const contains = [];
    for (const m of allMonsters) {
      const name = m.name.toLowerCase();
      if (name.startsWith(q)) starts.push(m);
      else if (name.includes(q)) contains.push(m);
      if (starts.length > 40) break;
    }
    return [...starts, ...contains].slice(0, 30);
  }, [query]);

  const isToa = monster !== null && TOMBS_OF_AMASCUT_MONSTER_IDS.includes(monster.id);

  return (
    <div className="space-y-2">
      <h2 className="text-gold font-semibold text-sm uppercase tracking-wider">Target</h2>
      <div className="relative">
        <input
          className="w-full bg-panel-2 border border-border rounded px-2 py-1.5 text-sm outline-none focus:border-gold"
          placeholder="Search a boss or monster..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {open && matches.length > 0 && (
          <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto bg-panel-2 border border-border rounded shadow-xl">
            {matches.map((m) => (
              <button
                type="button"
                key={`${m.id}-${m.version}`}
                className="w-full text-left px-2 py-1.5 text-sm hover:bg-panel flex justify-between gap-2"
                onMouseDown={() => {
                  set({
                    monster: {
                      id: m.id, name: m.name, version: m.version ?? '', image: m.image ?? '',
                    },
                    result: null,
                  });
                  setQuery('');
                  setOpen(false);
                }}
              >
                <span>{m.name}</span>
                {m.version ? <span className="text-muted">{m.version}</span> : null}
              </button>
            ))}
          </div>
        )}
      </div>

      {monster && (
        <div className="flex items-center gap-3 bg-panel-2 border border-border rounded p-2">
          {monster.image ? (
            <img
              src={getWikiImage(monster.image)}
              alt=""
              className="w-12 h-12 object-contain"
              loading="lazy"
            />
          ) : null}
          <div className="min-w-0">
            <div className="font-semibold truncate">{monster.name}</div>
            {monster.version ? <div className="text-muted text-xs">{monster.version}</div> : null}
          </div>
        </div>
      )}

      {isToa && (
        <div className="flex gap-2">
          <label className="flex-1 text-xs text-muted">
            Invocation
            <input
              type="number"
              min={0}
              max={600}
              step={5}
              className="mt-0.5 w-full bg-panel-2 border border-border rounded px-2 py-1 text-sm text-parchment"
              value={toaInvocationLevel}
              onChange={(e) => set({ toaInvocationLevel: Number(e.target.value) })}
            />
          </label>
          <label className="flex-1 text-xs text-muted">
            Party size
            <input
              type="number"
              min={1}
              max={8}
              className="mt-0.5 w-full bg-panel-2 border border-border rounded px-2 py-1 text-sm text-parchment"
              value={partySize}
              onChange={(e) => set({ partySize: Number(e.target.value) })}
            />
          </label>
        </div>
      )}
    </div>
  );
}
