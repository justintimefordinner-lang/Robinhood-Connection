// Small account marker on a position row, Combined View only: a coloured circle
// with the account's initial, so the ticker stays readable. The colour is the
// account's place in the combined set (so two accounts never share one), the
// letter is the label's first character, and the full name is in the hover
// title. Shares merged from two accounts ("A + B") get one circle per account.
// A single account's view carries no `account` on its positions, so this
// renders nothing there.

// Full class strings: Tailwind only keeps classes it can see.
const PALETTE = [
  "bg-sky-500/20 text-sky-300 ring-sky-500/40",
  "bg-amber-500/20 text-amber-300 ring-amber-500/40",
  "bg-emerald-500/20 text-emerald-300 ring-emerald-500/40",
  "bg-violet-500/20 text-violet-300 ring-violet-500/40",
  "bg-rose-500/20 text-rose-300 ring-rose-500/40",
  "bg-cyan-500/20 text-cyan-300 ring-cyan-500/40",
  "bg-orange-500/20 text-orange-300 ring-orange-500/40",
  "bg-lime-500/20 text-lime-300 ring-lime-500/40",
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function Dot({ label, index }: { label: string; index?: number }) {
  const cls = PALETTE[(index ?? hash(label)) % PALETTE.length];
  const glyph = (label.trim().match(/[A-Za-z0-9]/)?.[0] ?? "•").toUpperCase();
  return (
    <span
      title={`Held in ${label}`}
      aria-label={`Held in ${label}`}
      className={`ml-1 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold leading-none ring-1 ring-inset ${cls}`}
    >
      {glyph}
    </span>
  );
}

export function AccountTag({ label, index }: { label?: string | null; index?: number }) {
  if (!label) return null;
  const parts = label.split(" + ").map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    return (
      <>
        {parts.map((p) => (
          <Dot key={p} label={p} />
        ))}
      </>
    );
  }
  return <Dot label={label} index={index} />;
}
