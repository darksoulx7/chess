import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../src/components/Button';
import { Screen } from '../../src/components/Screen';
import { colors, radius, spacing, typography } from '../../src/theme/tokens';

function ModeCard({
  title,
  body,
  onPress,
  testID,
}: {
  title: string;
  body: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.card,
        (pressed || hovered) && styles.cardActive,
      ]}
    >
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardBody}>{body}</Text>
    </Pressable>
  );
}

export default function PlayModes() {
  const router = useRouter();
  return (
    <Screen scroll>
      <Text style={styles.title}>Play</Text>
      <View style={styles.cards}>
        <ModeCard
          testID="mode-bot"
          title="Play vs Bot"
          body="Choose a strength from 100 to 2500 and your color."
          onPress={() => router.push('/play/bot-setup')}
        />
        <ModeCard
          testID="mode-online"
          title="Play online"
          body="Challenge a friend with a code, or join an open game."
          onPress={() => router.push('/play/online')}
        />
        <ModeCard
          testID="mode-local"
          title="Play on this device"
          body="Two players share one board."
          onPress={() => router.push('/play/local-setup')}
        />
      </View>
      <Button label="Back" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, ...typography.title },
  cards: { gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardActive: { backgroundColor: colors.surfaceRaised, borderColor: colors.accent },
  cardTitle: { color: colors.text, ...typography.heading },
  cardBody: { color: colors.textMuted, ...typography.body },
});
