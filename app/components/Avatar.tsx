'use client';

type AvatarProps = {
  src?: string | null;
  name?: string | null;
  size?: number; // px
  className?: string;
};

// Deterministic warm "mob" gradient per name, so every player gets a stable
// signature colour even without an uploaded avatar.
const GRADIENTS = [
  'from-red-800 to-amber-700',
  'from-amber-700 to-yellow-600',
  'from-rose-800 to-red-700',
  'from-orange-800 to-amber-600',
  'from-red-900 to-rose-700',
  'from-yellow-700 to-amber-800',
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export default function Avatar({ src, name, size = 64, className = '' }: AvatarProps) {
  const clean = (name ?? '').trim();
  const initial = (clean[0] ?? '?').toUpperCase();
  const grad = GRADIENTS[hash(clean || '?') % GRADIENTS.length];

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-xl ring-1 ring-amber-500/25 shadow-lg shadow-black/40 ${className}`}
      style={{ width: size, height: size }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={clean || 'avatar'} className="h-full w-full object-cover" />
      ) : (
        <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${grad}`}>
          <span className="font-black text-white/90" style={{ fontSize: size * 0.42 }}>
            {initial}
          </span>
        </div>
      )}
      {/* subtle top gloss for a premium feel */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 to-transparent" />
    </div>
  );
}
