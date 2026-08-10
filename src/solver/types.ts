import { PlayerSkills } from '@/types/Player';
import { Monster } from '@/types/Monster';

export type StyleGroup = 'melee' | 'ranged' | 'magic';

export type PotionPreset = 'none' | 'standard' | 'overload' | 'salts';

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
  /** how many weapons per style get a full armour optimisation pass */
  weaponsPerStyle?: number;
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
  /** % DPS lost vs the best setup, e.g. -3.2 */
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
  items: Partial<Record<string, ResultItem>>;
}

export interface StyleResult {
  styleGroup: StyleGroup;
  immune: boolean;
  best: SolvedSetup | null;
  /** runner-up full setups (different weapons), best first */
  setups: SolvedSetup[];
  /** per-slot ranking of alternatives holding the rest of the best setup fixed */
  alternatives: Partial<Record<string, SlotAlternative[]>>;
}

export interface SolveResult {
  monsterId: number;
  monsterVersion: string;
  styles: StyleResult[];
  /** overall best across styles, by dps */
  bestStyle: StyleGroup | null;
  elapsedMs: number;
  evals: number;
}

export type WorkerRequest = { type: 'solve'; id: number; request: SolveRequest };

export type WorkerResponse =
  | { type: 'progress'; id: number; pct: number; label: string }
  | { type: 'result'; id: number; result: SolveResult }
  | { type: 'error'; id: number; message: string };
