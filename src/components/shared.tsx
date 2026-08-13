export const iconUrl = (image: string) => `/cdn/equipment/${image}`;

export const SLOT_ORDER = ['weapon', 'shield', 'ammo', 'head', 'cape', 'neck', 'body', 'legs', 'hands', 'feet', 'ring'];

export const SLOT_LABELS: Record<string, string> = {
  weapon: 'Weapon', shield: 'Shield', ammo: 'Ammo', head: 'Head', cape: 'Cape', neck: 'Neck', body: 'Body', legs: 'Legs', hands: 'Hands', feet: 'Feet', ring: 'Ring',
};

export function StatChip({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="bg-panel-2 border border-border rounded px-2 py-1 text-center" title={title}>
      <div className="text-[10px] uppercase text-muted">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}
