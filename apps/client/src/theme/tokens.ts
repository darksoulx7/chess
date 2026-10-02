import type { TextStyle } from 'react-native';

/** Design tokens. Components consume these; nothing else hardcodes colors or spacing. */
export const colors = {
  bg: '#0f1115',
  surface: '#171a21',
  surfaceRaised: '#1f2430',
  surfaceHover: '#272d3b',
  border: '#2a303d',
  text: '#f4f4f5',
  textMuted: '#a1a1aa',
  textFaint: '#71717a',
  accent: '#7aa2ff',
  accentPressed: '#5f8cf5',
  onAccent: '#0b1020',
  success: '#4ade80',
  danger: '#f87171',
  scrim: '#000000b3',
  focus: '#ffffff',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

export const typography = {
  display: { fontSize: 40, fontWeight: '800', letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: '700' },
  heading: { fontSize: 17, fontWeight: '700' },
  body: { fontSize: 15, fontWeight: '500' },
  label: { fontSize: 13, fontWeight: '600', letterSpacing: 0.3 },
  caption: { fontSize: 12, fontWeight: '500' },
  mono: { fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
} satisfies Record<string, TextStyle>;

export const motion = { fast: 120, normal: 200, slow: 320 } as const;

/** Minimum touch target (px), per platform accessibility guidance. */
export const TOUCH_TARGET = 44;

export const elevation = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  sheet: {
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
} as const;
