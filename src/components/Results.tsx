import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  SlotAlternative, SolvedSetup, StyleGroup, StyleResult, UpgradeSuggestion,
} from '@/solver/types';
import { fmtGp, fmtMetric } from '@/format';
import { useStore } from '@/store';
import {
  iconUrl, OwnedDot, SetupCard, SLOT_LABELS, SLOT_ORDER,
} from './shared';

function AltTable({ slot, alts, training }: { slot: string; alts: SlotAlternative[]; training: boolean }) {
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
              <td className="py-1 pr-2 text-right tabular-nums w-16">{fmtMetric(a.metric, training)}</td>
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

function CombosCard({ combos, best, training }: { combos: SolvedSetup[]; best: SolvedSetup; training: boolean }) {
  const [openName, setOpenName] = useState<string | null>(null);
  return (
    <div className="bg-panel border border-border rounded-lg overflow-hidden">
      <div className="px-3 py-2 text-sm font-semibold text-gold border-b border-border">Full-set combos</div>
      <div>
        {combos.map((c) => {
          const deltaPct = ((c.metric - best.metric) / best.metric) * 100;
          const isBest = deltaPct >= -0.05;
          const open = openName === c.combo!.name;
          return (
            <div key={c.combo!.name} className="border-b border-border/40 last:border-0">
              <button
                type="button"
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-panel-2/50"
                title={c.combo!.note}
                onClick={() => setOpenName(open ? null : c.combo!.name)}
              >
                {c.items.weapon && <img src={iconUrl(c.items.weapon.image)} alt="" className="w-5 h-5 object-contain shrink-0" loading="lazy" />}
                <span className="font-semibold truncate">{c.combo!.name}</span>
                <span className="text-muted text-xs truncate flex-1">
                  {c.items.weapon?.name}
                  {c.spellName ? ` (${c.spellName})` : c.items.weapon?.detail ? ` (${c.items.weapon.detail})` : ''}
                </span>
                <span className="tabular-nums">{fmtMetric(c.metric, training)}</span>
                <span className={clsx('tabular-nums text-xs w-14 text-right', isBest ? 'text-emerald-400' : deltaPct > -10 ? 'text-amber-400' : 'text-red-400')}>
                  {isBest ? 'best' : `${deltaPct.toFixed(1)}%`}
                </span>
                <span className="text-muted text-xs w-3">{open ? '▾' : '▸'}</span>
              </button>
              {open && <div className="px-3 pb-3"><SetupCard setup={c} training={training} /></div>}
            </div>
          );
        })}
      </div>
      <div className="px-3 py-1 text-[10px] text-muted border-t border-border/40">
        Set effects evaluated as locked bundles with the remaining slots optimised - the per-slot tables can't discover these.
      </div>
    </div>
  );
}

function Upgrades({ upgrades, training }: { upgrades: UpgradeSuggestion[]; training: boolean }) {
  const { preferredStyle } = useStore();
  const [byValue, setByValue] = useState(false);
  const sorted = useMemo(
    () => [...upgrades].sort((a, b) => {
      // the style the user chose to fight with shops first
      if (preferredStyle) {
        const pref = (u: UpgradeSuggestion) => (u.styleGroup === preferredStyle ? 1 : 0);
        if (pref(a) !== pref(b)) return pref(b) - pref(a);
      }
      return byValue ? (b.gainPerM ?? -1) - (a.gainPerM ?? -1) : b.gainPct - a.gainPct;
    }),
    [upgrades, byValue, preferredStyle],
  );
  if (upgrades.length === 0) return null;
  return (
    <div className="bg-panel border border-gold/40 rounded-lg overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between border-b border-border">
        <span className="text-sm font-semibold text-gold">Upgrade advisor - biggest gains over your bank</span>
        <button
          type="button"
          className="text-xs text-muted hover:text-parchment"
          onClick={() => setByValue(!byValue)}
        >
          sort: {byValue ? 'value (gain per gp)' : 'raw gain'}
        </button>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {sorted.slice(0, 12).map((u) => (
            <tr key={`${u.name}-${u.styleGroup}`} className="border-b border-border/40 last:border-0">
              <td className="pl-3 py-1 w-8"><img src={iconUrl(u.image)} alt="" className="w-5 h-5 object-contain" loading="lazy" /></td>
              <td className="py-1 pr-2">
                {u.name}
                {u.detail ? <span className="text-muted text-xs"> ({u.detail})</span> : null}
                <span className="text-muted text-xs"> - {SLOT_LABELS[u.slot] ?? u.slot}, {u.styleGroup}</span>
              </td>
              <td className="py-1 pr-2 text-right tabular-nums text-emerald-400 w-20">+{u.gainPct.toFixed(1)}%</td>
              <td className="py-1 pr-2 text-right tabular-nums w-24">{u.price !== null ? fmtGp(u.price) : <span className="text-muted text-xs">untradeable</span>}</td>
              <td className="py-1 pr-3 text-right tabular-nums text-muted text-xs w-28">{u.gainPerM !== null ? `${u.gainPerM.toFixed(2)}%/m gp` : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-3 py-1 text-[10px] text-muted border-t border-border/40">
        {training ? 'Gain in XP/hr' : 'Gain in DPS'} if swapped into your best owned setup. GE mid prices.
      </div>
    </div>
  );
}

function StyleSection({ style, training }: { style: StyleResult; training: boolean }) {
  if (style.immune || !style.best) {
    return (
      <div className="text-muted text-sm bg-panel border border-border rounded-lg p-4">
        No usable {style.styleGroup} setup {training ? 'trains this skill here' : 'can damage this monster'} (immunity, or no eligible weapon).
      </div>
    );
  }
  const altSlots = SLOT_ORDER.filter((s) => (style.alternatives[s]?.length ?? 0) > 0);
  return (
    <div className="space-y-4">
      <SetupCard setup={style.best} training={training} />
      {style.setups.length > 1 && (
        <div className="bg-panel border border-border rounded-lg p-3">
          <div className="text-sm font-semibold text-gold mb-1.5">Other optimised setups</div>
          <div className="space-y-1">
            {style.setups.slice(1).map((s) => (
              <div key={`${s.items.weapon?.id}-${s.spellName ?? ''}-${s.styleStance}-${s.combo?.name ?? ''}`} className="flex items-center gap-2 text-sm">
                {s.items.weapon && <img src={iconUrl(s.items.weapon.image)} alt="" className="w-5 h-5 object-contain" loading="lazy" />}
                <span className="flex-1 truncate">
                  {s.items.weapon?.name}
                  {s.spellName ? ` (${s.spellName})` : s.items.weapon?.detail ? ` (${s.items.weapon.detail})` : ''}
                  {s.combo && <span className="text-gold text-xs"> - {s.combo.name}</span>}
                </span>
                <span className="tabular-nums text-muted">
                  {fmtMetric(s.metric, training)} {training ? 'xp/hr' : 'dps'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {style.combos.length > 0 && <CombosCard combos={style.combos} best={style.best} training={training} />}
      <div>
        <div className="text-sm font-semibold text-gold mb-2">Next best per slot</div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {altSlots.map((slot) => <AltTable key={slot} slot={slot} alts={style.alternatives[slot]!} training={training} />)}
        </div>
      </div>
    </div>
  );
}

export default function Results() {
  const { result, preferredStyle } = useStore();
  const [tab, setTab] = useState<StyleGroup | null>(null);

  // picking a "Fight with" style discards any tab clicked within the old choice
  useEffect(() => setTab(null), [preferredStyle]);

  const active: StyleGroup | null = useMemo(() => {
    if (!result) return null;
    if (tab && result.styles.some((s) => s.styleGroup === tab)) return tab;
    if (preferredStyle && result.styles.some((s) => s.styleGroup === preferredStyle && s.best !== null)) {
      return preferredStyle;
    }
    return result.bestStyle ?? result.styles[0]?.styleGroup ?? null;
  }, [result, tab, preferredStyle]);

  if (!result) {
    return (
      <div className="text-muted text-sm mt-12 text-center">
        Pick a target, set up your stats and bank, then hit <span className="text-gold">Find gear</span>.
      </div>
    );
  }

  const training = result.mode === 'training';
  const activeStyle = result.styles.find((s) => s.styleGroup === active);
  // the suggested way to fight leads; the other styles follow by their rate
  const orderedStyles = [...result.styles].sort((a, b) => (b.best?.metric ?? 0) - (a.best?.metric ?? 0));

  return (
    <div className="space-y-4">
      {result.upgrades && result.upgrades.length > 0 && <Upgrades upgrades={result.upgrades} training={training} />}
      <div className="flex gap-1">
        {orderedStyles.map((s) => (
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
            {s.best ? <span className="ml-1.5 tabular-nums text-xs">{fmtMetric(s.best.metric, training)}</span> : <span className="ml-1.5 text-xs">-</span>}
            {result.bestStyle === s.styleGroup && <span className="ml-1 text-gold">★</span>}
          </button>
        ))}
      </div>
      {activeStyle && <StyleSection style={activeStyle} training={training} />}
    </div>
  );
}
