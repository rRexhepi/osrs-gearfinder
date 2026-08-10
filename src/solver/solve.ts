import { EquipmentPiece, PlayerEquipment } from '@/types/Player';
import { Monster } from '@/types/Monster';
import { PlayerCombatStyle, CombatStyleType } from '@/types/PlayerCombatStyle';
import { Spell, spellByName } from '@/types/Spell';
import { MonsterAttribute } from '@/enums/MonsterAttribute';
import { getCombatStylesForCategory } from '@/utils';
import { AmmoApplicability, ammoApplicability } from '@/lib/Equipment';
import { BLOWPIPE_IDS } from '@/lib/constants';
import { EquipmentCategory } from '@/enums/EquipmentCategory';
import PlayerVsNPCCalc from '@/lib/PlayerVsNPCCalc';
import {
  ANCIENT_AUTOCAST_WEAPONS,
  DART_NAMES,
  IBAN_BLAST_WEAPONS,
  MAGIC_DART_WEAPONS,
  POWERED_CATEGORIES,
  Slot,
  SLOTS,
  canonicalIdOf,
  dartByName,
  equipmentBySlot,
  isGauntletItem,
  isModeRestricted,
  isSpecialItem,
} from './data';
import { CORRUPTED_GAUNTLET_MONSTER_IDS, GAUNTLET_MONSTER_IDS } from '@/lib/constants';
import {
  LoadoutConfig,
  blowpipeWithDart,
  bestStandardSpell,
  buildMonster,
  buildPlayer,
  styleGroupOf,
} from './loadout';
import {
  ResultItem,
  SlotAlternative,
  SolveRequest,
  SolveResult,
  SolvedSetup,
  StyleGroup,
  StyleResult,
} from './types';

const ARMOUR_SLOTS: Slot[] = ['head', 'body', 'legs', 'neck', 'cape', 'hands', 'feet', 'ring', 'shield', 'ammo'];

interface WeaponVariant {
  weapon: EquipmentPiece;
  style: PlayerCombatStyle;
  spell: Spell | null;
  group: StyleGroup;
}

interface OptimisedEntry {
  v: WeaponVariant;
  eq: Partial<PlayerEquipment>;
  style: PlayerCombatStyle;
  setup: SolvedSetup;
}

type ProgressFn = (pct: number, label: string) => void;

const offensiveDim = (item: EquipmentPiece, t: CombatStyleType): number => {
  if (!t) return 0;
  return item.offensive[t] ?? 0;
};

const strengthDim = (item: EquipmentPiece, t: CombatStyleType): number => {
  if (t === 'ranged') return item.bonuses.ranged_str;
  if (t === 'magic') return item.bonuses.magic_str;
  return item.bonuses.str;
};

export class Solver {
  private cfg: LoadoutConfig;

  private monster: Monster;

  private request: SolveRequest;

  /** canonicalised owned ids (badge display); null = no bank imported */
  private owned: Set<number> | null;

  /** when true, unowned items are excluded from the search entirely */
  private restrictToOwned: boolean;

  private excluded: Set<number>;

  private memo = new Map<string, number>();

  private candidateCache = new Map<string, EquipmentPiece[]>();

  /** gauntlet-only items are allowed only against the Hunllef */
  private inGauntlet: boolean;

  private loggedEvalError = false;

  evals = 0;

  constructor(request: SolveRequest) {
    this.request = request;
    this.cfg = {
      skills: request.skills,
      potionPreset: request.potionPreset,
      usePrayers: request.usePrayers,
      onSlayerTask: request.onSlayerTask,
    };
    this.monster = buildMonster(request.monsterId, request.monsterVersion, request.monsterInputs);
    this.inGauntlet = GAUNTLET_MONSTER_IDS.includes(this.monster.id)
      || CORRUPTED_GAUNTLET_MONSTER_IDS.includes(this.monster.id);
    this.owned = request.ownedIds === null ? null : new Set(request.ownedIds.map(canonicalIdOf));
    this.restrictToOwned = request.restrictToOwned && this.owned !== null;
    this.excluded = new Set(request.excludedIds.map(canonicalIdOf));
  }

  private isAllowed(item: EquipmentPiece): boolean {
    if (this.excluded.has(item.id)) return false;
    if (isModeRestricted(item)) return false;
    if (isGauntletItem(item) && !this.inGauntlet) return false;
    if (!this.restrictToOwned) return true;
    return this.owned!.has(item.id);
  }

  /** all allowed items for a slot, without stat pruning */
  private allowedForSlot(slot: Slot): EquipmentPiece[] {
    const key = `all|${slot}`;
    let list = this.candidateCache.get(key);
    if (!list) {
      list = equipmentBySlot(slot).filter((i) => this.isAllowed(i));
      this.candidateCache.set(key, list);
    }
    return list;
  }

  /**
   * Candidates worth trying for a slot given an attack type. In "all items" mode
   * this prunes to the pareto frontier over (attack bonus, strength bonus, prayer)
   * plus special-effect items; owned mode keeps everything the player has.
   */
  private candidatesFor(slot: Slot, t: CombatStyleType): EquipmentPiece[] {
    const key = `${slot}|${t}`;
    const cached = this.candidateCache.get(key);
    if (cached) return cached;

    const all = this.allowedForSlot(slot);
    let result: EquipmentPiece[];
    if (this.restrictToOwned && all.length <= 80) {
      result = all;
    } else {
      const statsy = all.filter((i) => isSpecialItem(i)
        || offensiveDim(i, t) > 0 || strengthDim(i, t) > 0 || i.bonuses.prayer > 0);
      const dims = (i: EquipmentPiece) => [offensiveDim(i, t), strengthDim(i, t), i.bonuses.prayer];
      result = statsy.filter((i) => {
        if (isSpecialItem(i)) return true;
        const di = dims(i);
        return !statsy.some((j) => {
          if (j === i) return false;
          const dj = dims(j);
          return dj[0] >= di[0] && dj[1] >= di[1] && dj[2] >= di[2]
            && (dj[0] > di[0] || dj[1] > di[1] || dj[2] > di[2]);
        });
      });
    }
    this.candidateCache.set(key, result);
    return result;
  }

  private loadoutKey(eq: Partial<PlayerEquipment>, style: PlayerCombatStyle, spell: Spell | null): string {
    const ids = SLOTS.map((s) => eq[s]?.id ?? 0).join(',');
    const dart = eq.weapon?.itemVars?.blowpipeDartId ?? 0;
    return `${ids}|${dart}|${style.name}|${style.stance}|${spell?.name ?? ''}`;
  }

  private dps(eq: Partial<PlayerEquipment>, style: PlayerCombatStyle, spell: Spell | null): number {
    const key = this.loadoutKey(eq, style, spell);
    const cached = this.memo.get(key);
    if (cached !== undefined) return cached;
    let dps = 0;
    try {
      const player = buildPlayer(this.cfg, this.monster, eq, style, spell);
      const calc = new PlayerVsNPCCalc(player, this.monster, { loadoutName: 'solver' });
      dps = calc.getDps();
      if (!Number.isFinite(dps)) dps = 0;
    } catch (err) {
      if (!this.loggedEvalError) {
        this.loggedEvalError = true;
        // eslint-disable-next-line no-console
        console.warn('[solver] loadout eval failed (first occurrence)', err);
      }
      dps = 0;
    }
    this.evals += 1;
    this.memo.set(key, dps);
    return dps;
  }

  /** enumerate (weapon, style, spell) variants for a style group */
  private weaponVariants(group: StyleGroup): WeaponVariant[] {
    const out: WeaponVariant[] = [];
    const magicLevel = this.cfg.skills.magic;

    for (const weapon of this.allowedForSlot('weapon')) {
      // novelty/unknown weapons carry speed -1 in the data, which the engine
      // clamps to 1 tick and turns into nonsense DPS
      if (weapon.speed <= 0) continue;
      const styles = getCombatStylesForCategory(weapon.category);
      const isSalamander = weapon.category === EquipmentCategory.SALAMANDER;

      for (const style of styles) {
        if (!style.type || !style.stance) continue;
        if (style.stance === 'Manual Cast') continue;
        if (!isSalamander && (style.stance === 'Defensive' || style.stance === 'Longrange' || style.stance === 'Defensive Autocast')) continue;
        if (styleGroupOf(style) !== group) continue;

        if (style.stance === 'Autocast') {
          // needs a spell; enumerate the sensible ones for this weapon
          for (const spell of this.spellsFor(weapon, magicLevel)) {
            out.push({
              weapon, style, spell, group,
            });
          }
          continue;
        }

        if (group === 'magic' && !POWERED_CATEGORIES.includes(weapon.category) && !isSalamander) {
          // non-powered "magic" styles without autocast (e.g. staff bash Focus) are useless
          continue;
        }

        if (BLOWPIPE_IDS.includes(weapon.id)) {
          const dart = this.bestOwnedDart();
          if (!dart) continue;
          out.push({
            weapon: blowpipeWithDart(weapon, dart), style, spell: null, group,
          });
          continue;
        }

        out.push({
          weapon, style, spell: null, group,
        });
      }
    }
    return out;
  }

  private bestOwnedDart(): EquipmentPiece | undefined {
    for (const name of DART_NAMES) {
      const dart = dartByName(name);
      if (dart && this.isAllowed(dart)) return dart;
    }
    return undefined;
  }

  private spellsFor(weapon: EquipmentPiece, magicLevel: number): Spell[] {
    const out: Spell[] = [];
    const push = (s: Spell | null) => { if (s) out.push(s); };

    if (IBAN_BLAST_WEAPONS.includes(weapon.name)) {
      if (magicLevel >= 50) push(spellByName('Iban Blast'));
      return out;
    }
    if (MAGIC_DART_WEAPONS.includes(weapon.name) && magicLevel >= 50) {
      push(spellByName('Magic Dart'));
    }
    push(bestStandardSpell(magicLevel));
    if (ANCIENT_AUTOCAST_WEAPONS.includes(weapon.name)) {
      if (magicLevel >= 94) push(spellByName('Ice Barrage'));
      else if (magicLevel >= 92) push(spellByName('Blood Barrage'));
    }
    if (this.monster.attributes.includes(MonsterAttribute.DEMON) && magicLevel >= 82) {
      push(spellByName('Dark Demonbane'));
    }
    return out.filter((s, ix) => out.findIndex((o) => o.name === s.name) === ix);
  }

  /** best INCLUDED ammo for a weapon by static ranged strength (phase A heuristic) */
  private quickAmmoFor(weapon: EquipmentPiece): EquipmentPiece | null {
    let best: EquipmentPiece | null = null;
    for (const ammo of this.allowedForSlot('ammo')) {
      if (ammoApplicability(weapon.id, ammo.id) !== AmmoApplicability.INCLUDED) continue;
      if (!best || ammo.bonuses.ranged_str > best.bonuses.ranged_str) best = ammo;
    }
    return best;
  }

  private weaponNeedsAmmo(weapon: EquipmentPiece): boolean {
    // INVALID for undefined ammo means the weapon requires ammo
    return ammoApplicability(weapon.id, undefined) === AmmoApplicability.INVALID;
  }

  private ammoCandidates(weapon: EquipmentPiece, t: CombatStyleType): EquipmentPiece[] {
    const needsAmmo = this.weaponNeedsAmmo(weapon);
    const pool = needsAmmo ? this.allowedForSlot('ammo') : this.candidatesFor('ammo', t);
    return pool.filter((a) => {
      const ap = ammoApplicability(weapon.id, a.id);
      return needsAmmo ? ap === AmmoApplicability.INCLUDED : ap !== AmmoApplicability.INVALID;
    });
  }

  /** coordinate-ascent the armour slots for a fixed weapon variant */
  private optimiseArmour(variant: WeaponVariant): Partial<PlayerEquipment> {
    const { weapon, style, spell } = variant;
    const t = style.type;
    const eq: Partial<PlayerEquipment> = { weapon };

    const initialAmmo = this.quickAmmoFor(weapon);
    if (initialAmmo) eq.ammo = initialAmmo;
    if (this.weaponNeedsAmmo(weapon) && !initialAmmo) return eq; // unusable, will score 0

    for (let pass = 0; pass < 3; pass += 1) {
      let changed = false;
      for (const slot of ARMOUR_SLOTS) {
        if (slot === 'shield' && weapon.isTwoHanded) continue;
        const candidates = slot === 'ammo'
          ? this.ammoCandidates(weapon, t)
          : this.candidatesFor(slot, t);

        let bestItem: EquipmentPiece | null = eq[slot] ?? null;
        let bestDps = this.dps(eq, style, spell);
        // try empty slot too, in case current item has net-negative bonuses
        if (eq[slot] && slot !== 'ammo') {
          const d = this.dps({ ...eq, [slot]: null }, style, spell);
          if (d > bestDps) { bestDps = d; bestItem = null; }
        }
        for (const cand of candidates) {
          if (cand.id === eq[slot]?.id) continue;
          const d = this.dps({ ...eq, [slot]: cand }, style, spell);
          // on a dps tie, prefer wearing something over an empty slot
          if (d > bestDps || (d === bestDps && bestItem === null)) { bestDps = d; bestItem = cand; }
        }
        if ((bestItem?.id ?? null) !== (eq[slot]?.id ?? null)) {
          changed = true;
          eq[slot] = bestItem;
        }
      }
      if (!changed) break;
    }
    return eq;
  }

  /** after armour has settled, re-check which of the weapon's styles is best */
  private bestStyleFor(weapon: EquipmentPiece, group: StyleGroup, eq: Partial<PlayerEquipment>, spell: Spell | null): PlayerCombatStyle {
    const isSalamander = weapon.category === EquipmentCategory.SALAMANDER;
    const styles = getCombatStylesForCategory(weapon.category).filter((s) => {
      if (!s.type || !s.stance) return false;
      if (s.stance === 'Manual Cast') return false;
      if (spell !== null) return s.stance === 'Autocast';
      if (s.stance === 'Autocast' || s.stance === 'Defensive Autocast') return false;
      if (!isSalamander && (s.stance === 'Defensive' || s.stance === 'Longrange')) return false;
      return styleGroupOf(s) === group;
    });
    let best = styles[0];
    let bestDps = -1;
    for (const s of styles) {
      const d = this.dps(eq, s, spell);
      if (d > bestDps) { bestDps = d; best = s; }
    }
    return best;
  }

  private toResultItem(item: EquipmentPiece, slot: string): ResultItem {
    return {
      id: item.id,
      name: item.name,
      version: item.version,
      image: item.image,
      slot,
      owned: this.owned === null ? true : this.owned.has(item.id),
      detail: item.itemVars?.blowpipeDartName,
    };
  }

  private finalise(eq: Partial<PlayerEquipment>, style: PlayerCombatStyle, spell: Spell | null, group: StyleGroup): SolvedSetup {
    const player = buildPlayer(this.cfg, this.monster, eq, style, spell);
    const calc = new PlayerVsNPCCalc(player, this.monster, { loadoutName: 'solver' });
    const items: SolvedSetup['items'] = {};
    for (const slot of SLOTS) {
      const item = eq[slot];
      if (item) items[slot] = this.toResultItem(item, slot);
    }
    if (spell && items.weapon) items.weapon.detail = spell.name;
    return {
      styleGroup: group,
      dps: calc.getDps(),
      maxHit: calc.getMax(),
      accuracy: calc.getHitChance(),
      ttk: calc.getTtk(),
      attackSpeed: player.attackSpeed,
      styleName: style.name,
      styleStance: style.stance ?? '',
      spellName: spell?.name ?? null,
      items,
    };
  }

  solveStyle(group: StyleGroup, progress?: ProgressFn, progressBase = 0, progressSpan = 1): StyleResult {
    const report = (frac: number, label: string) => progress?.(progressBase + frac * progressSpan, label);
    const K = this.request.weaponsPerStyle ?? 8;

    // Phase A: rank every weapon variant with just weapon (+ammo) equipped
    report(0.05, `${group}: ranking weapons`);
    const variants = this.weaponVariants(group);
    const scored = variants.map((v) => {
      const eq: Partial<PlayerEquipment> = { weapon: v.weapon };
      const ammo = this.quickAmmoFor(v.weapon);
      if (ammo) eq.ammo = ammo;
      if (this.weaponNeedsAmmo(v.weapon) && !ammo) return { v, dps: 0 };
      return { v, dps: this.dps(eq, v.style, v.spell) };
    }).filter((s) => s.dps > 0);
    scored.sort((a, b) => b.dps - a.dps);

    // best variant per weapon (collapsing same-name versions), then top K weapons
    const seen = new Set<string>();
    const shortlist: WeaponVariant[] = [];
    for (const s of scored) {
      if (seen.has(s.v.weapon.name)) continue;
      seen.add(s.v.weapon.name);
      shortlist.push(s.v);
      if (shortlist.length >= K) break;
    }

    if (shortlist.length === 0) {
      return {
        styleGroup: group, immune: true, best: null, setups: [], alternatives: {},
      };
    }

    // Phase B: optimise armour per shortlisted weapon
    const entries: OptimisedEntry[] = [];
    const optimiseVariant = (v: WeaponVariant): OptimisedEntry => {
      const eq = this.optimiseArmour(v);
      const style = this.bestStyleFor(v.weapon, group, eq, v.spell);
      return {
        v, eq, style, setup: this.finalise(eq, style, v.spell, group),
      };
    };
    shortlist.forEach((v, ix) => {
      report(0.1 + 0.55 * (ix / shortlist.length), `${group}: optimising ${v.weapon.name}`);
      entries.push(optimiseVariant(v));
    });

    // Phase C: per-slot alternatives against the winning setup. If the weapon
    // ranking (now computed against real armour) surfaces a weapon that beats
    // the chosen best, promote it through a full optimisation pass and redo.
    let alternatives: StyleResult['alternatives'] = {};
    let best: SolvedSetup;
    for (let round = 0; ; round += 1) {
      entries.sort((a, b) => b.setup.dps - a.setup.dps);
      best = entries[0].setup;
      if (best.dps <= 0.0001) {
        return {
          styleGroup: group, immune: true, best: null, setups: [], alternatives: {},
        };
      }
      report(0.7 + round * 0.1, `${group}: ranking alternatives`);
      alternatives = this.buildAlternatives(entries[0], variants, best);
      const topAlt = alternatives.weapon?.[0];
      const shouldPromote = round < 2 && topAlt
        && topAlt.dps > best.dps * 1.002
        && !entries.some((e) => e.v.weapon.id === topAlt.id);
      if (!shouldPromote) break;
      for (const v of variants.filter((vv) => vv.weapon.id === topAlt.id)) {
        entries.push(optimiseVariant(v));
      }
    }
    const sortedSetups = entries.map((e) => e.setup);

    report(1, `${group}: done`);
    return {
      styleGroup: group,
      immune: false,
      best,
      setups: sortedSetups.slice(0, 5),
      alternatives,
    };
  }

  /** per-slot alternative rankings holding the rest of the best setup fixed */
  private buildAlternatives(
    bestEntry: OptimisedEntry,
    variants: WeaponVariant[],
    best: SolvedSetup,
  ): StyleResult['alternatives'] {
    const { eq: bestEq, style: bestStyle, v: bestVariant } = bestEntry;
    const alternatives: StyleResult['alternatives'] = {};

    // weapon alternatives: every variant re-evaluated against the winning armour.
    // If the winning weapon was two-handed, one-handed candidates get a static
    // best-guess shield so they are not unfairly ranked shieldless.
    const fillShield = !bestEq.shield && !bestVariant.weapon.isTwoHanded ? null
      : this.staticBestShield(bestStyle.type);
    const weaponAlts = new Map<string, SlotAlternative>();
    for (const v of variants) {
      const eq: Partial<PlayerEquipment> = { ...bestEq, weapon: v.weapon };
      if (v.weapon.isTwoHanded) {
        eq.shield = null;
      } else if (!eq.shield && fillShield) {
        eq.shield = fillShield;
      }
      const needsAmmo = this.weaponNeedsAmmo(v.weapon);
      if (needsAmmo) {
        const currentOk = eq.ammo && ammoApplicability(v.weapon.id, eq.ammo.id) === AmmoApplicability.INCLUDED;
        if (!currentOk) {
          const ammo = this.quickAmmoFor(v.weapon);
          if (!ammo) continue;
          eq.ammo = ammo;
        }
      }
      const dps = this.dps(eq, v.style, v.spell);
      if (dps <= 0) continue;
      // collapse charged/uncharged and cosmetic versions that share a display name
      const altKey = v.weapon.name;
      const existing = weaponAlts.get(altKey);
      if (!existing || dps > existing.dps) {
        const item = this.toResultItem(v.weapon, 'weapon');
        if (v.spell) item.detail = v.spell.name;
        weaponAlts.set(altKey, {
          ...item, dps, deltaPct: ((dps - best.dps) / best.dps) * 100,
        });
      }
    }
    alternatives.weapon = [...weaponAlts.values()].sort((a, b) => b.dps - a.dps).slice(0, 40);

    for (const slot of ARMOUR_SLOTS) {
      if (slot === 'shield' && bestVariant.weapon.isTwoHanded) {
        alternatives[slot] = [];
        continue;
      }
      const pool = slot === 'ammo'
        ? this.ammoCandidates(bestVariant.weapon, bestStyle.type)
        : this.altPool(slot, bestStyle.type);
      const bySlotName = new Map<string, SlotAlternative>();
      for (const cand of pool) {
        const dps = this.dps({ ...bestEq, [slot]: cand }, bestStyle, bestVariant.spell);
        if (dps <= 0) continue;
        const existing = bySlotName.get(cand.name);
        if (existing && existing.dps >= dps) continue;
        bySlotName.set(cand.name, {
          ...this.toResultItem(cand, slot),
          dps,
          deltaPct: ((dps - best.dps) / best.dps) * 100,
        });
      }
      const alts = [...bySlotName.values()].sort((a, b) => b.dps - a.dps);
      // make it explicit when leaving the slot empty is the best option
      // (e.g. melee armour with ranged penalties in an owned-only search)
      if (!bestEq[slot] && alts.length > 0 && alts[0].dps < best.dps) {
        alts.unshift({
          id: -1, name: 'Nothing (leave empty)', version: '', image: '', slot, owned: true, dps: best.dps, deltaPct: 0,
        });
      }
      alternatives[slot] = alts.slice(0, 40);
    }

    return alternatives;
  }

  /** highest raw-stat shield for a style, used to fair-rank 1h weapons when the best setup is 2h */
  private staticBestShield(t: CombatStyleType): EquipmentPiece | null {
    const pool = this.candidatesFor('shield', t);
    let best: EquipmentPiece | null = null;
    let bestScore = -Infinity;
    for (const s of pool) {
      const score = offensiveDim(s, t) + strengthDim(s, t) * 2;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  /** pool of items worth showing in the alternatives table for a slot */
  private altPool(slot: Slot, t: CombatStyleType): EquipmentPiece[] {
    if (this.restrictToOwned) return this.allowedForSlot(slot);
    // all-items mode: pareto set + specials, topped up with the highest raw-stat items
    const pruned = this.candidatesFor(slot, t);
    if (pruned.length >= 40) return pruned;
    const extra = this.allowedForSlot(slot)
      .filter((i) => !pruned.includes(i) && (offensiveDim(i, t) > 0 || strengthDim(i, t) > 0))
      .sort((a, b) => (offensiveDim(b, t) + strengthDim(b, t) * 2) - (offensiveDim(a, t) + strengthDim(a, t) * 2))
      .slice(0, 40 - pruned.length);
    return [...pruned, ...extra];
  }

  solve(progress?: ProgressFn): SolveResult {
    const started = Date.now();
    const groups: StyleGroup[] = ['melee', 'ranged', 'magic'];
    const styles = groups.map((g, ix) => this.solveStyle(g, progress, ix / 3, 1 / 3));
    const withBest = styles.filter((s) => s.best !== null);
    withBest.sort((a, b) => (b.best?.dps ?? 0) - (a.best?.dps ?? 0));
    return {
      monsterId: this.request.monsterId,
      monsterVersion: this.request.monsterVersion,
      styles,
      bestStyle: withBest[0]?.styleGroup ?? null,
      elapsedMs: Date.now() - started,
      evals: this.evals,
    };
  }
}

export function solve(request: SolveRequest, progress?: ProgressFn): SolveResult {
  return new Solver(request).solve(progress);
}
