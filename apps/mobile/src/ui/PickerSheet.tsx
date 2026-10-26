import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SheetFrame } from './ConfirmSheet';
import { Field } from './Field';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { colors, layout, sizes, space } from './tokens';

export interface PickerItem<V = string> {
  /** Unique among the sheet's rows (a row in two sections, such as Recent and All, keeps one key). */
  key: string;
  value: V;
  title: string;
  /** One grey line under the title. */
  subtitle?: string;
  /** More words the search matches (an area, a code). */
  keywords?: string;
  leadingIcon?: IconName;
  /** The current choice: a tick at the end. */
  selected?: boolean;
  /** Under the title, e.g. a StatusChip ("No price yet"). */
  below?: ReactNode;
  /** `action`: a brand-coloured row that does something rather than pick ("+ New address"). */
  tone?: 'default' | 'action';
  /**
   * The sheet stays open when this row is tapped: the host shows more in place instead (a blocked
   * address expands with its reason and "Call office").
   */
  keepOpen?: boolean;
  /** Content shown under the row, e.g. the expanded reason and buttons of a blocked row. */
  expanded?: ReactNode;
  /** A divider above the row ("Make a new link" after the ways to send). */
  dividerBefore?: boolean;
  disabled?: boolean;
  /** Replaces the spoken label built from the title and the grey line. */
  accessibilityLabel?: string;
}

export interface PickerSection<V = string> {
  key: string;
  /** A small label above the rows ("Recent"). Hidden while searching. */
  title?: string;
  items: readonly PickerItem<V>[];
}

export interface PickerSheetProps<V = string> {
  visible: boolean;
  /** 6 words or fewer: "Deliver to", "Send link". */
  title: string;
  /** The rows, or `sections` (recent first). */
  items?: readonly PickerItem<V>[];
  sections?: readonly PickerSection<V>[];
  /**
   * A tap on a row. The sheet then closes, unless the row is `keepOpen`. Returning a promise shows a
   * spinner on the row until it settles; the sheet closes after it either way (the host shows any
   * error on its own screen).
   */
  onPick: (value: V, item: PickerItem<V>) => unknown;
  onClose: () => void;
  /** The search box on top: `auto` (the default) shows it when there are more than 8 rows. */
  search?: boolean | 'auto';
  searchPlaceholder?: string;
  /** Read by screen readers as the search box's name. Default "Search". */
  searchLabel?: string;
  /** Shown when the search matches nothing. Default: `Nothing matches “{{query}}”.` */
  noMatchText?: (query: string) => string;
  /** Shown when there are no rows at all. */
  emptyText?: string;
  testID?: string;
}

/** Search boxes show on lists longer than this (shop spec §10.1). */
const SEARCH_FROM_ROWS = 8;

function matches<V>(item: PickerItem<V>, query: string): boolean {
  const words = `${item.title} ${item.subtitle ?? ''} ${item.keywords ?? ''}`.toLowerCase();
  return words.includes(query);
}

/**
 * Picks one thing from a list in a bottom sheet (UX_PRINCIPLES §3, §7.4): an optional search box on
 * top, recent first, WhatsApp-like rows. A tap picks and closes: no "Done" button. Built from the
 * ConfirmSheet frame (scrim, handle, slide, 90% height, Back closes), `Field` and the `ListRow` look.
 */
export function PickerSheet<V = string>({
  visible,
  title,
  items,
  sections,
  onPick,
  onClose,
  search = 'auto',
  searchPlaceholder,
  searchLabel,
  noMatchText,
  emptyText,
  testID,
}: PickerSheetProps<V>) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Each opening starts with an empty search.
  useEffect(() => {
    if (!visible) {
      setQuery('');
      setBusyKey(null);
    }
  }, [visible]);

  const groups: readonly PickerSection<V>[] = useMemo(
    () => sections ?? [{ key: 'all', items: items ?? [] }],
    [items, sections],
  );
  const allRows = useMemo(() => {
    const seen = new Set<string>();
    const out: PickerItem<V>[] = [];
    for (const group of groups) {
      for (const item of group.items) {
        if (seen.has(item.key)) continue;
        seen.add(item.key);
        out.push(item);
      }
    }
    return out;
  }, [groups]);

  const showSearch = search === true || (search === 'auto' && allRows.length > SEARCH_FROM_ROWS);
  const trimmed = query.trim().toLowerCase();
  const searching = showSearch && trimmed.length > 0;
  const found = searching ? allRows.filter((item) => matches(item, trimmed)) : [];

  const pick = (item: PickerItem<V>) => {
    if (busyKey !== null || item.disabled) return;
    const result = onPick(item.value, item);
    if (item.keepOpen) return;
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      setBusyKey(item.key);
      void Promise.resolve(result)
        .catch(() => undefined)
        .finally(() => {
          if (!mounted.current) return;
          setBusyKey(null);
          onClose();
        });
      return;
    }
    onClose();
  };

  const row = (item: PickerItem<V>) => (
    <PickerRow key={item.key} item={item} busy={busyKey === item.key} locked={busyKey !== null} onPress={() => pick(item)} />
  );

  let body: ReactNode;
  if (allRows.length === 0) {
    body = emptyText ? (
      <Text tone="secondary" style={styles.message}>
        {emptyText}
      </Text>
    ) : null;
  } else if (searching) {
    body = found.length ? (
      found.map(row)
    ) : (
      <Text tone="secondary" style={styles.message}>
        {noMatchText ? noMatchText(query.trim()) : t('common.picker.noMatch', { query: query.trim() })}
      </Text>
    );
  } else {
    body = groups.map((group) =>
      group.items.length ? (
        <View key={group.key}>
          {group.title ? (
            <Text variant="label" tone="secondary" style={styles.sectionTitle}>
              {group.title}
            </Text>
          ) : null}
          {group.items.map(row)}
        </View>
      ) : null,
    );
  }

  return (
    <SheetFrame visible={visible} onClose={onClose} busy={busyKey !== null} testID={testID}>
      <View style={styles.head}>
        <Text variant="title">{title}</Text>
        {showSearch ? (
          <Field
            leadingIcon="search"
            value={query}
            onChangeText={setQuery}
            placeholder={searchPlaceholder}
            accessibilityLabel={searchLabel ?? t('common.picker.search')}
            autoCapitalize="none"
            returnKeyType="search"
          />
        ) : null}
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.list} contentContainerStyle={styles.listContent}>
        {body}
      </ScrollView>
    </SheetFrame>
  );
}

function PickerRow<V>({
  item,
  busy,
  locked,
  onPress,
}: {
  item: PickerItem<V>;
  busy: boolean;
  locked: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const action = item.tone === 'action';
  const spoken =
    item.accessibilityLabel ??
    [item.title, item.subtitle, item.selected ? t('common.picker.chosen') : null].filter(Boolean).join(', ');
  return (
    <View>
      {item.dividerBefore ? <View style={styles.divider} /> : null}
      <Pressable
        onPress={onPress}
        disabled={item.disabled || locked}
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityState={{ selected: !!item.selected, disabled: !!item.disabled, busy }}
        android_ripple={{ color: colors.ripple }}
        style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
      >
        {item.leadingIcon ? (
          <View style={[styles.leading, action ? styles.leadingAction : null]}>
            <Icon name={item.leadingIcon} size={24} tone={action ? 'brand' : 'secondary'} />
          </View>
        ) : null}
        <View style={styles.texts}>
          <Text variant="bodyStrong" tone={item.disabled ? 'disabled' : action ? 'brand' : 'default'} numberOfLines={2}>
            {item.title}
          </Text>
          {item.subtitle ? (
            <Text variant="caption" tone="secondary" numberOfLines={2}>
              {item.subtitle}
            </Text>
          ) : null}
          {item.below ? <View style={styles.below}>{item.below}</View> : null}
        </View>
        {busy ? (
          <ActivityIndicator size="small" color={colors.brand} />
        ) : item.selected ? (
          <Icon name="ok" size={24} tone="brand" />
        ) : null}
      </Pressable>
      {item.expanded ? <View style={styles.expanded}>{item.expanded}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: layout.gutter, paddingBottom: space.sm, gap: space.md },
  // The list gives up its height first; the title and search stay on top.
  list: { flexGrow: 0, flexShrink: 1 },
  listContent: { paddingBottom: space.sm },
  sectionTitle: { paddingHorizontal: layout.gutter, paddingTop: space.md, paddingBottom: space.xs },
  message: { paddingHorizontal: layout.gutter, paddingVertical: space.lg },
  row: {
    minHeight: sizes.listRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.gutter,
    paddingVertical: space.sm,
    backgroundColor: colors.surface,
  },
  rowPressed: { backgroundColor: colors.canvas },
  leading: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leadingAction: { backgroundColor: colors.brandSoft },
  texts: { flex: 1, gap: 2 },
  below: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  expanded: { paddingHorizontal: layout.gutter, paddingBottom: space.md, gap: space.sm },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: space.xs, marginHorizontal: layout.gutter },
});
