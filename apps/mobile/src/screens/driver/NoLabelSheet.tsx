import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { ReturnState } from '@smartfleet/shared-types';
import {
  ActionLine,
  Button,
  ChoiceChips,
  SegmentedControl,
  SheetFrame,
  Stepper,
  Text,
  layout,
  space,
  type ChoiceChipOption,
  type SegmentOption,
} from '../../ui';
import type { UnlabelledItem } from './tripApi';
import { RETURN_STATES } from './tripModel';

/** The most of one size and state a visit can take back with no label (API_CONTRACT §9.3: 0–30). */
const MAX_COUNT = 30;

export interface NoLabelSheetProps {
  visible: boolean;
  /** The sizes to pick from: the order's first, then the other known sizes. */
  sizes: readonly ChoiceChipOption<string>[];
  /** The visit's list as the server has it: the sheet edits one size and state of it. */
  rows: readonly UnlabelledItem[];
  /** What the sheet opens on: a row being changed, or the first size with the tapped state. */
  start: { cylinderTypeId: string; state: ReturnState } | null;
  /** Sends the visit's whole new list (`PUT …/unlabelled-returns`); a rejection stays on the sheet. */
  onSave: (items: UnlabelledItem[]) => Promise<unknown>;
  onClose: () => void;
}

/**
 * "No label or other brand" (driver spec R5; rulebook §7.4 names this sheet): returns with no Smart
 * Fleet label are counted by size, with three tap controls and no typing: the size (chips, 2 columns),
 * the state (Empty | Part-filled | Full) and how many (0 to 30, where 0 removes the row). Save sends the
 * visit's whole list; closing it saves nothing. These count as taken back, but get no holder (ADR-13).
 */
export function NoLabelSheet({ visible, sizes, rows, start, onSave, onClose }: NoLabelSheetProps) {
  const { t } = useTranslation();
  const [size, setSize] = useState<string>('');
  const [state, setState] = useState<ReturnState>('EMPTY');
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const countOf = (cylinderTypeId: string, returnState: ReturnState): number | null =>
    rows.find((row) => row.cylinderTypeId === cylinderTypeId && row.state === returnState)?.count ?? null;

  // Each opening starts on its row (or the first size), with that row's count, or 1.
  useEffect(() => {
    if (!visible) return;
    const first = start?.cylinderTypeId || sizes[0]?.value || '';
    const firstState = start?.state ?? 'EMPTY';
    setSize(first);
    setState(firstState);
    setCount(countOf(first, firstState) ?? 1);
    setError(null);
    setBusy(false);
    // Only on opening: the rows refresh under an open sheet without moving its controls.
  }, [visible]);

  const pick = (nextSize: string, nextState: ReturnState) => {
    setSize(nextSize);
    setState(nextState);
    const existing = countOf(nextSize, nextState);
    if (existing !== null) setCount(existing);
  };

  const save = async () => {
    if (busy || !size) return;
    setBusy(true);
    setError(null);
    const others = rows.filter((row) => !(row.cylinderTypeId === size && row.state === state));
    try {
      await onSave([...others, { cylinderTypeId: size, state, count }]);
      if (mounted.current) {
        setBusy(false);
        onClose();
      }
    } catch (thrown) {
      if (mounted.current) {
        setBusy(false);
        setError(thrown);
      }
    }
  };

  const stateOptions: SegmentOption<ReturnState>[] = RETURN_STATES.map((value) => ({
    value,
    label: t(`scan.state.${value}`),
    icon: value === 'EMPTY' ? 'empty' : value === 'PART_FILLED' ? 'partFilled' : 'full',
  }));

  return (
    <SheetFrame visible={visible} onClose={onClose} busy={busy} testID="visit.noLabelSheet">
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text variant="title">{t('driver.visit.noLabel.title')}</Text>
        <View style={styles.group}>
          <Text variant="label">{t('driver.visit.noLabel.size')}</Text>
          <ChoiceChips
            options={sizes}
            value={size}
            onChange={(value) => pick(value, state)}
            columns={2}
            accessibilityLabel={t('driver.visit.noLabel.size')}
          />
        </View>
        <View style={styles.group}>
          <Text variant="label">{t('driver.visit.noLabel.state')}</Text>
          <SegmentedControl
            options={stateOptions}
            value={state}
            onChange={(value) => pick(size, value)}
            accessibilityLabel={t('driver.visit.noLabel.state')}
          />
        </View>
        <Stepper
          label={t('driver.visit.noLabel.count')}
          value={count}
          min={0}
          max={MAX_COUNT}
          onChange={setCount}
          disabled={busy}
          testID="visit.noLabelCount"
        />
      </ScrollView>
      <View style={styles.pinned}>
        <ActionLine error={error} inSheet />
        <Button
          label={t('driver.visit.noLabel.save')}
          loadingLabel={t('driver.visit.noLabel.saving')}
          loading={busy}
          disabled={!size}
          onPress={() => void save()}
          size="lg"
          testID="visit.noLabelSave"
        />
        <Button label={t('driver.visit.noLabel.cancel')} onPress={onClose} variant="secondary" size="lg" disabled={busy} />
      </View>
    </SheetFrame>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { paddingHorizontal: layout.gutter, paddingBottom: space.md, gap: space.lg },
  group: { gap: space.sm },
  pinned: { flexShrink: 0, gap: space.sm, paddingHorizontal: layout.gutter, paddingTop: space.sm },
});
