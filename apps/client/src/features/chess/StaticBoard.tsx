import { ChessGame, type Color, type Square } from '@chess/chess-core';
import { useMemo } from 'react';
import { ChessBoard } from './ChessBoard';
import { getBoardTheme, getPieceTheme } from './themes';
import { buildTrackedPieces } from './tracked-pieces';
import { useSettings } from '../settings/settings-store';

const NO_TARGETS = (): Square[] => [];
const NEVER = () => false;
const NOOP = () => {};

interface Props {
  size: number;
  fen?: string;
  orientation?: Color;
  lastMove?: { from: Square; to: Square } | null;
  checkSquare?: Square | null;
  /** Override settings theme ids (e.g. to preview a theme before selecting it). */
  boardThemeId?: string;
  pieceThemeId?: string;
}

/** Non-interactive board for hero art and settings previews. */
export function StaticBoard({
  size,
  fen,
  orientation = 'w',
  lastMove = null,
  checkSquare = null,
  boardThemeId,
  pieceThemeId,
}: Props) {
  const settings = useSettings();
  const game = useMemo(() => {
    const r = fen ? ChessGame.fromFen(fen) : { ok: true as const, value: ChessGame.create() };
    return r.ok ? r.value : ChessGame.create();
  }, [fen]);
  const pieces = useMemo(() => buildTrackedPieces(game), [game]);
  return (
    <ChessBoard
      size={size}
      pieces={pieces}
      orientation={orientation}
      turn={game.turn()}
      movableColor={null}
      boardTheme={getBoardTheme(boardThemeId ?? settings.boardThemeId)}
      pieceTheme={getPieceTheme(pieceThemeId ?? settings.pieceThemeId)}
      settings={settings}
      lastMove={lastMove}
      checkSquare={checkSquare}
      getTargets={NO_TARGETS}
      isPromotion={NEVER}
      onMove={NOOP}
      reduceMotion
    />
  );
}
