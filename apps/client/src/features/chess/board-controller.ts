import type { MoveInput, Piece, Square } from '@chess/chess-core';
import { pointToSquare } from './geometry';
import {
  IDLE,
  dropPiece,
  pressSquare,
  tapSquare,
  type InteractionContext,
  type InteractionState,
} from './interaction';
import type { Color } from '@chess/chess-core';

export interface ControllerHooks {
  setInteraction(state: InteractionState): void;
  /** Called with a candidate move; `instant` is true for drag-and-drop (no slide animation). */
  emitMove(move: MoveInput, instant: boolean): void;
  startDrag(pieceId: string, x: number, y: number): void;
  moveDrag(x: number, y: number): void;
  endDrag(): void;
}

export interface ControllerSync {
  ctx: InteractionContext;
  interaction: InteractionState;
  pieceAt(square: Square): (Piece & { id: string }) | null;
  orientation: Color;
  size: number;
}

/**
 * Turns raw pointer events (press / drag / tap) into interaction transitions.
 * Plain TypeScript so it is unit-testable and free of React ref juggling: the board keeps it
 * in sync with the latest props via `sync()` and gesture callbacks just forward coordinates.
 */
export class BoardController {
  private current: ControllerSync | null = null;
  private origin: Square | null = null;
  private drag: { from: Square } | null = null;

  constructor(private readonly hooks: ControllerHooks) {}

  sync(next: ControllerSync): void {
    this.current = next;
  }

  /** Pointer went down (before we know if it is a tap or a drag). */
  begin(x: number, y: number): void {
    const c = this.current;
    this.origin = c ? pointToSquare(x, y, c.size, c.orientation) : null;
  }

  /** Movement passed the drag threshold. */
  startDrag(x: number, y: number): void {
    const c = this.current;
    const from = this.origin;
    if (!c || !from) return;
    const press = pressSquare(c.interaction, from, c.ctx);
    const piece = c.pieceAt(from);
    if (!press.draggable || !piece) return;
    this.hooks.setInteraction(press.state);
    this.drag = { from };
    const half = c.size / 16;
    this.hooks.startDrag(piece.id, x - half, y - half);
  }

  updateDrag(x: number, y: number): void {
    const c = this.current;
    if (!c || !this.drag) return;
    const half = c.size / 16;
    this.hooks.moveDrag(x - half, y - half);
  }

  /** Pointer released/cancelled. `completed` is false when the system cancelled the gesture. */
  finishDrag(x: number, y: number, completed: boolean): void {
    const c = this.current;
    const drag = this.drag;
    this.drag = null;
    if (!c || !drag) return;
    const to = completed ? pointToSquare(x, y, c.size, c.orientation) : null;
    const outcome = dropPiece(c.interaction, drag.from, to, c.ctx);
    this.hooks.setInteraction(outcome.state);
    this.hooks.endDrag();
    if (outcome.move) this.hooks.emitMove(outcome.move, true);
  }

  tap(x: number, y: number): void {
    const c = this.current;
    if (!c) return;
    const square = pointToSquare(x, y, c.size, c.orientation);
    if (square) this.tapSquare(square);
  }

  /** Same as a tap, addressed by square (keyboard input). */
  tapSquare(square: Square): void {
    const c = this.current;
    if (!c) return;
    const outcome = tapSquare(c.interaction, square, c.ctx);
    this.hooks.setInteraction(outcome.state);
    if (outcome.move) this.hooks.emitMove(outcome.move, false);
  }

  reset(): void {
    this.origin = null;
    this.drag = null;
    this.hooks.setInteraction(IDLE);
  }
}
