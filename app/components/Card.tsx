'use client';

// Server card encoding (080): 0..51, rank = n % 13 (0=A, 9=10, 10=J, 11=Q,
// 12=K), suit = n / 13 (0=spades, 1=hearts, 2=diamonds, 3=clubs).
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];

export function cardLabel(n: number) {
  return `${RANKS[n % 13]}${SUITS[Math.floor(n / 13)]}`;
}

export default function Card({
  n,
  faceDown,
  selected,
  onClick,
}: {
  n?: number;
  faceDown?: boolean;
  selected?: boolean;
  onClick?: () => void;
}) {
  if (faceDown || n == null) {
    return (
      <div className="w-14 h-20 rounded-lg bg-gradient-to-br from-red-950 to-zinc-900 border border-zinc-700 flex items-center justify-center text-xl text-red-800/70 shrink-0">
        🂠
      </div>
    );
  }

  const rank = RANKS[n % 13];
  const suit = Math.floor(n / 13);
  const isRed = suit === 1 || suit === 2;

  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      onClick={onClick}
      className={`w-14 h-20 rounded-lg bg-zinc-100 border-2 flex flex-col items-center justify-center shrink-0 transition ${
        selected ? 'border-emerald-500 -translate-y-1.5 shadow-lg shadow-emerald-900/40' : 'border-zinc-400'
      } ${onClick ? 'cursor-pointer hover:border-emerald-400' : ''}`}
    >
      <span className={`text-lg font-bold leading-none ${isRed ? 'text-red-600' : 'text-zinc-900'}`}>{rank}</span>
      <span className={`text-xl leading-none ${isRed ? 'text-red-600' : 'text-zinc-900'}`}>{SUITS[suit]}</span>
    </Wrapper>
  );
}
