import { ChessGame } from '@chess/chess-core';

export type ParsedInput =
  { ok: true; kind: 'fen' | 'pgn'; game: ChessGame } | { ok: false; message: string };

// Eight ranks separated by "/", then the side to move: enough to tell a FEN from PGN movetext.
const FEN_SHAPE = /^[rnbqkpRNBQKP1-8]+(?:\/[rnbqkpRNBQKP1-8]+){7}\s+[wb]\b/;

/** Parses pasted text as a FEN (single position) or a PGN (game). Untrusted input: size-capped by chess-core. */
export function parseAnalysisInput(text: string): ParsedInput {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, message: 'Paste a PGN or a FEN first.' };

  if (FEN_SHAPE.test(trimmed) && !trimmed.includes('\n')) {
    const r = ChessGame.fromFen(trimmed);
    return r.ok
      ? { ok: true, kind: 'fen', game: r.value }
      : { ok: false, message: 'That is not a valid FEN.' };
  }
  const r = ChessGame.fromPgn(trimmed);
  if (r.ok) return { ok: true, kind: 'pgn', game: r.value };
  return {
    ok: false,
    message:
      r.error === 'input-too-large'
        ? 'That input is too large.'
        : 'Could not read that as a PGN or a FEN.',
  };
}
