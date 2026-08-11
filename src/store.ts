import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { PlayerSkills } from '@/types/Player';
import {
  PotionPreset, RankTargetsResult, SolveMode, SolveResult,
} from '@/solver/types';
import { TrainedSkill } from '@/solver/xp';

export interface MonsterChoice {
  id: number;
  name: string;
  version: string;
  image: string;
}

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

  // transient (not persisted)
  result: SolveResult | null;
  solving: boolean;
  progress: number;
  progressLabel: string;
  spots: RankTargetsResult | null;
  rankingSpots: boolean;
  havePrices: boolean;

  set: (partial: Partial<GearFinderState>) => void;
  addOwned: (ids: number[]) => void;
  removeOwned: (id: number) => void;
  clearOwned: () => void;
}

export const DEFAULT_SKILLS: PlayerSkills = {
  atk: 99, str: 99, def: 99, hp: 99, magic: 99, ranged: 99, prayer: 99, mining: 99, herblore: 99,
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

      result: null,
      solving: false,
      progress: 0,
      progressLabel: '',
      spots: null,
      rankingSpots: false,
      havePrices: false,

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
      }),
    },
  ),
);
