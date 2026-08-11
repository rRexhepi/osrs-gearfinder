import { useState } from 'react';
import clsx from 'clsx';
import { getWikiImage } from '@/utils';
import { TRAINED_SKILL_LABELS } from '@/solver/xp';
import { SpotGroup } from '@/solver/types';
import { fmtNum } from '@/format';
import { useStore } from '@/store';

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

export default function TrainingSpots() {
  const { spots, trainedSkill, set } = useStore();
  const [tab, setTab] = useState<SpotGroup>('spots');
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
                <th className="text-left pr-3 font-normal">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.monsterId}-${r.monsterVersion}`} className="border-b border-border/40 last:border-0 hover:bg-panel-2/60">
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
                  <td className="pr-3 text-muted text-xs">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {note && <div className="px-3 py-1.5 text-[10px] text-muted border-t border-border/40">{note}</div>}
    </div>
  );
}
