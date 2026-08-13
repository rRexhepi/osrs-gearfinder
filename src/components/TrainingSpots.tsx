import { Fragment, useState } from 'react';
import clsx from 'clsx';
import { getWikiImage } from '@/utils';
import { TRAINED_SKILL_LABELS } from '@/solver/xp';
import { SpotGroup, SpotStylesResult, TargetRow } from '@/solver/types';
import { fmtNum } from '@/format';
import { runSpotStyles } from '@/worker-client';
import { buildBaseRequest, useStore } from '@/store';
import { SetupCard } from './shared';

const GROUP_TABS: { group: SpotGroup; label: string }[] = [
  { group: 'spots', label: 'Spots' },
  { group: 'crab', label: 'Gemstone crab' },
  { group: 'nmz', label: 'Nightmare Zone' },
];

const GROUP_NOTES: Record<SpotGroup, string | null> = {
  spots: null,
  crab: 'The crab never dies - XP/hr is pure damage uptime, no kill downtime.',
  nmz: 'Hard-mode rumble bosses, constant spawns. Assumes the absorption method at 1 HP, so Dharok\'s is credited in full. Ignore damage taken/food - absorptions cover it.',
};

/** the "(Nightmare Zone)" suffix is data plumbing, not display */
const displayName = (name: string) => name.replace(' (Nightmare Zone)', '');

/** every way to fight one spot: suggested style first, the others clickable */
function StyleBreakdown({ styles }: { styles: SpotStylesResult }) {
  const usable = styles.rows.filter((r) => r.best !== null);
  const [pick, setPick] = useState(0);
  if (usable.length === 0) {
    return <div className="text-sm text-muted px-1 py-2">No usable setup for any style here with your items.</div>;
  }
  const active = usable[Math.min(pick, usable.length - 1)];
  return (
    <div className="space-y-2 py-2">
      <div className="flex gap-1 flex-wrap">
        {usable.map((r, ix) => (
          <button
            key={r.styleGroup}
            type="button"
            className={clsx(
              'px-2 py-1 rounded text-xs border capitalize',
              r === active ? 'bg-gold/10 border-gold/40 text-gold' : 'border-border text-muted hover:text-parchment',
            )}
            onClick={() => setPick(ix)}
          >
            {ix === 0 && <span className="mr-1">★</span>}
            {r.styleGroup}
            <span className="ml-1.5 tabular-nums">{fmtNum(r.best!.metric)}</span>
            <span className="ml-1 lowercase">{TRAINED_SKILL_LABELS[r.skill]} xp/hr</span>
          </button>
        ))}
      </div>
      <SetupCard setup={active.best!} training />
    </div>
  );
}

export default function TrainingSpots() {
  const store = useStore();
  const { spots, trainedSkill, set } = store;
  const [tab, setTab] = useState<SpotGroup>('spots');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [styleCache, setStyleCache] = useState<Record<string, SpotStylesResult | 'loading'>>({});

  if (!spots) {
    return (
      <div className="text-muted text-sm bg-panel border border-border rounded-lg p-4">
        Hit <span className="text-gold">Rank training spots</span> to compare common training
        monsters, the gemstone crab, and NMZ bosses by {TRAINED_SKILL_LABELS[trainedSkill]} XP/hr
        with your settings and items. Kill rates assume constant combat with your configured
        downtime between kills; real rates depend on spawns and aggro.
      </div>
    );
  }
  const rows = spots.rows.filter((r) => r.group === tab);
  const note = GROUP_NOTES[tab];

  const rowKey = (r: TargetRow) => `${r.monsterId}|${r.monsterVersion}`;
  const toggleStyles = (r: TargetRow) => {
    const key = rowKey(r);
    if (expanded === key) {
      setExpanded(null);
      return;
    }
    setExpanded(key);
    if (styleCache[key]) return;
    const request = buildBaseRequest(store, {
      id: r.monsterId, name: r.monsterName, version: r.monsterVersion, image: r.monsterImage,
    });
    if (!request) return;
    setStyleCache((c) => ({ ...c, [key]: 'loading' }));
    runSpotStyles(request, r.group)
      .then((res) => setStyleCache((c) => ({ ...c, [key]: res })))
      .catch(() => setStyleCache((c) => {
        const next = { ...c };
        delete next[key];
        return next;
      }));
  };

  return (
    <div className="bg-panel border border-border rounded-lg overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between gap-2 border-b border-border">
        <span className="text-sm font-semibold text-gold">
          Training by {TRAINED_SKILL_LABELS[spots.trainedSkill]} XP/hr
        </span>
        <div className="flex gap-1">
          {GROUP_TABS.map((t) => (
            <button
              key={t.group}
              type="button"
              className={clsx(
                'px-2 py-0.5 rounded text-xs border',
                t.group === tab ? 'bg-gold/10 border-gold/40 text-gold' : 'border-border text-muted hover:text-parchment',
              )}
              onClick={() => setTab(t.group)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="px-3 py-3 text-sm text-muted">
          No usable setup trains {TRAINED_SKILL_LABELS[spots.trainedSkill]} here with your items.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted text-xs uppercase border-b border-border/60">
                <th className="text-left pl-3 py-1.5 font-normal">Monster</th>
                <th className="text-right pr-2 font-normal">XP/hr</th>
                <th className="text-right pr-2 font-normal">DPS</th>
                <th className="text-right pr-2 font-normal">TTK</th>
                <th className="text-right pr-2 font-normal">Dmg taken/hr</th>
                <th className="text-right pr-2 font-normal">Food/hr</th>
                <th className="text-left pr-2 font-normal">With</th>
                <th className="text-left pr-2 font-normal">Notes</th>
                <th className="pr-3 font-normal text-right">Styles</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = rowKey(r);
                const cached = styleCache[key];
                return (
                  <Fragment key={key}>
                    <tr className="border-b border-border/40 last:border-0 hover:bg-panel-2/60">
                      <td className="pl-3 py-1">
                        <button
                          type="button"
                          className="flex items-center gap-2 hover:text-gold"
                          title="Use this monster as the target"
                          onClick={() => set({
                            monster: {
                              id: r.monsterId, name: r.monsterName, version: r.monsterVersion, image: r.monsterImage,
                            },
                          })}
                        >
                          {r.monsterImage ? <img src={getWikiImage(r.monsterImage)} alt="" className="w-6 h-6 object-contain" loading="lazy" /> : null}
                          <span>{displayName(r.monsterName)}</span>
                        </button>
                      </td>
                      <td className="text-right pr-2 tabular-nums font-semibold text-gold">{fmtNum(r.xpHr)}</td>
                      <td className="text-right pr-2 tabular-nums">{r.dps.toFixed(2)}</td>
                      <td className="text-right pr-2 tabular-nums">{Number.isFinite(r.ttk) ? `${r.ttk.toFixed(0)}s` : '-'}</td>
                      <td className="text-right pr-2 tabular-nums">{r.dmgTakenHr !== null ? fmtNum(r.dmgTakenHr) : '-'}</td>
                      <td className="text-right pr-2 tabular-nums">{r.foodHr !== null ? r.foodHr.toFixed(0) : '-'}</td>
                      <td className="pr-2 truncate max-w-44">{r.weaponName} <span className="text-muted text-xs">({r.styleStance})</span></td>
                      <td className="pr-2 text-muted text-xs">{r.note}</td>
                      <td className="pr-3 text-right">
                        <button
                          type="button"
                          className="text-xs text-muted hover:text-gold whitespace-nowrap"
                          title="Best setup per combat style"
                          onClick={() => toggleStyles(r)}
                        >
                          {expanded === key ? '▾' : '▸'}
                        </button>
                      </td>
                    </tr>
                    {expanded === key && (
                      <tr className="border-b border-border/40 last:border-0">
                        <td colSpan={9} className="px-3 bg-panel-2/30">
                          {cached === 'loading' || !cached
                            ? <div className="text-sm text-muted py-2">working out every style...</div>
                            : <StyleBreakdown styles={cached} />}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {note && <div className="px-3 py-1.5 text-[10px] text-muted border-t border-border/40">{note}</div>}
    </div>
  );
}
