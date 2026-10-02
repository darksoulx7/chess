import type { MoveRecord } from '@chess/chess-core';
import { useEffect, useRef } from 'react';
import type { MoveClass } from '@chess/engine';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

interface Props {
  history: MoveRecord[];
  /** Ply (1-based) to highlight; defaults to the last move. */
  activePly?: number;
  onSelectPly?: (ply: number) => void;
  /** Review classification per ply (1-based); inaccuracies, mistakes and blunders get a symbol. */
  annotations?: Partial<Record<number, MoveClass>>;
}

export function MoveList({ history, activePly, onSelectPly, annotations }: Props) {
  const scroll = useRef<ScrollView>(null);
  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: false });
  }, [history.length]);

  const rows: Array<{ number: number; white: MoveRecord; black?: MoveRecord }> = [];
  history.forEach((m, i) => {
    if (i % 2 === 0) rows.push({ number: i / 2 + 1, white: m });
    else {
      const row = rows.at(-1);
      if (row) row.black = m;
    }
  });
  const active = activePly ?? history.length;

  const cell = (m: MoveRecord | undefined, ply: number) =>
    m ? (
      <Text
        onPress={onSelectPly ? () => onSelectPly(ply) : undefined}
        accessibilityRole={onSelectPly ? 'button' : 'text'}
        style={[styles.move, active === ply && styles.active]}
      >
        {m.san}
        {annotations?.[ply] && SYMBOL[annotations[ply] as MoveClass] ? (
          <Text style={{ color: SYMBOL_COLOR[annotations[ply] as MoveClass] }}>
            {' '}
            {SYMBOL[annotations[ply] as MoveClass]}
          </Text>
        ) : null}
      </Text>
    ) : (
      <View style={styles.move} />
    );

  return (
    <ScrollView ref={scroll} style={styles.root} testID="move-list">
      {rows.length === 0 ? <Text style={styles.empty}>No moves yet</Text> : null}
      {rows.map((r) => (
        <View key={r.number} style={styles.row}>
          <Text style={styles.number}>{r.number}.</Text>
          {cell(r.white, r.number * 2 - 1)}
          {cell(r.black, r.number * 2)}
        </View>
      ))}
    </ScrollView>
  );
}

const SYMBOL: Partial<Record<MoveClass, string>> = {
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
};
const SYMBOL_COLOR: Partial<Record<MoveClass, string>> = {
  inaccuracy: '#f5c542',
  mistake: '#f59e42',
  blunder: '#f87171',
};

const styles = StyleSheet.create({
  root: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 2 },
  number: { width: 36, color: '#71717a', fontSize: 14, fontVariant: ['tabular-nums'] },
  move: {
    flex: 1,
    color: '#e4e4e7',
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  active: { backgroundColor: '#2f3a52', color: '#ffffff' },
  empty: { color: '#71717a', fontSize: 14, paddingVertical: 8 },
});
