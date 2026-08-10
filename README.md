# GearFinder

Local OSRS gear tool: pick a boss, get the best setup per combat style, plus a ranked
list of alternatives for every slot (not just best-in-slot), filtered or badged by
what you actually own.

DPS math and item/monster data are vendored from
[weirdgloop/osrs-dps-calc](https://github.com/weirdgloop/osrs-dps-calc) (the OSRS Wiki
DPS calculator, GPL-3.0), so boss mechanics (tbow scaling, Tumeken's shadow, scythe,
fang, salve/slayer stacking, void, raid scaling...) match dps.osrs.wiki. See VENDOR.md.

## Run it

Double-click `start.bat` (or the GearFinder desktop shortcut), or:

```
dev.bat
```

then open http://localhost:5173. Node is not installed system-wide; the scripts use the
portable Node in `C:\Users\Admin\Projects\tools\node24`.

## Using it

1. **Target**: search a boss. TOA bosses get invocation/party inputs.
2. **Player**: type levels or fetch from hiscores by RSN. Pick a boost preset,
   prayers, slayer task.
3. **Your items**: paste a bank export (RuneLite *Bank Memory* plugin "copy as
   tab-separated", a bank tag export, or plain item names one per line), and/or add
   untradeables manually. Toggle "Only use items I own" to restrict the search;
   leave it off to see everything with a green dot on items you own.
4. **Find gear**: per style you get the optimised setup, runner-up weapons fully
   optimised, and a "next best per slot" table with DPS deltas.

## How the solver works

Every weapon (and autocast spell / blowpipe dart variant) is scored, the top few per
style get a coordinate-ascent pass over the armour slots using the full DPS engine
(so set effects and item synergies are exact), and the winner's setup is then used to
rank every viable alternative per slot. If the re-ranked weapon list surfaces something
better than the chosen setup, it gets promoted through a full optimisation pass too.

## Maintenance

- `npm test` - runs the vendored upstream engine suite (~290 tests) + solver tests
- `npm run sync-upstream` - refresh item/monster JSONs and icons from upstream main
- `npm run typecheck`

Licensed GPL-3.0 (required by the vendored engine).
