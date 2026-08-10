# Vendored code

The DPS engine, types, enums, utils, test suite, and data JSONs are vendored from
[weirdgloop/osrs-dps-calc](https://github.com/weirdgloop/osrs-dps-calc) (GPL-3.0),
the calculator behind dps.osrs.wiki.

- Upstream commit: `91218d63e71927e99748a50d008975336025a88e` (cloned 2026-08-09)
- Vendored paths: `src/lib/`, `src/types/`, `src/enums/`, `src/utils.ts`, `src/tests/`,
  `src/public/img/{prayers,potions}/`, `cdn/json/*.json`, `public/cdn/equipment/`
- Local additions (not upstream): `src/state.ts` (extracted `generateEmptyPlayer` from
  upstream `src/state.tsx`), `src/shims/next-image.ts`
- Vendored files are kept byte-identical to upstream where possible so re-syncing is a
  plain copy. `next/image` and `@jest/globals` are remapped via aliases in
  `vite.config.ts` / `tsconfig.json` instead of editing the files.

To refresh item/monster data only: `npm run sync-upstream` (downloads latest
`cdn/json/*.json` and equipment icons from upstream main).
