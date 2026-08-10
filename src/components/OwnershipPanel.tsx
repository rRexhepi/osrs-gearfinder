import { useMemo, useState } from 'react';
import { parseBankText, searchEquipment } from '@/solver/ownership';
import { itemById } from '@/solver/data';
import { useStore } from '@/store';

const iconUrl = (image: string) => `/cdn/equipment/${image}`;

export default function OwnershipPanel() {
  const {
    ownedIds, hasImportedBank, restrictToOwned, set, addOwned, removeOwned, clearOwned,
  } = useStore();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [listOpen, setListOpen] = useState(false);

  const searchResults = useMemo(() => searchEquipment(search, 15), [search]);

  const ownedItems = useMemo(() => {
    const seen = new Set<string>();
    return ownedIds
      .map((id) => itemById.get(id))
      .filter((i): i is NonNullable<typeof i> => !!i)
      .filter((i) => {
        if (seen.has(i.name)) return false;
        seen.add(i.name);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [ownedIds]);

  const doImport = () => {
    const res = parseBankText(pasteText);
    addOwned(res.ids);
    setImportSummary(`Matched ${res.ids.length} equipable items (${res.unmatched.length} lines skipped)`);
    setPasteText('');
    setPasteOpen(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-gold font-semibold text-sm uppercase tracking-wider">Your items</h2>
        {ownedIds.length > 0 && (
          <button type="button" className="text-xs text-muted hover:text-red-400" onClick={() => { clearOwned(); setImportSummary(null); }}>
            clear
          </button>
        )}
      </div>

      <button
        type="button"
        className="w-full px-2 py-1.5 text-sm bg-panel-2 border border-border rounded hover:border-gold text-left"
        onClick={() => setPasteOpen(!pasteOpen)}
      >
        Paste bank export...
      </button>
      {pasteOpen && (
        <div className="space-y-1">
          <textarea
            className="w-full h-28 bg-panel-2 border border-border rounded px-2 py-1 text-xs outline-none focus:border-gold font-mono"
            placeholder={'From RuneLite "Bank Memory" plugin (copy as tab-separated),\na bank tag export, or just item names, one per line.'}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <button
            type="button"
            className="w-full px-2 py-1 text-sm bg-gold/20 border border-gold/60 rounded hover:bg-gold/30"
            onClick={doImport}
          >
            Import
          </button>
        </div>
      )}
      {importSummary && <div className="text-xs text-emerald-400">{importSummary}</div>}

      <div className="relative">
        <input
          className="w-full bg-panel-2 border border-border rounded px-2 py-1 text-sm outline-none focus:border-gold"
          placeholder="Add an item manually..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {searchResults.length > 0 && search.length >= 2 && (
          <div className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto bg-panel-2 border border-border rounded shadow-xl">
            {searchResults.map((item) => (
              <button
                type="button"
                key={item.id}
                className="w-full text-left px-2 py-1 text-sm hover:bg-panel flex items-center gap-2"
                onClick={() => { addOwned([item.id]); setSearch(''); }}
              >
                <img src={iconUrl(item.image)} alt="" className="w-5 h-5 object-contain" loading="lazy" />
                <span className="truncate">{item.name}</span>
                {item.version ? <span className="text-muted text-xs">{item.version}</span> : null}
              </button>
            ))}
          </div>
        )}
      </div>

      {hasImportedBank && (
        <>
          <label className="flex items-center gap-1.5 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={restrictToOwned}
              onChange={(e) => set({ restrictToOwned: e.target.checked })}
            />
            Only use items I own
          </label>
          <button
            type="button"
            className="text-xs text-muted hover:text-parchment"
            onClick={() => setListOpen(!listOpen)}
          >
            {ownedItems.length} items imported {listOpen ? '▾' : '▸'}
          </button>
          {listOpen && (
            <div className="max-h-48 overflow-y-auto space-y-0.5 pr-1">
              {ownedItems.map((item) => (
                <div key={item.id} className="flex items-center gap-1.5 text-xs group">
                  <img src={iconUrl(item.image)} alt="" className="w-4 h-4 object-contain" loading="lazy" />
                  <span className="truncate flex-1">{item.name}</span>
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 text-red-400"
                    onClick={() => removeOwned(item.id)}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
