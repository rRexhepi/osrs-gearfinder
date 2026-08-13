import { PlayerSkills } from '@/types/Player';
import { Monster } from '@/types/Monster';
import { PriceMap, TrainedSkill } from './xp';

export type StyleGroup = 'melee' | 'ranged' | 'magic';

export type PotionPreset = 'none' | 'standard' | 'overload' | 'salts';

export type SolveMode = 'boss' | 'training';

export interface SolveRequest {
  monsterId: number;
  monsterVersion: string;
  monsterInputs: Partial<Monster['inputs']>;
  skills: PlayerSkills;
  potionPreset: PotionPreset;
  usePrayers: boolean;
  onSlayerTask: boolean;
  /** ids of items the player owns; null = no bank data imported */
  ownedIds: number[] | null;
  /** when true (and ownedIds is set), only owned items are considered */
  restrictToOwned: boolean;
  /** item ids the user never wants suggested */
  excludedIds: number[];
  /** base Slayer level for slayer-gated gear (leaf-bladed etc.); defaults to 99 */
  slayerLevel?: number;
  /**
   * Assumed current hitpoints during the fight (defaults to full). 1 models the
   * NMZ absorption method and lets Dharok's set effect count for real.
   */
  playerHpCurrent?: number;
  /** how many weapons per style get a full armour optimisation pass */
  weaponsPerStyle?: number;
  /** 'boss' ranks by DPS, 'training' ranks by XP/hr in trainedSkill */
  mode?: SolveMode;
  trainedSkill?: TrainedSkill;
  /** seconds lost between kills (respawn, walking, looting) */
  downtimeSeconds?: number;
  /** GE prices by item id, enables cost/hr and the upgrade advisor */
  prices?: PriceMap;
  /** with restrictToOwned + prices: also rank unowned upgrades by gain per gp */
  includeUpgrades?: boolean;
}

export interface ResultItem {
  id: number;
  name: string;
  version: string;
  image: string;
  slot: string;
  owned: boolean;
  /** dart name for blowpipes, spell name for autocast staves */
  detail?: string;
}

export interface SlotAlternative extends ResultItem {
  dps: number;
  /** ranking metric: dps in boss mode, xp/hr in training mode */
  metric: number;
  /** % of the ranking metric lost vs the best setup, e.g. -3.2 */
  deltaPct: number;
}

export interface SolvedSetup {
  styleGroup: StyleGroup;
  dps: number;
  maxHit: number;
  accuracy: number;
  ttk: number;
  attackSpeed: number;
  styleName: string;
  styleStance: string;
  spellName: string | null;
  /** set when this setup is a locked full-set combo (e.g. Blood moon set) */
  combo: { name: string; note: string } | null;
  items: Partial<Record<string, ResultItem>>;
  /** ranking metric: dps in boss mode, xp/hr in training mode */
  metric: number;
  /** xp/hr in the trained skill (training mode only) */
  xpHr: number | null;
  /** expected damage taken per hour while in combat (no overheads/food) */
  dmgTakenHr: number | null;
  /** dmgTakenHr / 20 (sharks) */
  foodHr: number | null;
  /** estimated consumable cost (ammo/darts/runes/charges), null if unknown */
  costHr: number | null;
  costParts: string[];
}

export interface UpgradeSuggestion extends ResultItem {
  styleGroup: StyleGroup;
  /** metric with this item swapped into the owned best setup */
  metric: number;
  /** % metric gained over the owned best setup */
  gainPct: number;
  price: number;
  /** gainPct per million gp */
  gainPerM: number;
}

export interface StyleResult {
  styleGroup: StyleGroup;
  immune: boolean;
  best: SolvedSetup | null;
  /** runner-up full setups (different weapons), best first */
  setups: SolvedSetup[];
  /** best setup per full-set combo template, best first (may rank below `best`) */
  combos: SolvedSetup[];
  /** per-slot ranking of alternatives holding the rest of the best setup fixed */
  alternatives: Partial<Record<string, SlotAlternative[]>>;
}

export interface SolveResult {
  monsterId: number;
  monsterVersion: string;
  styles: StyleResult[];
  /** overall best across styles, by the ranking metric */
  bestStyle: StyleGroup | null;
  mode: SolveMode;
  trainedSkill: TrainedSkill | null;
  upgrades: UpgradeSuggestion[] | null;
  elapsedMs: number;
  evals: number;
}

/** which training-spot tab a ranked row belongs to */
export type SpotGroup = 'spots' | 'crab' | 'nmz';

export interface TargetRow {
  monsterId: number;
  monsterName: string;
  monsterVersion: string;
  monsterImage: string;
  group: SpotGroup;
  note: string;
  xpHr: number;
  dps: number;
  ttk: number;
  dmgTakenHr: number | null;
  foodHr: number | null;
  weaponName: string;
  styleStance: string;
}

export interface RankTargetsResult {
  trainedSkill: TrainedSkill;
  rows: TargetRow[];
  elapsedMs: number;
}

/** the best setup for one combat style against a target, ranked by its natural skill */
export interface SpotStyleRow {
  styleGroup: StyleGroup;
  skill: TrainedSkill;
  best: SolvedSetup | null;
}

export interface SpotStylesResult {
  rows: SpotStyleRow[];
}

/** a hand-picked loadout to evaluate as-is (no optimisation) */
export interface GearLoadout {
  /** item id per slot */
  items: Partial<Record<string, number>>;
  /** force a specific combat style; omit both for the best eligible one */
  styleName?: string;
  styleStance?: string;
  /** dart to load when the weapon is a blowpipe */
  dartName?: string;
}

export interface EvaluateRequest extends SolveRequest {
  loadout: GearLoadout;
}

export type WorkerRequest =
  | { type: 'solve'; id: number; request: SolveRequest }
  | { type: 'rankTargets'; id: number; request: SolveRequest }
  | { type: 'evaluate'; id: number; request: EvaluateRequest }
  | { type: 'spotStyles'; id: number; request: SolveRequest; spotGroup: SpotGroup };

export type WorkerResponse =
  | { type: 'progress'; id: number; pct: number; label: string }
  | { type: 'result'; id: number; result: SolveResult }
  | { type: 'targetsResult'; id: number; result: RankTargetsResult }
  | { type: 'evalResult'; id: number; result: SolvedSetup | null }
  | { type: 'spotStylesResult'; id: number; result: SpotStylesResult }
  | { type: 'error'; id: number; message: string };
