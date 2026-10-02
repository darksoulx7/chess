import type { Color, Square } from '@chess/chess-core';
import { squareToPoint, type Point } from './geometry';

export interface ArrowGeometry {
  /** `true` when from === to: draw a ring around the square instead of an arrow. */
  circle: boolean;
  cx: number;
  cy: number;
  /** Shaft from (x1,y1) to (x2,y2); head triangle points. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  head: [Point, Point, Point];
}

/** Pure geometry for an annotation arrow between two squares of a board of side `size`. */
export function arrowGeometry(
  from: Square,
  to: Square,
  size: number,
  orientation: Color,
): ArrowGeometry {
  const cell = size / 8;
  const a = squareToPoint(from, size, orientation);
  const b = squareToPoint(to, size, orientation);
  const x1 = a.x + cell / 2;
  const y1 = a.y + cell / 2;
  const tx = b.x + cell / 2;
  const ty = b.y + cell / 2;
  const dx = tx - x1;
  const dy = ty - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) {
    return {
      circle: true,
      cx: x1,
      cy: y1,
      x1,
      y1,
      x2: x1,
      y2: y1,
      head: [
        { x: x1, y: y1 },
        { x: x1, y: y1 },
        { x: x1, y: y1 },
      ],
    };
  }
  const ux = dx / len;
  const uy = dy / len;
  const headLen = Math.min(cell * 0.42, len * 0.6);
  const half = cell * 0.26;
  const tipX = tx - ux * cell * 0.08; // stop just short of the centre so the piece stays readable
  const tipY = ty - uy * cell * 0.08;
  const baseX = tipX - ux * headLen;
  const baseY = tipY - uy * headLen;
  return {
    circle: false,
    cx: tx,
    cy: ty,
    x1: x1 + ux * cell * 0.22,
    y1: y1 + uy * cell * 0.22,
    x2: baseX,
    y2: baseY,
    head: [
      { x: tipX, y: tipY },
      { x: baseX - uy * half, y: baseY + ux * half },
      { x: baseX + uy * half, y: baseY - ux * half },
    ],
  };
}
