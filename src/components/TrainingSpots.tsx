import { getWikiImage } from '@/utils';
import { TRAINED_SKILL_LABELS } from '@/solver/xp';
import { fmtNum } from '@/format';
import { useStore } from '@/store';

export default function TrainingSpots() {
  const { spots, trainedSkill, set } = useStore();
  if (!spots) {
    return (
      <div className="text-muted text-sm bg-panel border border-border rounded-lg p-4">
        Hit <span className="text-gold">Rank training spots</span> to compare common training
        monsters by {TRAINED_SKILL_LABELS[trainedSkill]} XP/hr with your
        settings and items. Kill rates assume constant combat with your configured downtime
        between kills; real rates depend on spawns and aggro.
      </div>
    );
  }
  return (
    <div className="bg-panel border border-border rounded-lg overflow-hidden">
      <div className="px-3 py-2 text-sm font-semibold text-gold border-b border-border">
        Training spots by {TRAINED_SKILL_LABELS[spots.trainedSkill]} XP/hr
      </div>
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
            {spots.rows.map((r) => (
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
                    <span>{r.monsterName}</span>
                  </button>
                </td>
                <td className="text-right pr-2 tabular-nums font-semibold text-gold">{fmtNum(r.xpHr)}</td>
                <td className="text-right pr-2 tabular-nums">{r.dps.toFixed(2)}</td>
                <td className="text-right pr-2 tabular-nums">{r.ttk.toFixed(0)}s</td>
                <td className="text-right pr-2 tabular-nums">{r.dmgTakenHr !== null ? fmtNum(r.dmgTakenHr) : '-'}</td>
                <td className="text-right pr-2 tabular-nums">{r.foodHr !== null ? r.foodHr.toFixed(0) : '-'}</td>
                <td className="pr-2 truncate max-w-44">{r.weaponName} <span className="text-muted text-xs">({r.styleStance})</span></td>
                <td className="pr-3 text-muted text-xs">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
