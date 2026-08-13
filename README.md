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

1. **Target**: search a boss. TOA bosses get invocation/party inputs. **Fight
   with** picks which style's results open first - Suggested (whatever ranks
   best), Melee, Ranged, or Magic; the other styles stay one tab-click away.
2. **Player**: type levels or fetch from hiscores by RSN. Pick a boost preset,
   prayers, slayer task.
3. **Your items**: paste a bank export (RuneLite *Bank Memory* plugin "copy as
   tab-separated", a bank tag export, or plain item names one per line), and/or add
   untradeables manually. Toggle "Only use items I own" to restrict the search;
   leave it off to see everything with a green dot on items you own.
4. **Find gear**: per style you get the optimised setup, runner-up weapons fully
   optimised, and a "next best per slot" table with DPS deltas.

## Training mode

Switch the header toggle to **Training** to rank by XP/hr instead of DPS:

- Pick the skill to train; only stances that award XP in it are considered
  (aggressive for str, accurate for atk, defensive/controlled/longrange for def...).
  This matters: a whip cannot train strength except on controlled, so the solver
  will prefer e.g. a rapier/scimitar for str.
- XP per kill is capped by monster HP (overkill grants nothing) and kill rate uses
  TTK plus a configurable downtime between kills.
- **Rank training spots** compares common training monsters by XP/hr with your
  settings and items, with damage taken/hr and food/hr per spot, in three tabs:
  - **Spots**: ~25 overworld staples (crabs, slayer monsters, chinning spots).
  - **Gemstone crab**: never dies, so XP/hr is pure damage uptime with no kill
    downtime and no TTK.
  - **Nightmare Zone**: hard-mode rumble bosses with constant spawns, solved at
    1 HP to model the absorption method - Dharok's set is evaluated as a full-set
    combo and credited honestly (it wins with high Strength and overloads, and
    loses to fast accurate weapons below that). Picking an NMZ boss as the main
    target applies the same 1 HP assumption to the full solve.
- Setups show damage taken/hr, food/hr (sharks), and estimated consumable cost/hr
  (darts+scales, arrows with ava's saving, chins, non-elemental runes, staff charges).
- A slayer-task quick-select sets the target monster and the on-task flag.

## Only gear you can actually equip

Every suggestion is filtered by your base levels against real equip requirements
(85 Magic for Tumeken's shadow, 90 Strength for the scythe, 42s + 22 Prayer for
void, and so on) - across best setups, alternatives, combos, and the upgrade
advisor. Owning an item doesn't make it wearable. The RSN lookup also fetches
your Slayer level for slayer-gated gear (leaf-bladed weapons); manual stat entry
assumes 99 Slayer. Requirements live in `cdn/json/requirements.json`, generated
by `npm run sync-reqs`: the wiki has no structured requirements data anywhere
(not the infoboxes, not SMW, not the bucket tables), so the script parses the
requirement sentence from each item page's lead section, applies the overrides
in `scripts/reqs-overrides.json`, and hard-fails on known anchor items if the
parse ever regresses. Quest requirements are out of scope.

## Only gear you can actually get

The upstream dataset includes seasonal and discontinued gear that carries no
name suffix - league uniques (V's helm, Devil's element, Crystal blessing, the
echo weapons), Deadman starter/seasonal items, discontinued content. The same
sync detects these from wiki categories into `cdn/json/unobtainable.json`, and
the solver hides them unless they're in your imported bank (whoever has one can
still wear it). Anchored the same way: a category regression fails the sync.

## Your current gear

The **Your current gear** card above the results holds a separate hand-picked
loadout per combat style - your melee, ranged, and magic sets - and follows the
Fight-with choice (chips in the card header switch sets manually). Search items
into each slot (bank-owned items sort first and get a dot), and it shows DPS,
max hit, accuracy, TTK - or XP/hr in training mode - against the selected
target with your stats, boosts and prayers, compared against the best found
setup of the same style. The combat
style defaults to the best eligible stance (spell included for autocast staves)
but can be forced, including defensive stances the solver would skip. Full sets
you assemble by hand get their combo badge, and after a solve the header shows
the gap to the best found setup, with a one-click "load best found" to start
from it. The loadout persists between visits.

## Full-set combos

Set effects only pay off once the whole set is worn, so a per-slot search can never
walk into them. Each style's results include a **Full-set combos** table: known sets
(Blood moon + Dual macuahuitl, full obsidian + Tzhaar weapons, void/elite void,
Inquisitor's, crystal armour + crystal bows, Barrows sets with the Amulet of the
damned) evaluated with their pieces locked and every other slot optimised, ranked
honestly against the per-slot best. When a set actually wins, it *is* the best setup
and gets labelled as such. Blue/Eclipse moon are omitted because the engine does not
model their set effects yet; Dharok's because the solver evaluates at full HP.

## Upgrade advisor

With a bank imported, "only use items I own" on, and GE prices available (fetched
hourly from prices.runescape.wiki), results include an upgrade advisor: unowned
items ranked by how much DPS or XP/hr they add over your best owned setup, with GE
price and gain per million gp. Sort by raw gain or by value. If you own most of a
set, the advisor also prices the missing pieces as one bundle (e.g. "Blood moon
set - Blood moon tassets") with the full-set gain.

## How the solver works

Every weapon (and autocast spell / blowpipe dart variant) is scored, the top few per
style get a coordinate-ascent pass over the armour slots using the full DPS engine
(so set effects and item synergies are exact), and the winner's setup is then used to
rank every viable alternative per slot. If the re-ranked weapon list surfaces something
better than the chosen setup, it gets promoted through a full optimisation pass too.

## Maintenance

- `npm test` - runs the vendored upstream engine suite (~290 tests) + solver tests
- `npm run sync-upstream` - refresh item/monster JSONs and icons from upstream main
- `npm run sync-reqs` - regenerate equip requirements from the wiki (run after sync-upstream adds items)
- `npm run typecheck`

Licensed GPL-3.0 (required by the vendored engine).
