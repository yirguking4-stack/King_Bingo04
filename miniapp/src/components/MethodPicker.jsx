// Deposit / Withdraw step 1: the player taps Telebirr or CBE; only that method's form is shown afterwards.
const METHODS = [
  { key: 'TELEBIRR', img: '/icons/telebirr-fast.jpg', label: 'Telebirr Fast' },
  { key: 'CBE', img: '/icons/cbe-bank.jpg', label: 'CBE Bank' },
];

export default function MethodPicker({ onPick, hint }) {
  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12, lineHeight: 1.6 }}>{hint}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {METHODS.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => onPick(m.key)}
            aria-label={m.label}
            style={{ padding: 0, border: '2px solid var(--color-border)', borderRadius: 14, overflow: 'hidden', background: 'transparent', cursor: 'pointer', display: 'block' }}
          >
            <img src={m.img} alt={m.label} draggable={false} style={{ width: '100%', display: 'block' }} />
          </button>
        ))}
      </div>
    </div>
  );
}

export function MethodBadge({ method, onChange }) {
  const m = METHODS.find((x) => x.key === method);
  if (!m) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
      <img src={m.img} alt={m.label} style={{ height: 52, borderRadius: 10, border: '1px solid var(--color-border)' }} />
      <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px', marginLeft: 'auto' }} onClick={onChange}>
        ዘዴ ቀይር
      </button>
    </div>
  );
}
