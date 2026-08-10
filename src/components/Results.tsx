import { useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  SlotAlternative, SolvedSetup, StyleGroup, StyleResult,
} from '@/solver/types';
import { useStore } from '@/store';

const iconUrl = (image: string) => `/cdn/equipment/${image}`;

const SLOT_ORDER = ['weapon', 'shield', 'ammo', 'head', 'cape', 'neck', 'body', 'legs', 'hands', 'feet', 'ring'];
const SLOT_LABELS: Record<string, string> = {
  weapon: 'Weapon', shield: 'Shield', ammo: 'Ammo', head: 'Head', cape: 'Cape', neck: 'Neck', body: 'Body', legs: 'Legs', hands: 'Hands', feet: 'Feet', ring: 'Ring',
};

function OwnedDot({ owned }: { owned: boolean }) {
  const { hasImportedBank, restrictToOwned } = useStore();
  if (!hasImportedBank || restrictToOwned) return null;
  return (
    <span
      className={clsx('inline-block w-2 h-2 rounded-full shrink-0', owned ? 'bg-emerald-400' : 'bg-zinc-600')}
      title={owned ? 'You own this' : 'Not in your bank'}
    />
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-panel-2 border border-border rounded px-2 py-1 text-center">
      <div className="text-[10px] uppercase text-muted">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

function SetupCard({ setup }: { setup: SolvedSetup }) {
  return (
    <div className="bg-panel border border-border rounded-lg p-3 space-y-3">
      <div className="flex flex-wrap gap-2">
        <StatChip label="DPS" value={setup.dps.toFixed(3)} />
        <StatChip label="Max hit" value={String(setup.maxHit)} />
        <StatChip label="Accuracy" value={`${(setup.accuracy * 100).toFixed(1)}%`} />
        <StatChip label="TTK" value={`${setup.ttk.toFixed(1)}s`} />
        <StatChip label="Speed" value={`${setup.attackSpeed}t`} />
      </div>
      <div className="text-xs text-muted">
        {setup.styleName} ({setup.styleStance})
        {setup.spellName ? ` - ${setup.spellName}` : ''}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {SLOT_ORDER.map((slot) => {
          const item = setup.items[slot];
          if (!item) return null;
          return (
            <div key={slot} className="flex items-center gap-2 bg-panel-2 border border-border rounded px-2 py-1">
              <img src={iconUrl(item.image)} alt="" className="w-6 h-6 object-contain shrink-0" loading="lazy" />
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate">
                  {item.name}
                  {item.detail ? <span className="text-muted"> ({item.detail})</span> : null}
                </div>
                <div className="text-[10px] uppercase text-muted">{SLOT_LABELS[slot]}</div>
              </div>
              <OwnedDot owned={item.owned} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AltTable({ slot, alts }: { slot: string; alts: SlotAlternative[] }) {
  const [expanded, setExpanded] = useState(false);
  if (alts.length === 0) return null;
  const shown = expanded ? alts : alts.slice(0, 8);
  return (
    <div className="bg-panel border border-border rounded-lg overflow-hidden">
      <div className="px-3 py-2 text-sm font-semibold text-gold border-b border-border">{SLOT_LABELS[slot] ?? slot}</div>
      <table className="w-full text-sm">
        <tbody>
          {shown.map((a, ix) => (
            <tr key={`${a.id}-${a.detail ?? ''}`} className={clsx('border-b border-border/40 last:border-0', ix === 0 && 'bg-gold/5')}>
              <td className="pl-3 pr-1 py-1 text-muted text-xs w-6">{ix + 1}</td>
              <td className="py-1 w-8">
                {a.image ? <img src={iconUrl(a.image)} alt="" className="w-5 h-5 object-contain" loading="lazy" /> : <span className="inline-block w-5 h-5" />}
              </td>
              <td className="py-1 pr-2">
                <span className="truncate">{a.name}</span>
                {a.detail ? <span className="text-muted text-xs"> ({a.detail})</span> : null}
              </td>
              <td className="py-1 pr-2 w-5"><OwnedDot owned={a.owned} /></td>
              <td className="py-1 pr-2 text-right tabular-nums w-16">{a.dps.toFixed(2)}</td>
              <td className={clsx('py-1 pr-3 text-right tabular-nums w-16 text-xs', a.deltaPct >= -0.05 ? 'text-emerald-400' : a.deltaPct > -10 ? 'text-amber-400' : 'text-red-400')}>
                {a.deltaPct >= -0.05 ? 'best' : `${a.deltaPct.toFixed(1)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {alts.length > 8 && (
        <button
          type="button"
          className="w-full py-1 text-xs text-muted hover:text-parchment border-t border-border/40"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'show less' : `show all ${alts.length}`}
        </button>
      )}
    </div>
  );
}

function StyleSection({ style }: { style: StyleResult }) {
  if (style.immune || !style.best) {
    return (
      <div className="text-muted text-sm bg-panel border border-border rounded-lg p-4">
        This monster can&apos;t reasonably be damaged with {style.styleGroup} (immune, or no usable weapon found).
      </div>
    );
  }
  const altSlots = SLOT_ORDER.filter((s) => (style.alternatives[s]?.length ?? 0) > 0);
  return (
    <div className="space-y-4">
      <SetupCard setup={style.best} />
      {style.setups.length > 1 && (
        <div className="bg-panel border border-border rounded-lg p-3">
          <div className="text-sm font-semibold text-gold mb-1.5">Other optimised setups</div>
          <div className="space-y-1">
            {style.setups.slice(1).map((s) => (
              <div key={`${s.items.weapon?.id}-${s.spellName ?? ''}`} className="flex items-center gap-2 text-sm">
                {s.items.weapon && <img src={iconUrl(s.items.weapon.image)} alt="" className="w-5 h-5 object-contain" loading="lazy" />}
                <span className="flex-1 truncate">
                  {s.items.weapon?.name}
                  {s.spellName ? ` (${s.spellName})` : s.items.weapon?.detail ? ` (${s.items.weapon.detail})` : ''}
                </span>
                <span className="tabular-nums text-muted">{s.dps.toFixed(3)} dps</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <div className="text-sm font-semibold text-gold mb-2">Next best per slot</div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {altSlots.map((slot) => <AltTable key={slot} slot={slot} alts={style.alternatives[slot]!} />)}
        </div>
      </div>
    </div>
  );
}

export default function Results() {
  const { result } = useStore();
  const [tab, setTab] = useState<StyleGroup | null>(null);

  const active: StyleGroup | null = useMemo(() => {
    if (!result) return null;
    if (tab && result.styles.some((s) => s.styleGroup === tab)) return tab;
    return result.bestStyle ?? result.styles[0]?.styleGroup ?? null;
  }, [result, tab]);

  if (!result) {
    return (
      <div className="text-muted text-sm mt-12 text-center">
        Pick a target, set up your stats and bank, then hit <span className="text-gold">Find gear</span>.
      </div>
    );
  }

  const activeStyle = result.styles.find((s) => s.styleGroup === active);

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {result.styles.map((s) => (
          <button
            key={s.styleGroup}
            type="button"
            className={clsx(
              'px-3 py-1.5 rounded-t text-sm capitalize border border-b-0',
              s.styleGroup === active ? 'bg-panel border-border text-gold' : 'bg-panel-2/50 border-transparent text-muted hover:text-parchment',
            )}
            onClick={() => setTab(s.styleGroup)}
          >
            {s.styleGroup}
            {s.best ? <span className="ml-1.5 tabular-nums text-xs">{s.best.dps.toFixed(2)}</span> : <span className="ml-1.5 text-xs">-</span>}
            {result.bestStyle === s.styleGroup && <span className="ml-1 text-gold">★</span>}
          </button>
        ))}
      </div>
      {activeStyle && <StyleSection style={activeStyle} />}
    </div>
  );
}
