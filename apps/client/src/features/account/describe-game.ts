import type { GameSummary } from '@chess/game-types';

export function describeGame(g: GameSummary): { badge: string; title: string; detail: string } {
  const mine = g.myColor;
  const badge =
    g.result === '*'
      ? '—'
      : g.result === '1/2-1/2'
        ? 'Draw'
        : mine === null
          ? g.result
          : (g.result === '1-0') === (mine === 'w')
            ? 'Win'
            : 'Loss';
  const opponent = mine ? g.players.find((p) => p.color !== mine) : undefined;
  const title = g.mode === 'LOCAL' ? 'Local game' : opponent ? `vs ${opponent.name}` : 'Game';
  const bits = [
    g.openingName ? `${g.eco ?? ''} ${g.openingName}`.trim() : null,
    `${Math.ceil(g.plyCount / 2)} moves`,
    g.termination,
    g.endedAt ? new Date(g.endedAt).toLocaleDateString() : null,
  ];
  return { badge, title, detail: bits.filter(Boolean).join(' · ') };
}
