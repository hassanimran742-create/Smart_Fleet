import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import type { PaisaLike } from '@smartfleet/shared-utils';
import { ActionLine } from './ActionLine';
import { Button } from './Button';
import type { ErrorBannerAction } from './ErrorBanner';
import { Field } from './Field';
import { Icon } from './Icon';
import { MoneyText } from './MoneyText';
import { Text } from './Text';
import { colors, elevation, layout, motion, radius, sizes, space } from './tokens';
import { useReduceMotion } from './useReduceMotion';

// ---- The sheet frame: shared by ConfirmSheet and PickerSheet -----------------------------------

export interface SheetFrameProps {
  visible: boolean;
  /** Back and the scrim call it, unless the sheet is busy. */
  onClose: () => void;
  /** While true, Back and the scrim don't close the sheet (a request is running). */
  busy?: boolean;
  children?: ReactNode;
  testID?: string;
}

/**
 * The bottom sheet's frame (UX_PRINCIPLES §7.4): the scrim, the handle, a 220 ms slide (none under
 * reduce-motion), at most 90% of the height, and Back or a tap outside closes it unless it is busy.
 * The content lays itself out inside: a scroll area, then anything pinned under it.
 *
 * No `statusBarTranslucent`: on Android a translucent Modal doesn't fit system windows, so the keyboard
 * never resizes it and covers the note for "Other" and the buttons (RN 0.74 ReactModalHostView).
 * Resized, the sheet shrinks to the space above the keyboard and its scroll area scrolls.
 */
export function SheetFrame({ visible, onClose, busy = false, children, testID }: SheetFrameProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const translateY = useRef(new Animated.Value(height)).current;

  useEffect(() => {
    if (!visible) {
      translateY.setValue(height);
      return;
    }
    if (reduceMotion) {
      translateY.setValue(0);
      return;
    }
    translateY.setValue(height);
    Animated.timing(translateY, { toValue: 0, duration: motion.sheet, useNativeDriver: true }).start();
  }, [visible, reduceMotion, height, translateY]);

  const close = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={close}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Tapping outside closes; screen readers use the sheet's own cancel or Back instead. */}
        <Pressable style={styles.scrim} onPress={close} importantForAccessibility="no" />
        <Animated.View
          testID={testID}
          accessibilityViewIsModal
          style={[
            styles.sheet,
            elevation.sheet,
            { paddingBottom: insets.bottom + space.lg, maxHeight: height * 0.9, transform: [{ translateY }] },
          ]}
        >
          <View style={styles.handle} />
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---- ConfirmSheet ------------------------------------------------------------------------------

export interface ConfirmReason {
  code: string;
  label: string;
}

/** What the person chose in the sheet. */
export interface ConfirmInput {
  reasonCode?: string;
  note?: string;
}

export interface ConfirmSheetProps {
  visible: boolean;
  title: string;
  body?: string;
  /** A money amount shown large, e.g. the refund. */
  amountPaisa?: PaisaLike | null;
  amountLabel?: string;
  /** Radio reasons (reason codes from shared-types with their words). */
  reasons?: readonly ConfirmReason[];
  /** The words above the reasons. Default "Why?" (`common.confirm.why`). */
  reasonsLabel?: string;
  /**
   * A reason must be picked. The confirm stays enabled: pressed without one, the label above the
   * reasons turns into `pickReasonLabel` in danger text and the reasons scroll into view.
   */
  requireReason?: boolean;
  /** Default "Pick a reason." (`common.confirm.pickReason`). */
  pickReasonLabel?: string;
  /** Picking `otherCode` ("OTHER") asks for a note of 3–300 characters (API_CONTRACT §1.5). */
  noteForOther?: boolean;
  otherCode?: string;
  noteLabel?: string;
  noteMin?: number;
  noteMax?: number;
  confirmLabel: string;
  /** `danger` only for losing money or no undo (UX_PRINCIPLES §7.4). */
  confirmTone?: 'primary' | 'danger';
  /** Shown on the confirm button while `onConfirm` runs. */
  confirmLoadingLabel?: string;
  /** Says what stays ("Keep order"). An outlined button the same size as the confirm. */
  cancelLabel: string;
  /** Runs the action. A rejection keeps the sheet open with its line above the buttons; success closes it. */
  onConfirm: (input: ConfirmInput) => Promise<unknown> | unknown;
  onClose: () => void;
  /** The error line's button: left out, the error's own ("Call office"…); `null`, none. */
  errorAction?: ErrorBannerAction | null;
  /** Extra content under the body, e.g. a "terms changed" notice. */
  children?: ReactNode;
  testID?: string;
}

const NOTE_MIN = 3;
const NOTE_MAX = 300;

/**
 * Confirms a money or no-undo action (UX_MOBILE §2.2 #19; UX_PRINCIPLES rule 7, §7.4). A bottom sheet
 * with the title, the money big, optional reasons ("Why?") and a note for "Other". The confirm and
 * the outlined cancel are pinned under the scroll area, so they never scroll off; the error line sits
 * directly above them. The confirm shows its loading label; an error keeps the sheet open; Back
 * closes it unless it is busy.
 */
export function ConfirmSheet({
  visible,
  title,
  body,
  amountPaisa,
  amountLabel,
  reasons,
  reasonsLabel,
  requireReason = false,
  pickReasonLabel,
  noteForOther = false,
  otherCode = 'OTHER',
  noteLabel,
  noteMin = NOTE_MIN,
  noteMax = NOTE_MAX,
  confirmLabel,
  confirmTone = 'primary',
  confirmLoadingLabel,
  cancelLabel,
  onConfirm,
  onClose,
  errorAction,
  children,
  testID,
}: ConfirmSheetProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<ScrollView>(null);
  const reasonsY = useRef(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [reason, setReason] = useState<string | undefined>(undefined);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // Set by a press that was missing something: the reason label and the note error then show.
  const [attempted, setAttempted] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Reset on close, so the next opening starts fresh without a frame of the old choice.
  useEffect(() => {
    if (visible) return;
    setReason(undefined);
    setNote('');
    setError(null);
    setBusy(false);
    setAttempted(false);
  }, [visible]);

  const hasReasons = !!reasons?.length;
  const needsNote = noteForOther && reason === otherCode;
  const trimmedNote = note.trim();
  const noteOk = !needsNote || (trimmedNote.length >= noteMin && trimmedNote.length <= noteMax);
  const reasonOk = !requireReason || !hasReasons || reason !== undefined;
  const missingReason = attempted && !reasonOk;

  const confirm = async () => {
    if (busy) return;
    if (!reasonOk || !noteOk) {
      setAttempted(true);
      // Show what is missing: the reasons ("Pick a reason.") or the note's error under the field.
      if (!reasonOk) scrollRef.current?.scrollTo({ y: Math.max(0, reasonsY.current - space.md), animated: true });
      else scrollRef.current?.scrollToEnd({ animated: true });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ reasonCode: reason, note: needsNote ? trimmedNote : undefined });
      if (mounted.current) {
        setBusy(false);
        onClose();
      }
    } catch (thrown) {
      if (mounted.current) {
        setError(thrown);
        setBusy(false);
      }
    }
  };

  const noteError =
    needsNote && !noteOk && (attempted || trimmedNote.length > noteMax)
      ? t('validation.NOTE_REQUIRED', { replace: { min: noteMin } })
      : null;

  return (
    <SheetFrame visible={visible} onClose={onClose} busy={busy} testID={testID}>
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        style={styles.scroll}
        contentContainerStyle={styles.content}
        onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
        onContentSizeChange={(_width, height) => {
          setContentHeight(height);
          // The note's error line renders after the press that asked for it: scroll again once it has,
          // so the line ends up in view above the pinned buttons, not under them.
          if (attempted && needsNote && !noteOk) scrollRef.current?.scrollToEnd({ animated: true });
        }}
      >
        <Text variant="title">{title}</Text>
        {body ? <Text tone="secondary">{body}</Text> : null}
        {amountPaisa !== undefined && amountPaisa !== null ? (
          <View style={styles.amount}>
            {amountLabel ? (
              <Text variant="label" tone="secondary">
                {amountLabel}
              </Text>
            ) : null}
            <MoneyText paisa={amountPaisa} variant="title" />
          </View>
        ) : null}
        {children}
        {hasReasons ? (
          <View
            style={styles.reasons}
            onLayout={(event) => {
              reasonsY.current = event.nativeEvent.layout.y;
            }}
          >
            <Text
              variant="label"
              tone={missingReason ? 'danger' : 'default'}
              accessibilityLiveRegion={missingReason ? 'assertive' : 'none'}
            >
              {missingReason ? pickReasonLabel ?? t('common.confirm.pickReason') : reasonsLabel ?? t('common.confirm.why')}
            </Text>
            <View accessibilityRole="radiogroup" style={styles.reasonRows}>
              {reasons?.map((option) => {
                const selected = option.code === reason;
                return (
                  <Pressable
                    key={option.code}
                    onPress={() => {
                      setReason(option.code);
                      // A new choice starts clean: "Other" asks for its note on the next press, not now.
                      setAttempted(false);
                    }}
                    disabled={busy}
                    accessibilityRole="radio"
                    accessibilityLabel={option.label}
                    accessibilityState={{ checked: selected, disabled: busy }}
                    android_ripple={{ color: colors.ripple }}
                    style={[styles.reason, selected ? styles.reasonSelected : null]}
                  >
                    <Icon name={selected ? 'radioOn' : 'radioOff'} size={24} tone={selected ? 'brand' : 'secondary'} />
                    <Text style={styles.reasonText}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
        {needsNote ? (
          <Field
            label={noteLabel ?? t('common.note')}
            value={note}
            onChangeText={setNote}
            multiline
            autoFocus
            maxLength={noteMax}
            editable={!busy}
            error={noteError}
            onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), motion.sheet)}
          />
        ) : null}
      </ScrollView>
      <View style={[styles.pinned, contentHeight > viewportHeight + 1 ? styles.pinnedOverContent : null]}>
        <ActionLine error={error} inSheet extraAction={errorAction} />
        <Button
          label={confirmLabel}
          onPress={() => void confirm()}
          variant={confirmTone}
          size="lg"
          loading={busy}
          loadingLabel={confirmLoadingLabel}
        />
        <Button label={cancelLabel} onPress={onClose} variant="secondary" size="lg" disabled={busy} />
      </View>
    </SheetFrame>
  );
}

// ---- The imperative host: `confirm({...})` from anywhere, one sheet at a time. ----------------

export interface ConfirmRequest extends Omit<ConfirmSheetProps, 'visible' | 'onClose' | 'onConfirm'> {
  /** Optional work to run before the sheet closes; a rejection keeps it open with the error. */
  onConfirm?: (input: ConfirmInput) => Promise<unknown> | unknown;
}

interface PendingConfirm extends ConfirmRequest {
  id: number;
  resolve: (result: ConfirmResult) => void;
}

let nextConfirmId = 1;

/** `confirmed` is true when the person pressed the confirm button (and `onConfirm` succeeded). */
export interface ConfirmResult {
  confirmed: boolean;
  input?: ConfirmInput;
}

const useConfirmStore = create<{ pending: PendingConfirm | null }>(() => ({ pending: null }));

/** Opens the shared ConfirmSheet and resolves when it closes. A new request replaces an open one. */
export function confirm(request: ConfirmRequest): Promise<ConfirmResult> {
  const previous = useConfirmStore.getState().pending;
  if (previous) previous.resolve({ confirmed: false });
  return new Promise<ConfirmResult>((resolve) => {
    useConfirmStore.setState({ pending: { ...request, id: nextConfirmId++, resolve } });
  });
}

/** `const ask = useConfirm(); if ((await ask({...})).confirmed) …`. */
export function useConfirm(): typeof confirm {
  return confirm;
}

/** Hosts the shared ConfirmSheet at the app root (App.tsx). */
export function ConfirmHost() {
  const pending = useConfirmStore((s) => s.pending);
  const result = useRef<ConfirmResult>({ confirmed: false });

  useEffect(() => {
    result.current = { confirmed: false };
  }, [pending]);

  if (!pending) return null;
  const { id, resolve, onConfirm, ...sheet } = pending;
  return (
    <ConfirmSheet
      key={id}
      {...sheet}
      visible
      onConfirm={async (input) => {
        await onConfirm?.(input);
        result.current = { confirmed: true, input };
      }}
      onClose={() => {
        useConfirmStore.setState({ pending: null });
        resolve(result.current);
      }}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingTop: space.sm,
    // `maxHeight` comes from the window, which the keyboard doesn't shrink: this fits the sheet to
    // the room above the keyboard instead; its scroll area shrinks and scrolls, the buttons stay.
    flexShrink: 1,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: space.sm,
  },
  // The scroll area gives up its height first, so the pinned buttons always show.
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { paddingHorizontal: layout.gutter, paddingBottom: space.md, gap: space.md },
  amount: { gap: space.xs },
  reasons: { gap: space.sm },
  reasonRows: { gap: space.xs },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: sizes.menuRow,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  reasonSelected: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  reasonText: { flex: 1 },
  pinned: { flexShrink: 0, gap: space.sm, paddingHorizontal: layout.gutter, paddingTop: space.sm },
  // A line over the buttons only while the content scrolls under them.
  pinnedOverContent: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.md },
});
