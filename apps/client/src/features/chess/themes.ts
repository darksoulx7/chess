import type { PieceType } from '@chess/chess-core';

export interface BoardTheme {
  id: string;
  name: string;
  lightSquare: string;
  darkSquare: string;
  selectedSquare: string;
  lastMoveLight: string;
  lastMoveDark: string;
  checkSquare: string;
  legalMove: string;
  captureIndicator: string;
}

export interface PieceStyle {
  fill: string;
  stroke: string;
}

export interface PieceTheme {
  id: string;
  name: string;
  white: PieceStyle;
  black: PieceStyle;
  strokeWidth: number;
  /** Draw interior detail lines (bishop slash, knight eye) */
  detail: boolean;
}

export const BOARD_THEMES: readonly BoardTheme[] = [
  {
    id: 'classic',
    name: 'Classic',
    lightSquare: '#eeeed2',
    darkSquare: '#769656',
    selectedSquare: '#f6f669b3',
    lastMoveLight: '#f5f682',
    lastMoveDark: '#b9ca43',
    checkSquare: '#e8453c',
    legalMove: '#00000033',
    captureIndicator: '#00000040',
  },
  {
    id: 'wood',
    name: 'Wood',
    lightSquare: '#f0d9b5',
    darkSquare: '#b58863',
    selectedSquare: '#ffe27acc',
    lastMoveLight: '#f7ec74',
    lastMoveDark: '#dbc34a',
    checkSquare: '#e8453c',
    legalMove: '#00000035',
    captureIndicator: '#00000045',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    lightSquare: '#8d9db6',
    darkSquare: '#3b4a6b',
    selectedSquare: '#7aa2ffcc',
    lastMoveLight: '#9db8f2',
    lastMoveDark: '#5873b5',
    checkSquare: '#ff5d5d',
    legalMove: '#ffffff40',
    captureIndicator: '#ffffff55',
  },
  {
    id: 'emerald',
    name: 'Emerald',
    lightSquare: '#dcefe1',
    darkSquare: '#2f8f6b',
    selectedSquare: '#fff176cc',
    lastMoveLight: '#c9f27a',
    lastMoveDark: '#7fc24a',
    checkSquare: '#e8453c',
    legalMove: '#00000033',
    captureIndicator: '#00000045',
  },
  {
    id: 'royal',
    name: 'Royal',
    lightSquare: '#e6dcf5',
    darkSquare: '#7a5cb0',
    selectedSquare: '#ffd54fcc',
    lastMoveLight: '#f0d878',
    lastMoveDark: '#c9a43c',
    checkSquare: '#e8453c',
    legalMove: '#00000033',
    captureIndicator: '#00000045',
  },
  {
    id: 'minimal',
    name: 'Minimal',
    lightSquare: '#ececec',
    darkSquare: '#b5b5b5',
    selectedSquare: '#5b9dffa6',
    lastMoveLight: '#cfe0ff',
    lastMoveDark: '#9bb8ec',
    checkSquare: '#e8453c',
    legalMove: '#00000030',
    captureIndicator: '#00000040',
  },
  {
    id: 'neon',
    name: 'Neon',
    lightSquare: '#2a2a40',
    darkSquare: '#14141f',
    selectedSquare: '#00f5d4aa',
    lastMoveLight: '#3d2a6b',
    lastMoveDark: '#2a1a50',
    checkSquare: '#ff2d6f',
    legalMove: '#00f5d466',
    captureIndicator: '#00f5d480',
  },
];

export const PIECE_THEMES: readonly PieceTheme[] = [
  {
    id: 'classic',
    name: 'Classic',
    white: { fill: '#f8f4ea', stroke: '#1b1b1d' },
    black: { fill: '#3a3a40', stroke: '#0b0b0c' },
    strokeWidth: 3,
    detail: true,
  },
  {
    id: 'modern',
    name: 'Modern',
    white: { fill: '#ffffff', stroke: '#52525b' },
    black: { fill: '#1c1c21', stroke: '#000000' },
    strokeWidth: 2,
    detail: false,
  },
  {
    id: 'minimal',
    name: 'Minimal',
    white: { fill: '#fafafa', stroke: '#18181b' },
    black: { fill: '#18181b', stroke: '#18181b' },
    strokeWidth: 4,
    detail: false,
  },
];

export const DEFAULT_BOARD_THEME = BOARD_THEMES[0] as BoardTheme;
export const DEFAULT_PIECE_THEME = PIECE_THEMES[0] as PieceTheme;

export function getBoardTheme(id: string): BoardTheme {
  return BOARD_THEMES.find((t) => t.id === id) ?? DEFAULT_BOARD_THEME;
}

export function getPieceTheme(id: string): PieceTheme {
  return PIECE_THEMES.find((t) => t.id === id) ?? DEFAULT_PIECE_THEME;
}

export const PIECE_NAMES: Record<PieceType, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};
