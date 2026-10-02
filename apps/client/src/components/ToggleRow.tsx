import { StyleSheet, Switch, Text, View } from 'react-native';
import { TOUCH_TARGET, colors, spacing, typography } from '../theme/tokens';

interface Props {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

export function ToggleRow({ label, hint, value, onChange }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.accent, false: colors.surfaceHover }}
        thumbColor="#ffffff"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingVertical: spacing.xs,
  },
  text: { flex: 1 },
  label: { color: colors.text, ...typography.body },
  hint: { color: colors.textFaint, ...typography.caption, marginTop: 2 },
});
