import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { BOT_ERROR_TEXT } from '../../services/bot-api';
import { colors, radius, spacing, typography } from '../../theme/tokens';
import { formatPv, scoreLabel, toWhite } from './analysis-format';
import type { EngineAnalysisState } from './use-engine-analysis';

interface Props {
  engineOn: boolean;
  state: EngineAnalysisState;
  depth: number;
}

export function EngineLines({ engineOn, state, depth }: Props) {
  const { data, analyzing, error } = state;
  return (
    <View style={styles.box} testID="engine-lines">
      <View style={styles.header}>
        <Text style={styles.title}>Engine</Text>
        <Text style={styles.meta}>
          {!engineOn
            ? 'off'
            : analyzing
              ? `analyzing… (depth ${depth})`
              : data
                ? `depth ${data.depth}${data.cached ? ' · cached' : ''}`
                : ''}
        </Text>
      </View>
      {!engineOn ? (
        <Text style={styles.muted}>Turn the engine on to see evaluations and best moves.</Text>
      ) : error ? (
        <View style={styles.errorRow}>
          <Text style={styles.error}>{BOT_ERROR_TEXT[error.code]}</Text>
          <Button label="Retry" onPress={state.refetch} />
        </View>
      ) : data?.terminal ? (
        <Text style={styles.body}>
          {data.terminal.state === 'checkmate'
            ? `Checkmate — ${data.terminal.winner === 'w' ? 'White' : 'Black'} wins`
            : `Draw (${data.terminal.reason})`}
        </Text>
      ) : data && data.lines.length > 0 ? (
        data.lines.map((line) => (
          <View key={line.multipv} style={styles.line} testID={`engine-line-${line.multipv}`}>
            <Text style={[styles.score, line.multipv === 1 && styles.scoreBest]}>
              {scoreLabel(toWhite(line.score, data.fen.split(' ')[1] === 'b' ? 'b' : 'w'))}
            </Text>
            <Text style={styles.pv} numberOfLines={2}>
              {formatPv(line.san, data.fen)}
            </Text>
          </View>
        ))
      ) : (
        <Text style={styles.muted}>{analyzing ? 'Analyzing…' : 'No analysis yet.'}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { color: colors.text, ...typography.heading },
  meta: { color: colors.textFaint, ...typography.caption },
  muted: { color: colors.textMuted, ...typography.body },
  body: { color: colors.text, ...typography.body },
  line: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  score: { width: 56, color: colors.textMuted, ...typography.label, fontVariant: ['tabular-nums'] },
  scoreBest: { color: colors.text },
  pv: { flex: 1, color: colors.text, ...typography.body },
  errorRow: { gap: spacing.sm },
  error: { color: colors.danger, ...typography.body },
});
