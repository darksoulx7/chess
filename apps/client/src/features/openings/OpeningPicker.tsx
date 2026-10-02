import { FEATURED_FAMILIES, formatOpeningLine, getOpeningIndex } from '@chess/openings';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Segmented } from '../../components/Segmented';
import { TOUCH_TARGET, colors, radius, spacing, typography } from '../../theme/tokens';
import {
  DEPTH_CHOICES,
  selectionFromNode,
  variationRows,
  type OpeningSelection,
} from './picker-model';

interface Props {
  value: OpeningSelection;
  onChange: (next: OpeningSelection) => void;
}

export function OpeningPicker({ value, onChange }: Props) {
  const index = getOpeningIndex();
  const [query, setQuery] = useState('');
  const enabled = value.familyId !== null;

  const featured = useMemo(
    () =>
      FEATURED_FAMILIES.map((name) => index.families.find((f) => f.name === name)).filter(
        (f): f is NonNullable<typeof f> => !!f,
      ),
    [index],
  );
  const hits = useMemo(() => (query.trim() ? index.search(query, 8) : []), [index, query]);
  const family = value.familyId ? index.get(value.familyId) : undefined;
  const rows = useMemo(
    () => (value.familyId ? variationRows(index, value.familyId) : []),
    [index, value.familyId],
  );
  const selectedNode =
    value.variation !== 'any' && value.variation !== 'random' ? index.get(value.variation) : family;

  return (
    <View style={styles.root}>
      <Segmented
        label="Opening"
        value={enabled ? 'on' : 'off'}
        onChange={(v) =>
          onChange(
            v === 'off'
              ? { ...value, familyId: null, variation: 'any' }
              : { ...value, familyId: featured[0]?.id ?? null, variation: 'any' },
          )
        }
        options={[
          { value: 'off', label: 'Bot chooses' },
          { value: 'on', label: 'Choose opening' },
        ]}
      />

      {enabled ? (
        <>
          <Text style={styles.sub}>Family</Text>
          <Segmented
            label="Opening family"
            value={value.familyId ?? ''}
            onChange={(id) => onChange({ ...value, familyId: id, variation: 'any' })}
            options={featured.map((f) => ({ value: f.id, label: f.name }))}
          />
          <TextInput
            accessibilityLabel="Search openings"
            placeholder="Search all openings (e.g. Najdorf, King's Gambit)…"
            placeholderTextColor={colors.textFaint}
            value={query}
            onChangeText={setQuery}
            style={styles.input}
          />
          {hits.length > 0 ? (
            <View style={styles.list}>
              {hits.map((h) => (
                <Row
                  key={h.id}
                  title={h.name}
                  meta={`${h.eco} · ${formatOpeningLine(h.moves, 8)}`}
                  onPress={() => {
                    const sel = selectionFromNode(index, h.id, value.maxMoves);
                    if (sel) onChange(sel);
                    setQuery('');
                  }}
                />
              ))}
            </View>
          ) : null}

          {family ? (
            <>
              <Text style={styles.sub}>Variation in {family.name}</Text>
              <ScrollView style={styles.list} nestedScrollEnabled testID="variation-list">
                <Row
                  title="Any line"
                  meta={`The whole ${family.name}`}
                  selected={value.variation === 'any'}
                  onPress={() => onChange({ ...value, variation: 'any' })}
                />
                <Row
                  title="Random variation"
                  meta="Picked when the game starts"
                  selected={value.variation === 'random'}
                  onPress={() => onChange({ ...value, variation: 'random' })}
                />
                {rows.map((r) => (
                  <Row
                    key={r.id}
                    title={r.label}
                    meta={r.eco}
                    selected={value.variation === r.id}
                    onPress={() => onChange({ ...value, variation: r.id })}
                  />
                ))}
              </ScrollView>
              {selectedNode && selectedNode.moves.length > 0 ? (
                <Text style={styles.line} testID="opening-line">
                  {selectedNode.name}: {formatOpeningLine(selectedNode.moves)}
                </Text>
              ) : null}
            </>
          ) : null}

          <Text style={styles.sub}>Opening depth (moves)</Text>
          <Segmented
            label="Opening depth"
            value={String(value.maxMoves)}
            onChange={(v) => onChange({ ...value, maxMoves: Number(v) })}
            options={DEPTH_CHOICES.map((d) => ({ value: String(d), label: String(d) }))}
          />
          <Text style={styles.hint}>
            The bot follows the line while you do; if you leave it, or after this many moves, it
            plays by its own strength.
          </Text>
        </>
      ) : null}
    </View>
  );
}

function Row({
  title,
  meta,
  selected,
  onPress,
}: {
  title: string;
  meta: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      aria-checked={!!selected}
      accessibilityLabel={title}
      onPress={onPress}
      style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
        styles.row,
        (hovered || pressed) && styles.rowActive,
        selected && styles.rowSelected,
      ]}
    >
      <Text style={styles.rowTitle} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.rowMeta} numberOfLines={1}>
        {meta}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  sub: { color: colors.textMuted, ...typography.label, marginTop: spacing.xs },
  input: {
    minHeight: TOUCH_TARGET,
    backgroundColor: colors.surfaceRaised,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    ...typography.body,
  },
  list: {
    maxHeight: 260,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: {
    minHeight: TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
  },
  rowActive: { backgroundColor: colors.surfaceRaised },
  rowSelected: { backgroundColor: '#1d2a49' },
  rowTitle: { color: colors.text, ...typography.body },
  rowMeta: { color: colors.textFaint, ...typography.caption },
  line: { color: colors.textMuted, ...typography.body },
  hint: { color: colors.textFaint, ...typography.caption },
});
