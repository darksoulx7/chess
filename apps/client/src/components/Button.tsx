import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { TOUCH_TARGET, colors, radius, spacing, typography } from '../theme/tokens';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** For icon-only labels ("◀") where the visible text is not a good accessible name. */
  accessibilityLabelOverride?: string;
}

export function Button({
  label,
  onPress,
  variant = 'secondary',
  disabled,
  style,
  testID,
  accessibilityLabelOverride,
}: Props) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabelOverride ?? label}
      aria-disabled={!!disabled}
      disabled={disabled}
      onPress={onPress}
      style={({
        pressed,
        hovered,
        focused,
      }: {
        pressed: boolean;
        hovered?: boolean;
        focused?: boolean;
      }) => [
        styles.base,
        variantStyles[variant],
        (pressed || hovered) && !disabled && pressedStyles[variant],
        focused && styles.focus,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={[styles.text, variant === 'primary' && styles.textOnAccent]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { color: colors.text, ...typography.heading, fontSize: 15 },
  textOnAccent: { color: colors.onAccent },
  disabled: { opacity: 0.4 },
  focus: { borderWidth: 2, borderColor: colors.focus },
});

const variantStyles = StyleSheet.create({
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.surfaceRaised },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: '#3b1f24' },
});

const pressedStyles = StyleSheet.create({
  primary: { backgroundColor: colors.accentPressed },
  secondary: { backgroundColor: colors.surfaceHover },
  ghost: { backgroundColor: colors.surfaceRaised },
  danger: { backgroundColor: '#4b2830' },
});
