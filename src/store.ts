import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { PlayerSkills } from '@/types/Player';
import { TOMBS_OF_AMASCUT_MONSTER_IDS } from '@/lib/constants';
import { getCombatStylesForCategory } from '@/utils';
import { itemById } from '@/solver/data';
import {
  PotionPreset, RankTargetsResult, SolveMode, SolveRequest, SolveResult, StyleGroup,
} from '@/solver/types';
import { PriceMap, TrainedSkill } from '@/solver/xp';

export interface MonsterChoice {
  id: number;
  name: string;
  version: string;
  image: string;
}

/** one hand-picked loadout in the gear evaluator */
export interface GearSet {
  /** slot -> item id */
  items: Partial<Record<string, number>>;
  /** forced combat style as "name|stance"; '' = best eligible */
  style: string;
  dart: string;
}

export const EMPTY_GEAR_SET: GearSet = { items: {}, style: '', dart: '' };

interface GearFinderState {
  monster: MonsterChoice | null;
  toaInvocationLevel: number;
  partySize: number;

  skills: PlayerSkills;
  /** base Slayer level (fetched with the RSN lookup; manual entry keeps 99) */
  slayerLevel: number;
  potionPreset: PotionPreset;
  usePrayers: boolean;
  onSlayerTask: boolean;

  ownedIds: number[];
  hasImportedBank: boolean;
  restrictToOwned: boolean;

  mode: SolveMode;
  trainedSkill: TrainedSkill;
  downtimeSeconds: number;
  /** which style's results to open with; '' = whatever ranks best */
  preferredStyle: '' | StyleGroup;

  /** hand-picked loadouts for the gear evaluator, one per combat style */
  gearSets: Partial<Record<StyleGroup, GearSet>>;
  /** which set the gear panel shows (follows the Fight-with choice) */
  gearTab: StyleGroup;

  // transient (not persisted)
  result: SolveResult | null;
  solving: boolean;
  progress: number;
  progressLabel: string;
  spots: RankTargetsResult | null;
  rankingSpots: boolean;
  havePrices: boolean;
  prices: PriceMap | null;

  set: (partial: Partial<GearFinderState>) => void;
  addOwned: (ids: number[]) => void;
  removeOwned: (id: number) => void;
  clearOwned: () => void;
}

export const DEFAULT_SKILLS: PlayerSkills = {
  atk: 99, str: 99, def: 99, hp: 99, magic: 99, ranged: 99, prayer: 99, mining: 99, herblore: 99,
};

/** the solve/evaluate request implied by the current UI state; null without a target */
export const buildBaseRequest = (s: GearFinderState, monster: MonsterChoice | null = s.monster): SolveRequest | null => {
  if (!monster) return null;
  const isToa = TOMBS_OF_AMASCUT_MONSTER_IDS.includes(monster.id);
  return {
    monsterId: monster.id,
    monsterVersion: monster.version,
    monsterInputs: isToa ? {
      toaInvocationLevel: s.toaInvocationLevel,
      partySize: s.partySize,
    } : {},
    skills: s.skills,
    slayerLevel: s.slayerLevel,
    potionPreset: s.potionPreset,
    usePrayers: s.usePrayers,
    onSlayerTask: s.onSlayerTask,
    ownedIds: s.hasImportedBank ? s.ownedIds : null,
    restrictToOwned: s.restrictToOwned,
    excludedIds: [],
    weaponsPerStyle: 8,
    // fighting in NMZ implies the absorption method (1 hp), so Dharok's counts
    ...(monster.name.includes('(Nightmare Zone)') ? { playerHpCurrent: 1 } : {}),
    mode: s.mode,
    trainedSkill: s.trainedSkill,
    downtimeSeconds: s.mode === 'training' ? s.downtimeSeconds : 0,
    prices: s.prices ?? undefined,
    includeUpgrades: s.restrictToOwned && s.hasImportedBank && s.prices !== null,
  };
};

export const useStore = create<GearFinderState>()(
  persist(
    (set) => ({
      monster: null,
      toaInvocationLevel: 150,
      partySize: 1,

      skills: DEFAULT_SKILLS,
      slayerLevel: 99,
      potionPreset: 'standard',
      usePrayers: true,
      onSlayerTask: false,

      ownedIds: [],
      hasImportedBank: false,
      restrictToOwned: false,

      mode: 'boss',
      trainedSkill: 'str',
      downtimeSeconds: 5,
      preferredStyle: '',

      gearSets: {},
      gearTab: 'melee',

      result: null,
      solving: false,
      progress: 0,
      progressLabel: '',
      spots: null,
      rankingSpots: false,
      havePrices: false,
      prices: null,

      set: (partial) => set(partial),
      addOwned: (ids) => set((s) => ({
        ownedIds: [...new Set([...s.ownedIds, ...ids])],
        hasImportedBank: true,
      })),
      removeOwned: (id) => set((s) => ({ ownedIds: s.ownedIds.filter((i) => i !== id) })),
      clearOwned: () => set({ ownedIds: [], hasImportedBank: false, restrictToOwned: false }),
    }),
    {
      name: 'gearfinder',
      version: 1,
      // v0 kept a single loadout (gear/gearStyle/gearDart); file it under the
      // style its weapon fights with so nothing typed in gets lost
      migrate: (persisted) => {
        const s = persisted as Partial<GearFinderState> & {
          gear?: Partial<Record<string, number>>; gearStyle?: string; gearDart?: string;
        };
        if (s.gear && Object.keys(s.gear).length > 0 && !s.gearSets) {
          const weapon = s.gear.weapon !== undefined ? itemById.get(s.gear.weapon) : undefined;
          const type = weapon ? getCombatStylesForCategory(weapon.category)[0]?.type : undefined;
          const group: StyleGroup = type === 'magic' ? 'magic' : type === 'ranged' ? 'ranged' : 'melee';
          s.gearSets = { [group]: { items: s.gear, style: s.gearStyle ?? '', dart: s.gearDart ?? '' } };
          s.gearTab = group;
        }
        delete s.gear;
        delete s.gearStyle;
        delete s.gearDart;
        return s as unknown as GearFinderState;
      },
      partialize: (s) => ({
        monster: s.monster,
        toaInvocationLevel: s.toaInvocationLevel,
        partySize: s.partySize,
        skills: s.skills,
        slayerLevel: s.slayerLevel,
        potionPreset: s.potionPreset,
        usePrayers: s.usePrayers,
        onSlayerTask: s.onSlayerTask,
        ownedIds: s.ownedIds,
        hasImportedBank: s.hasImportedBank,
        restrictToOwned: s.restrictToOwned,
        mode: s.mode,
        trainedSkill: s.trainedSkill,
        downtimeSeconds: s.downtimeSeconds,
        preferredStyle: s.preferredStyle,
        gearSets: s.gearSets,
        gearTab: s.gearTab,
      }),
    },
  ),
);
