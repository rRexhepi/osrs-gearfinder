import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { EquipmentPiece } from '@/types/Player';
import { getCombatStylesForCategory } from '@/utils';
import { BLOWPIPE_IDS } from '@/lib/constants';
import { searchEquipment } from '@/solver/ownership';
import { canonicalIdOf, DART_NAMES, itemById } from '@/solver/data';
import { GearLoadout, SolvedSetup, StyleGroup } from '@/solver/types';
import { fmtGp, fmtMetric, fmtNum } from '@/format';
import { runEvaluate } from '@/worker-client';
import {
  buildBaseRequest, EMPTY_GEAR_SET, GearSet, useStore,
} from '@/store';
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

const GEAR_TABS: StyleGroup[] = ['melee', 'ranged', 'magic'];

export default function GearPanel() {
  const store = useStore();
  const {
    monster, gearSets, gearTab, preferredStyle, ownedIds, hasImportedBank, result, mode, set,
  } = store;
  const [open, setOpen] = useState(false);
  const [setup, setSetup] = useState<SolvedSetup | null>(null);
  const evalSeq = useRef(0);

  // the Fight-with choice decides which of your gear sets is in front
  useEffect(() => {
    if (preferredStyle) set({ gearTab: preferredStyle });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredStyle]);

  const gearSet = gearSets[gearTab] ?? EMPTY_GEAR_SET;
  const patchSet = (patch: Partial<GearSet>) => set({
    gearSets: { ...gearSets, [gearTab]: { ...gearSet, ...patch } },
  });

  const training = mode === 'training';
  const weapon = gearSet.items.weapon !== undefined ? itemById.get(gearSet.items.weapon) : undefined;
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

  // compare against the best of the style this loadout actually fights with
  const styleBest = useMemo(() => {
    if (!result || !monster || result.monsterId !== monster.id || !setup) return null;
    return result.styles.find((s) => s.styleGroup === setup.styleGroup)?.best ?? null;
  }, [result, monster, setup]);

  useEffect(() => {
    const base = buildBaseRequest(store);
    if (!base || gearSet.items.weapon === undefined) {
      setSetup(null);
      return;
    }
    const [styleName, styleStance] = gearSet.style ? gearSet.style.split('|') : [undefined, undefined];
    const loadout: GearLoadout = {
      items: gearSet.items, styleName, styleStance, dartName: gearSet.dart || undefined,
    };
    evalSeq.current += 1;
    const seq = evalSeq.current;
    runEvaluate({ ...base, loadout })
      .then((r) => { if (seq === evalSeq.current) setSetup(r); })
      .catch(() => { if (seq === evalSeq.current) setSetup(null); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gearSet, monster?.id, monster?.version, store.skills, store.slayerLevel,
    store.potionPreset, store.usePrayers, store.onSlayerTask, store.toaInvocationLevel,
    store.partySize, mode, store.trainedSkill, store.downtimeSeconds, store.prices]);

  // best found for the set's style, for the load button
  const tabBest = result && monster && result.monsterId === monster.id
    ? result.styles.find((s) => s.styleGroup === gearTab)?.best ?? null
    : null;

  const loadBest = () => {
    if (!tabBest) return;
    const items: Partial<Record<string, number>> = {};
    for (const [slot, item] of Object.entries(tabBest.items)) {
      if (item) items[slot] = item.id;
    }
    const dart = tabBest.items.weapon?.detail;
    patchSet({ items, style: '', dart: dart && DART_NAMES.includes(dart) ? dart : '' });
  };

  const deltaPct = setup && styleBest ? ((setup.metric - styleBest.metric) / styleBest.metric) * 100 : null;

  return (
    <div className="bg-panel border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        className="w-full px-3 py-2 flex items-center gap-2 text-left"
        onClick={() => setOpen(!open)}
      >
        <span className="text-sm font-semibold text-gold">Your current gear</span>
        <span className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          {GEAR_TABS.map((g) => (
            <span
              key={g}
              role="button"
              tabIndex={0}
              className={clsx(
                'px-2 py-0.5 rounded text-xs border capitalize cursor-pointer',
                g === gearTab ? 'bg-gold/10 border-gold/40 text-gold' : 'border-border text-muted hover:text-parchment',
              )}
              onClick={() => set({ gearTab: g })}
              onKeyDown={(e) => { if (e.key === 'Enter') set({ gearTab: g }); }}
            >
              {g}
            </span>
          ))}
        </span>
        <span className="flex-1" />
        {setup && (
          <span className="tabular-nums text-sm">
            {fmtMetric(setup.metric, training)} {training ? 'xp/hr' : 'dps'}
          </span>
        )}
        {deltaPct !== null && setup && (
          <span className={clsx('tabular-nums text-xs', deltaPct >= -0.05 ? 'text-emerald-400' : deltaPct > -10 ? 'text-amber-400' : 'text-red-400')}>
            {Math.abs(deltaPct) <= 0.05 ? `matches best ${setup.styleGroup}`
              : `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}% vs best ${setup.styleGroup}`}
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
                key={`${gearTab}-${slot}`}
                slot={slot}
                itemId={gearSet.items[slot]}
                disabled={slot === 'shield' && weapon?.isTwoHanded}
                ownedIds={ownedSet}
                onPick={(i) => patchSet({
                  items: { ...gearSet.items, [slot]: i.id },
                  ...(slot === 'weapon' ? { style: '' } : {}),
                })}
                onClear={() => {
                  const items = { ...gearSet.items };
                  delete items[slot];
                  patchSet({ items, ...(slot === 'weapon' ? { style: '' } : {}) });
                }}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            {styles.length > 0 && (
              <select
                className="bg-panel-2 border border-border rounded px-2 py-1 outline-none focus:border-gold"
                value={gearSet.style}
                onChange={(e) => patchSet({ style: e.target.value })}
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
                value={gearSet.dart || DART_NAMES[0]}
                onChange={(e) => patchSet({ dart: e.target.value })}
              >
                {DART_NAMES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
            <div className="flex-1" />
            {tabBest && (
              <button type="button" className="text-xs text-muted hover:text-gold" onClick={loadBest}>
                load best {gearTab}
              </button>
            )}
            {Object.keys(gearSet.items).length > 0 && (
              <button type="button" className="text-xs text-muted hover:text-red-400" onClick={() => patchSet({ items: {}, style: '', dart: '' })}>
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
                {gearSet.style === '' ? ' - auto-picked' : ''}
              </div>
            </>
          )}
          {!setup && monster && gearSet.items.weapon !== undefined && (
            <div className="text-sm text-muted">This loadout cannot attack the target with any usable style.</div>
          )}
          {monster && gearSet.items.weapon === undefined && (
            <div className="text-sm text-muted">Pick at least a weapon for your {gearTab} set.</div>
          )}
        </div>
      )}
    </div>
  );
}
