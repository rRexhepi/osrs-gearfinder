import clsx from 'clsx';
import { SolvedSetup } from '@/solver/types';
import { fmtGp, fmtNum } from '@/format';
import { useStore } from '@/store';

export const iconUrl = (image: string) => `/cdn/equipment/${image}`;

export const SLOT_ORDER = ['weapon', 'shield', 'ammo', 'head', 'cape', 'neck', 'body', 'legs', 'hands', 'feet', 'ring'];

export const SLOT_LABELS: Record<string, string> = {
  weapon: 'Weapon', shield: 'Shield', ammo: 'Ammo', head: 'Head', cape: 'Cape', neck: 'Neck', body: 'Body', legs: 'Legs', hands: 'Hands', feet: 'Feet', ring: 'Ring',
};

export function StatChip({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="bg-panel-2 border border-border rounded px-2 py-1 text-center" title={title}>
      <div className="text-[10px] uppercase text-muted">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

export function OwnedDot({ owned }: { owned: boolean }) {
  const { hasImportedBank, restrictToOwned } = useStore();
  if (!hasImportedBank || restrictToOwned) return null;
  return (
    <span
      className={clsx('inline-block w-2 h-2 rounded-full shrink-0', owned ? 'bg-emerald-400' : 'bg-zinc-600')}
      title={owned ? 'You own this' : 'Not in your bank'}
    />
  );
}

export function SetupCard({ setup, training }: { setup: SolvedSetup; training: boolean }) {
  return (
    <div className="bg-panel border border-border rounded-lg p-3 space-y-3">
      {setup.warning && (
        <div className="text-sm text-amber-400 bg-amber-400/10 border border-amber-400/40 rounded px-2 py-1">
          ⚠ {setup.warning}
        </div>
      )}
      {setup.combo && (
        <div className="flex items-center gap-2 text-sm text-gold" title={setup.combo.note}>
          <span className="bg-gold/10 border border-gold/40 rounded px-2 py-0.5 font-semibold">Full set</span>
          <span className="font-semibold">{setup.combo.name}</span>
          <span className="text-muted text-xs truncate hidden sm:inline">{setup.combo.note}</span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {training && setup.xpHr !== null && <StatChip label="XP/hr" value={fmtNum(setup.xpHr)} title="Capped by monster HP, includes downtime between kills" />}
        <StatChip label="DPS" value={setup.dps.toFixed(3)} />
        <StatChip label="Max hit" value={String(setup.maxHit)} />
        <StatChip label="Accuracy" value={`${(setup.accuracy * 100).toFixed(1)}%`} />
        <StatChip label="TTK" value={`${setup.ttk.toFixed(1)}s`} />
        <StatChip label="Speed" value={`${setup.attackSpeed}t`} />
        {setup.dmgTakenHr !== null && <StatChip label="Dmg taken/hr" value={fmtNum(setup.dmgTakenHr)} title="Expected damage taken while in combat, no protection prayers" />}
        {setup.foodHr !== null && setup.foodHr > 1 && <StatChip label="Food/hr" value={setup.foodHr.toFixed(0)} title="Sharks (20 hp) needed per hour in constant combat" />}
        {setup.costHr !== null && <StatChip label="Cost/hr" value={fmtGp(setup.costHr)} title={`Estimated consumables: ${setup.costParts.join(', ')}`} />}
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
