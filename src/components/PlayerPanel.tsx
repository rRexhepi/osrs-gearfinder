import { useState } from 'react';
import { fetchPlayerSkills } from '@/utils';
import { useStore } from '@/store';
import { PotionPreset } from '@/solver/types';

const SKILL_FIELDS: { key: 'atk' | 'str' | 'def' | 'ranged' | 'magic' | 'prayer'; label: string }[] = [
  { key: 'atk', label: 'Attack' },
  { key: 'str', label: 'Strength' },
  { key: 'def', label: 'Defence' },
  { key: 'ranged', label: 'Ranged' },
  { key: 'magic', label: 'Magic' },
  { key: 'prayer', label: 'Prayer' },
];

const POTION_PRESETS: { value: PotionPreset; label: string }[] = [
  { value: 'standard', label: 'Standard potions (SCB / Ranging / Sat. heart)' },
  { value: 'overload', label: 'Overload (+)' },
  { value: 'salts', label: 'Smelling salts' },
  { value: 'none', label: 'No boosts' },
];

export default function PlayerPanel() {
  const {
    skills, potionPreset, usePrayers, onSlayerTask, set,
  } = useStore();
  const [username, setUsername] = useState('');
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'error'>('idle');

  const lookup = async () => {
    if (!username.trim()) return;
    setLookupState('loading');
    try {
      const fetched = await fetchPlayerSkills(username.trim());
      set({ skills: { ...skills, ...fetched } });
      setLookupState('idle');
    } catch {
      setLookupState('error');
    }
  };

  return (
    <div className="space-y-2">
      <h2 className="text-gold font-semibold text-sm uppercase tracking-wider">Player</h2>

      <div className="flex gap-1">
        <input
          className="flex-1 min-w-0 bg-panel-2 border border-border rounded px-2 py-1 text-sm outline-none focus:border-gold"
          placeholder="RSN (hiscores lookup)"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') lookup(); }}
        />
        <button
          type="button"
          className="px-2 py-1 text-sm bg-panel-2 border border-border rounded hover:border-gold disabled:opacity-50"
          disabled={lookupState === 'loading'}
          onClick={lookup}
        >
          {lookupState === 'loading' ? '...' : 'Fetch'}
        </button>
      </div>
      {lookupState === 'error' && <div className="text-red-400 text-xs">Lookup failed - name not found?</div>}

      <div className="grid grid-cols-3 gap-1">
        {SKILL_FIELDS.map((f) => (
          <label key={f.key} className="text-[10px] text-muted uppercase">
            {f.label}
            <input
              type="number"
              min={1}
              max={99}
              className="mt-0.5 w-full bg-panel-2 border border-border rounded px-1.5 py-1 text-sm text-parchment"
              value={skills[f.key]}
              onChange={(e) => set({ skills: { ...skills, [f.key]: Number(e.target.value) } })}
            />
          </label>
        ))}
      </div>

      <label className="block text-xs text-muted">
        Boosts
        <select
          className="mt-0.5 w-full bg-panel-2 border border-border rounded px-2 py-1.5 text-sm text-parchment"
          value={potionPreset}
          onChange={(e) => set({ potionPreset: e.target.value as PotionPreset })}
        >
          {POTION_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </label>

      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={usePrayers}
            onChange={(e) => set({ usePrayers: e.target.checked })}
          />
          Piety / Rigour / Augury
        </label>
      </div>
      <label className="flex items-center gap-1.5 cursor-pointer text-sm">
        <input
          type="checkbox"
          checked={onSlayerTask}
          onChange={(e) => set({ onSlayerTask: e.target.checked })}
        />
        On slayer task
      </label>
    </div>
  );
}
