import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { EquipmentPiece } from '@/types/Player';
import { getCombatStylesForCategory } from '@/utils';
import { BLOWPIPE_IDS } from '@/lib/constants';
import { searchEquipment } from '@/solver/ownership';
import { canonicalIdOf, DART_NAMES, itemById } from '@/solver/data';
import { GearLoadout, SolvedSetup } from '@/solver/types';
import { fmtGp, fmtMetric, fmtNum } from '@/format';
import { runEvaluate } from '@/worker-client';
import { buildBaseRequest, useStore } from '@/store';
import {
  iconUrl, SLOT_LABELS, SLOT_ORDER, StatChip,
} from './shared';

function SlotPicker({
  slot, itemId, disabled, ownedIds, onPick, onClear,
}: {
  slot: string;
  itemId: number | undefined;
  disabled?: boolean;
  ownedIds: Set<number>;
  onPick: (item: EquipmentPiece) => void;
  onClear: () => void;
}) {
  const [search, setSearch] = useState('');
  const results = useMemo(() => {
    const hits = searchEquipment(search, 12, (i) => i.slot === slot);
    if (ownedIds.size === 0) return hits;
    const owned = (i: EquipmentPiece) => (ownedIds.has(canonicalIdOf(i.id)) ? 0 : 1);
    return [...hits].sort((a, b) => owned(a) - owned(b));
  }, [search, slot, ownedIds]);
  const item = itemId !== undefined ? itemById.get(itemId) : undefined;

  return (
    <div className={clsx('bg-panel-2 border border-border rounded px-2 py-1', disabled && 'opacity-40')}>
      <div className="text-[10px] uppercase text-muted">{SLOT_LABELS[slot]}{disabled ? ' (two-handed)' : ''}</div>
      {item ? (
        <div className="flex items-center gap-1.5 text-sm">
          <img src={iconUrl(item.image)} alt="" className="w-5 h-5 object-contain shrink-0" loading="lazy" />
          <span className="truncate flex-1">{item.name}</span>
          <button type="button" className="text-muted hover:text-red-400 text-xs" onClick={onClear}>x</button>
        </div>
      ) : (
        <div className="relative">
          <input
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted/60"
            placeholder={disabled ? '-' : 'search...'}
            disabled={disabled}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {results.length > 0 && (
            <div className="absolute z-20 mt-1 -ml-2 w-64 max-h-56 overflow-y-auto bg-panel-2 border border-border rounded shadow-xl">
              {results.map((i) => (
                <button
                  type="button"
                  key={i.id}
                  className="w-full text-left px-2 py-1 text-sm hover:bg-panel flex items-center gap-2"
                  onClick={() => { onPick(i); setSearch(''); }}
                >
                  <img src={iconUrl(i.image)} alt="" className="w-5 h-5 object-contain" loading="lazy" />
                  <span className="truncate flex-1">{i.name}</span>
                  {i.version ? <span className="text-muted text-xs">{i.version}</span> : null}
                  {ownedIds.has(canonicalIdOf(i.id)) && <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" title="You own this" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function GearPanel() {
  const store = useStore();
  const {
    monster, gear, gearStyle, gearDart, ownedIds, hasImportedBank, result, mode, set,
  } = store;
  const [open, setOpen] = useState(false);
  const [setup, setSetup] = useState<SolvedSetup | null>(null);
  const evalSeq = useRef(0);

  const training = mode === 'training';
  const weapon = gear.weapon !== undefined ? itemById.get(gear.weapon) : undefined;
  const isBlowpipe = weapon !== undefined && BLOWPIPE_IDS.includes(weapon.id);
  const ownedSet = useMemo(
    () => new Set(hasImportedBank ? ownedIds.map(canonicalIdOf) : []),
    [hasImportedBank, ownedIds],
  );
  const styles = useMemo(() => {
    if (!weapon) return [];
    const seen = new Set<string>();
    return getCombatStylesForCategory(weapon.category)
      .filter((s) => s.stance && s.stance !== 'Manual Cast')
      .filter((s) => {
        const key = `${s.name}|${s.stance}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [weapon]);

  // the solved best for the same target, for the comparison line
  const bestMetric = useMemo(() => {
    if (!result || !monster || result.monsterId !== monster.id) return null;
    const best = result.styles.find((s) => s.styleGroup === result.bestStyle)?.best;
    return best ? best.metric : null;
  }, [result, monster]);

  useEffect(() => {
    const base = buildBaseRequest(store);
    if (!base || gear.weapon === undefined) {
      setSetup(null);
      return;
    }
    const [styleName, styleStance] = gearStyle ? gearStyle.split('|') : [undefined, undefined];
    const loadout: GearLoadout = {
      items: gear, styleName, styleStance, dartName: gearDart || undefined,
    };
    evalSeq.current += 1;
    const seq = evalSeq.current;
    runEvaluate({ ...base, loadout })
      .then((r) => { if (seq === evalSeq.current) setSetup(r); })
      .catch(() => { if (seq === evalSeq.current) setSetup(null); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gear, gearStyle, gearDart, monster?.id, monster?.version, store.skills, store.slayerLevel,
    store.potionPreset, store.usePrayers, store.onSlayerTask, store.toaInvocationLevel,
    store.partySize, mode, store.trainedSkill, store.downtimeSeconds, store.prices]);

  const loadBest = () => {
    const best = result?.styles.find((s) => s.styleGroup === result.bestStyle)?.best;
    if (!best) return;
    const items: Partial<Record<string, number>> = {};
    for (const [slot, item] of Object.entries(best.items)) {
      if (item) items[slot] = item.id;
    }
    const dart = best.items.weapon?.detail;
    set({ gear: items, gearStyle: '', gearDart: dart && DART_NAMES.includes(dart) ? dart : '' });
  };

  const deltaPct = setup && bestMetric ? ((setup.metric - bestMetric) / bestMetric) * 100 : null;

  return (
    <div className="bg-panel border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        className="w-full px-3 py-2 flex items-center gap-2 text-left"
        onClick={() => setOpen(!open)}
      >
        <span className="text-sm font-semibold text-gold flex-1">Your current gear</span>
        {setup && (
          <span className="tabular-nums text-sm">
            {fmtMetric(setup.metric, training)} {training ? 'xp/hr' : 'dps'}
          </span>
        )}
        {deltaPct !== null && (
          <span className={clsx('tabular-nums text-xs', deltaPct >= -0.05 ? 'text-emerald-400' : deltaPct > -10 ? 'text-amber-400' : 'text-red-400')}>
            {deltaPct >= -0.05 ? 'matches best' : `${deltaPct.toFixed(1)}% vs best`}
          </span>
        )}
        <span className="text-muted text-xs">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-border/40 pt-2">
          {!monster && <div className="text-sm text-muted">Pick a target to evaluate against.</div>}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
            {SLOT_ORDER.map((slot) => (
              <SlotPicker
                key={slot}
                slot={slot}
                itemId={gear[slot]}
                disabled={slot === 'shield' && weapon?.isTwoHanded}
                ownedIds={ownedSet}
                onPick={(i) => set({ gear: { ...gear, [slot]: i.id }, ...(slot === 'weapon' ? { gearStyle: '' } : {}) })}
                onClear={() => {
                  const next = { ...gear };
                  delete next[slot];
                  set({ gear: next, ...(slot === 'weapon' ? { gearStyle: '' } : {}) });
                }}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            {styles.length > 0 && (
              <select
                className="bg-panel-2 border border-border rounded px-2 py-1 outline-none focus:border-gold"
                value={gearStyle}
                onChange={(e) => set({ gearStyle: e.target.value })}
              >
                <option value="">Style: auto (best)</option>
                {styles.map((s) => (
                  <option key={`${s.name}|${s.stance}`} value={`${s.name}|${s.stance}`}>
                    {s.name} ({s.stance})
                  </option>
                ))}
              </select>
            )}
            {isBlowpipe && (
              <select
                className="bg-panel-2 border border-border rounded px-2 py-1 outline-none focus:border-gold"
                value={gearDart || DART_NAMES[0]}
                onChange={(e) => set({ gearDart: e.target.value })}
              >
                {DART_NAMES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
            <div className="flex-1" />
            {result && bestMetric !== null && (
              <button type="button" className="text-xs text-muted hover:text-gold" onClick={loadBest}>
                load best found
              </button>
            )}
            {Object.keys(gear).length > 0 && (
              <button type="button" className="text-xs text-muted hover:text-red-400" onClick={() => set({ gear: {}, gearStyle: '', gearDart: '' })}>
                clear
              </button>
            )}
          </div>

          {setup && (
            <>
              {setup.combo && (
                <div className="flex items-center gap-2 text-sm text-gold" title={setup.combo.note}>
                  <span className="bg-gold/10 border border-gold/40 rounded px-2 py-0.5 font-semibold">Full set</span>
                  <span className="font-semibold">{setup.combo.name}</span>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {training && setup.xpHr !== null && <StatChip label="XP/hr" value={fmtNum(setup.xpHr)} />}
                <StatChip label="DPS" value={setup.dps.toFixed(3)} />
                <StatChip label="Max hit" value={String(setup.maxHit)} />
                <StatChip label="Accuracy" value={`${(setup.accuracy * 100).toFixed(1)}%`} />
                <StatChip label="TTK" value={`${setup.ttk.toFixed(1)}s`} />
                <StatChip label="Speed" value={`${setup.attackSpeed}t`} />
                {setup.dmgTakenHr !== null && <StatChip label="Dmg taken/hr" value={fmtNum(setup.dmgTakenHr)} />}
                {setup.costHr !== null && <StatChip label="Cost/hr" value={fmtGp(setup.costHr)} title={setup.costParts.join(', ')} />}
              </div>
              <div className="text-xs text-muted">
                {setup.styleName} ({setup.styleStance})
                {setup.spellName ? ` - ${setup.spellName}` : ''}
                {gearStyle === '' ? ' - auto-picked' : ''}
              </div>
            </>
          )}
          {!setup && monster && gear.weapon !== undefined && (
            <div className="text-sm text-muted">This loadout cannot attack the target with any usable style.</div>
          )}
          {monster && gear.weapon === undefined && (
            <div className="text-sm text-muted">Pick at least a weapon.</div>
          )}
        </div>
      )}
    </div>
  );
}
