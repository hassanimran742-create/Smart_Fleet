import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, AppState, Linking, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Location from 'expo-location';
import { errorAction, toApiError, toUserMessage } from '../../api/errors';
import { newRequestId } from '../../api/ids';
import { useOfficeContact } from '../../hooks/useAppConfig';
import { ltr } from '../bidi';
import { Button } from '../Button';
import { confirm } from '../ConfirmSheet';
import { Field } from '../Field';
import { Icon, type IconName } from '../Icon';
import { Text } from '../Text';
import { colors, layout, radius, sizes, space, toneSurfaces, type IconTone, type TextTone } from '../tokens';
import {
  createScanLoop,
  type PendingScan,
  type ScanEntryMethod,
  type ScanLoop,
  type ScanLoopState,
  type ScanReturnState,
} from './scanReducer';
import { useCompleteBuzz, useScanFeedback } from './useScanFeedback';
import { cameraHeightFor } from './cameraHeight';

export { cameraHeightFor };

/**
 * The scanning steps (UX_MOBILE §7.1): the driver's Load, Deliver and Take back, the shop's Receive, and
 * the refill run's pick-up and fill. The driver's Unload is the shop's Receive scan, so it has no panel.
 */
export type ScanStep = 'LOAD' | 'HANDOVER' | 'TAKE_BACK' | 'RECEIVE' | 'REFILL_PICKUP' | 'REFILL_FILL';

/** What the server did with a read: a new move, or one it already had. */
export type ScanOutcome = 'recorded' | 'already';

/** The server's answer as the strip shows it: "AG-C0042 · 11.8 kg loaded", "Already scanned · AG-C0042". */
export interface ScanAnswer {
  outcome: ScanOutcome;
  /** "AG-C0042" (the QR value for a cylinder without a number). Without it the strip says the verb alone. */
  shortCode?: string | null;
  /** "11.8 kg". */
  sizeLabel?: string | null;
  /** The strip's own words, when the screen has them ("AG-C0011 · 11.8 kg received · Kashif's van"). */
  text?: string;
}

/** `onScan` resolves with an outcome alone or with the cylinder it was. */
export type ScanReply = ScanOutcome | ScanAnswer;

/** One read sent to the server. Every resend of a read keeps its `scanId`. */
export interface ScanRead {
  scanId: string;
  code: string;
  entryMethod: ScanEntryMethod;
  /** Take back only: the state tapped when the read was made. */
  returnState?: ScanReturnState;
  lat?: number;
  lng?: number;
}

/**
 * The strip's answer from a shared-types `ScanResult` (and the store's and refill's, which extend it).
 * `text` replaces the strip's words.
 */
export function answerFromResult(
  result: { result: 'RECORDED' | 'ALREADY_RECORDED'; cylinder: { code: string; shortCode: string | null; size: { label: string } } },
  text?: string,
): ScanAnswer {
  return {
    outcome: result.result === 'RECORDED' ? 'recorded' : 'already',
    shortCode: result.cylinder.shortCode ?? result.cylinder.code,
    sizeLabel: result.cylinder.size.label,
    text,
  };
}

export interface ScanPanelProps {
  step: ScanStep;
  /** Sends one read. Resolves with what the server did; rejects with the error (an ApiError). */
  onScan: (read: ScanRead) => Promise<ScanReply>;
  /**
   * False while the screen is hidden or a sheet is open: the camera stops. It also stops while the app
   * is in the background.
   */
  active?: boolean;
  /**
   * The step's count is reached: the long buzz when it turns true after a scan, and the camera stops
   * (driver spec R-SP). `undefined` while the count isn't known, so a step that loads complete never
   * buzzes. Take back never passes it: more can come back than expected.
   */
  complete?: boolean;
  /** Take back: the tapped state, sent with each read and named in its strip ("AG-C0012 · Part-filled"). */
  returnState?: ScanReturnState;
  /** "Type number" (`features.typedCylinderNumber`). */
  allowTyped?: boolean;
  /**
   * Take back (review23 ux-03): the result strip and "Not saved" come first, right under the state tap
   * above the panel, then `beforeCamera` (the step's count), then a shorter camera. The strip names the
   * state tapped ("AG-C0031 · Full"), so a wrong tap is caught at once; under the camera it fell below
   * the footer on a 360×640 phone.
   */
  resultFirst?: boolean;
  /** What sits between the result strip and the camera while `resultFirst`: take back's CountBar. */
  beforeCamera?: ReactNode;
  /** The details under the strip and "Not saved", above "Type number": SizeLines, the take-back lists. */
  children?: ReactNode;
  testID?: string;
}

/** A position older than this isn't attached to a scan. */
const FIX_MAX_AGE_MS = 5 * 60_000;

type StripKind = 'idle' | 'checking' | 'recorded' | 'already' | 'refused';

interface StripLook {
  background: string;
  text: TextTone;
  icon: IconName;
  iconTone: IconTone;
}

/** Solid strips with white text for the results read in sunlight (rulebook §9.3). */
const STRIP_LOOKS: Record<StripKind, StripLook> = {
  idle: { background: colors.surface, text: 'default', icon: 'scan', iconTone: 'brand' },
  checking: { background: colors.surface, text: 'default', icon: 'scan', iconTone: 'brand' },
  recorded: { background: colors.scanOk, text: 'onBrand', icon: 'ok', iconTone: 'onBrand' },
  already: { background: colors.neutralSoft, text: 'default', icon: 'info', iconTone: 'neutral' },
  refused: { background: colors.scanError, text: 'onBrand', icon: 'error', iconTone: 'onBrand' },
};

/** True while the app is in the foreground. */
function useAppActive(): boolean {
  const [activeNow, setActiveNow] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => setActiveNow(status === 'active'));
    return () => subscription.remove();
  }, []);
  return activeNow;
}

/**
 * Keeps the screen on while mounted (rulebook §9.3). `expo-keep-awake` is in the 0.1.0 binary as a
 * dependency of `expo`; the require is guarded the way expo's own dev tools load it, so a build
 * without the native module only loses the keep-awake, never the camera.
 */
const useKeepScreenOn: () => void = (() => {
  try {
    const { useKeepAwake } = require('expo-keep-awake') as typeof import('expo-keep-awake');
    // No tag: each panel gets its own, so one leaving never turns off the next one's.
    return () => useKeepAwake(undefined, { suppressDeactivateWarnings: true });
  } catch {
    return () => undefined;
  }
})();

function KeepScreenOn() {
  useKeepScreenOn();
  return null;
}

/** No answer (no signal, or our server down): the read waits on the "Not saved" list. */
function failureOf(error: unknown): { kind: 'notSent' } | { kind: 'refused'; code: string } {
  const apiError = toApiError(error);
  return apiError.retryable ? { kind: 'notSent' } : { kind: 'refused', code: String(apiError.code) };
}

function outcomeOf(reply: ScanReply): ScanOutcome {
  return typeof reply === 'string' ? reply : reply.outcome;
}

/** One loop per panel: made once, fed the latest `onScan` through a ref, stopped when the panel goes. */
function useScanLoop(onScan: (read: ScanRead) => Promise<ScanReply>): [ScanLoop<ScanReply>, ScanLoopState<ScanReply>] {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const loopRef = useRef<ScanLoop<ScanReply> | null>(null);
  if (loopRef.current === null) {
    loopRef.current = createScanLoop<ScanReply>({
      send: (scan: PendingScan) =>
        onScanRef.current({
          scanId: scan.scanId,
          code: scan.code,
          entryMethod: scan.entryMethod,
          returnState: scan.returnState,
          lat: scan.lat,
          lng: scan.lng,
        }),
      outcomeOf,
      failureOf,
      newScanId: newRequestId,
    });
  }
  const loop = loopRef.current;
  useEffect(() => {
    loop.resume();
    return () => loop.dispose();
  }, [loop]);
  const state = useSyncExternalStore(loop.subscribe, loop.getState, loop.getState);
  return [loop, state];
}

/**
 * The camera of a step screen (driver spec §1.2–§1.3, R-SP; UX_MOBILE §7.1). The screen gives it one
 * fixed step and owns the title, the count, the state tap and the footer; the panel is the camera, its
 * result strip, "Not saved", the screen's details and "Type number", in that order. Take back
 * (`resultFirst`) puts the strip and "Not saved" first, then the count, then a shorter camera.
 *
 * - QR labels only, in a continuous loop (scanReducer.ts): the same label is ignored for 2.5 seconds,
 *   one request is in flight at a time, every read has its own scan id, and the camera re-arms 600 ms
 *   after an answer and 1.2 seconds after a refusal. The screen stays awake while it runs.
 * - Every result shows in the 56 dp strip under the camera, never in a pop-up, with a buzz: recorded
 *   (solid green, naming the cylinder), already recorded (grey), refused (solid red, the mapped
 *   `errors.<CODE>` text and "Call office" when that is the fix; it stays until the next answer). While
 *   a read is checked the strip says so in place, and the camera has a 4 dp frame in the result's colour.
 * - A read with no answer goes to one amber "Not saved: 2" row with one Retry, which resends them all
 *   with their first scan ids. Leaving the screen with any asks first (rule 7).
 * - When the step's count is reached the camera stops; "Type number" stays for a label the camera
 *   can't read, and opens on its own when the camera is blocked.
 */
export function ScanPanel({
  step,
  onScan,
  active = true,
  complete,
  returnState,
  allowTyped = false,
  resultFirst = false,
  beforeCamera,
  children,
  testID,
}: ScanPanelProps) {
  const { t } = useTranslation();
  const office = useOfficeContact();
  const navigation = useNavigation();
  const { height } = useWindowDimensions();
  const appActive = useAppActive();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [asking, setAsking] = useState(false);
  const [typedOpen, setTypedOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const typedScanId = useRef<string | null>(null);
  const [loop, state] = useScanLoop(onScan);

  const fix = useRef<{ lat: number; lng: number } | null>(null);
  const mounted = useRef(true);
  const returnStateRef = useRef(returnState);
  returnStateRef.current = returnState;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useCompleteBuzz(complete);

  /** Keeps the phone's last known position ready for the next scan, without ever waiting for it. */
  const refreshFix = useCallback(() => {
    void (async () => {
      try {
        const granted = await Location.getForegroundPermissionsAsync();
        if (granted.status !== 'granted') return;
        const position = await Location.getLastKnownPositionAsync({ maxAge: FIX_MAX_AGE_MS });
        if (position && mounted.current) {
          fix.current = { lat: position.coords.latitude, lng: position.coords.longitude };
        }
      } catch {
        // Best effort only: a scan never needs a position.
      }
    })();
  }, []);

  useEffect(() => {
    refreshFix();
  }, [refreshFix, state.seq]);

  const onRead = useCallback(
    (result: BarcodeScanningResult) => {
      loop.read(result.data ?? '', { entryMethod: 'QR', returnState: returnStateRef.current, ...(fix.current ?? {}) });
    },
    [loop],
  );

  const sendTyped = () => {
    const code = typed.trim();
    if (!code) return;
    typedScanId.current = loop.read(code, {
      entryMethod: 'TYPED',
      returnState: returnStateRef.current,
      ...(fix.current ?? {}),
    });
  };

  // A typed number clears once it is answered or waits on "Not saved"; an unknown number stays, to fix it.
  useEffect(() => {
    const id = typedScanId.current;
    if (!id) return;
    const last = state.last;
    if (last && last.scan.scanId === id) {
      typedScanId.current = null;
      if (!(last.kind === 'refused' && last.code === 'SCAN_CYLINDER_UNKNOWN')) setTyped('');
    } else if (state.unsaved.some((scan) => scan.scanId === id) && state.inFlight?.scanId !== id) {
      typedScanId.current = null;
      setTyped('');
    }
  }, [state]);

  // The count is reached: an open typed field folds back to "Type number" (still there for a label the
  // camera can't read), so a complete step shows its tick, not an empty field and an idle send button.
  const wasComplete = useRef(complete === true);
  useEffect(() => {
    if (complete === true && !wasComplete.current) {
      setTypedOpen(false);
      setTyped('');
    }
    wasComplete.current = complete === true;
  }, [complete]);

  // Leaving with reads that aren't saved yet asks first (rule 7): they would be lost.
  const pending = state.unsaved.length + state.waiting.length;
  useEffect(() => {
    if (pending === 0) return;
    return navigation.addListener('beforeRemove', (event) => {
      event.preventDefault();
      setAsking(true);
      void confirm({
        title: t('scan.unsaved.title', { count: pending }),
        body: t('scan.unsaved.body', { count: pending }),
        confirmLabel: t('scan.unsaved.leave'),
        confirmTone: 'danger',
        cancelLabel: t('scan.unsaved.stay'),
      }).then(({ confirmed }) => {
        if (mounted.current) setAsking(false);
        if (confirmed) navigation.dispatch(event.data.action);
      });
    });
  }, [pending, navigation, t]);

  // The strip: the read being checked, else the server's last answer, else the hint.
  let kind: StripKind;
  let stripText: string;
  let callOffice = false;
  const last = state.last;
  if (state.inFlight) {
    kind = 'checking';
    stripText = t('scan.checking');
  } else if (!last) {
    kind = 'idle';
    stripText = t(`scan.step.${step}.hint`);
  } else if (last.kind === 'refused') {
    kind = 'refused';
    stripText = toUserMessage(last.error, t);
    callOffice = errorAction(last.error) === 'CALL_OFFICE';
  } else {
    kind = last.kind;
    const answer: ScanAnswer = typeof last.reply === 'string' ? { outcome: last.reply } : last.reply;
    const shortCode = answer.shortCode ? ltr(answer.shortCode) : null;
    if (answer.text) stripText = answer.text;
    else if (last.kind === 'already') {
      stripText =
        step === 'RECEIVE'
          ? t('scan.step.RECEIVE.already')
          : shortCode
            ? t('scan.alreadyCode', { shortCode })
            : t('scan.already');
    } else if (shortCode && step === 'TAKE_BACK' && last.scan.returnState) {
      stripText = t('scan.recordedState', { shortCode, state: t(`scan.state.${last.scan.returnState}`) });
    } else if (shortCode && answer.sizeLabel) {
      stripText = t('scan.recorded', { shortCode, size: answer.sizeLabel, verb: t(`scan.verb.${step}`) });
    } else {
      stripText = t(`scan.step.${step}.recorded`);
    }
  }
  useScanFeedback(state, stripText);

  const allowed = permission?.granted === true;
  const blocked = permission !== null && !allowed && !permission.canAskAgain;
  const cameraOn = allowed && active && appActive && !cameraFailed && !asking && complete !== true;
  const cameraHeight = cameraHeightFor(height, resultFirst);
  const look = STRIP_LOOKS[kind];
  const problem = kind === 'refused';
  const frameColour = kind === 'recorded' ? colors.scanOk : kind === 'refused' ? colors.scanError : null;
  // The hint shows once the camera may run (also while a sheet pauses it, so nothing jumps); before the
  // permission is known, or when the camera failed, the camera block alone speaks. A result always shows.
  const showStrip = kind !== 'idle' || (allowed && !cameraFailed) || typedOpen;
  const retrying = state.retrying.length > 0 || state.unsaved.some((scan) => scan.scanId === state.inFlight?.scanId);

  const camera =
    complete === true ? null : permission && !allowed ? (
      <View style={[styles.permission, { minHeight: cameraHeight }]}>
        <Icon name="scan" size={48} tone="brand" />
        <Text align="center">{permission.canAskAgain ? t('scan.camera.why') : t('scan.camera.blocked')}</Text>
        {permission.canAskAgain ? (
          <Button
            label={t('scan.camera.allow')}
            icon="scan"
            onPress={() => void requestPermission()}
            fullWidth={false}
            style={styles.centred}
          />
        ) : (
          <Button
            label={t('scan.camera.openSettings')}
            variant="secondary"
            onPress={() => void Linking.openSettings().catch(() => undefined)}
            fullWidth={false}
            style={styles.centred}
          />
        )}
        {blocked && allowTyped && !typedOpen ? (
          <Button
            label={t('scan.typed.instead')}
            icon="keyboard"
            variant="ghost"
            onPress={() => setTypedOpen(true)}
            fullWidth={false}
            style={styles.centred}
            testID={testID ? `${testID}.typeInstead` : undefined}
          />
        ) : null}
      </View>
    ) : (
      <View
        style={[styles.camera, { height: cameraHeight }]}
        accessible={cameraOn}
        accessibilityLabel={cameraOn ? t('scan.camera.label') : undefined}
      >
        {cameraOn ? (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              enableTorch={torch}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={onRead}
              onMountError={() => setCameraFailed(true)}
            />
            <KeepScreenOn />
            {frameColour ? <View pointerEvents="none" style={[styles.frame, { borderColor: frameColour }]} /> : null}
            <Pressable
              onPress={() => setTorch((on) => !on)}
              accessibilityRole="button"
              accessibilityLabel={torch ? t('scan.torch.turnOff') : t('scan.torch.turnOn')}
              accessibilityState={{ checked: torch }}
              hitSlop={sizes.hitSlop}
              style={[styles.torch, torch ? styles.torchOn : null]}
            >
              <Icon name="torch" size={24} tone={torch ? 'brand' : 'onBrand'} />
            </Pressable>
          </>
        ) : (
          <View style={styles.cameraIdle}>
            {cameraFailed ? (
              <>
                <Icon name="error" size={32} tone="onBrand" />
                <Text tone="onBrand" align="center">
                  {t('scan.camera.failed')}
                </Text>
              </>
            ) : allowed ? null : (
              // Paused (a sheet is open, the screen is hidden) it is a plain dark block; it says
              // "Starting camera…" only while the permission's answer is awaited.
              <>
                <ActivityIndicator color={colors.onBrand} />
                <Text tone="onBrand" align="center">
                  {t('scan.camera.starting')}
                </Text>
              </>
            )}
          </View>
        )}
      </View>
    );

  const strip = showStrip ? (
    <View
      testID={testID ? `${testID}.strip` : undefined}
      accessibilityRole={problem ? 'alert' : undefined}
      accessibilityLiveRegion={problem ? 'assertive' : 'polite'}
      style={[styles.strip, { backgroundColor: look.background }, kind === 'idle' || kind === 'checking' ? styles.stripIdle : null]}
    >
      <View style={styles.stripWords}>
        {kind === 'checking' ? (
          <ActivityIndicator color={colors.brand} style={styles.stripSpinner} />
        ) : (
          <Icon name={look.icon} size={32} tone={look.iconTone} />
        )}
        <Text variant="bodyStrong" tone={look.text} numberOfLines={2} style={styles.stripText}>
          {stripText}
        </Text>
      </View>
      {kind === 'refused' && callOffice && office.phone ? (
        <Button
          label={t('common.actions.callOffice')}
          onPress={office.call}
          icon="call"
          variant="inverse"
          fullWidth={false}
        />
      ) : null}
    </View>
  ) : null;

  const unsaved =
    state.unsaved.length > 0 ? (
      <View
        testID={testID ? `${testID}.unsaved` : undefined}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.strip, styles.unsaved]}
      >
        <View style={styles.stripWords}>
          <Icon name="offline" size={32} tone={toneSurfaces.warning.icon} />
          <Text variant="bodyStrong" tone="warning" style={styles.stripText}>
            {t('scan.notSaved', { count: state.unsaved.length })}
          </Text>
        </View>
        <Button
          label={t('scan.retry')}
          loading={retrying}
          onPress={() => loop.retry()}
          variant="secondary"
          fullWidth={false}
          testID={testID ? `${testID}.retry` : undefined}
        />
      </View>
    ) : null;

  return (
    <View testID={testID} style={styles.panel}>
      {resultFirst ? (
        // Take back: the answer right under the state tap, then the count, then the (shorter) camera.
        <>
          {strip}
          {unsaved}
          {beforeCamera}
          {camera}
        </>
      ) : (
        <>
          {camera}
          {strip}
          {unsaved}
        </>
      )}

      {children}

      {allowTyped ? (
        typedOpen ? (
          <View style={styles.typed}>
            <Field
              label={t('scan.typed.label')}
              value={typed}
              onChangeText={setTyped}
              placeholder={t('scan.typed.placeholder')}
              keyboardType="number-pad"
              autoFocus
              maxLength={16}
              returnKeyType="send"
              onSubmitEditing={sendTyped}
              testID={testID ? `${testID}.typedField` : undefined}
            />
            <Button
              label={t(`scan.typed.send.${step}`)}
              onPress={sendTyped}
              disabled={!typed.trim()}
              testID={testID ? `${testID}.typedSend` : undefined}
            />
          </View>
        ) : blocked && complete !== true ? null : (
          <Button
            label={t('scan.typed.open')}
            icon="keyboard"
            variant="ghost"
            onPress={() => setTypedOpen(true)}
            fullWidth={false}
            testID={testID ? `${testID}.typeNumber` : undefined}
          />
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: space.md },
  camera: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.text,
  },
  cameraIdle: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    padding: layout.cardPadding,
  },
  // A static frame over the preview, so the preview itself never moves.
  frame: { ...StyleSheet.absoluteFillObject, borderWidth: 4, borderRadius: radius.lg },
  permission: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    padding: layout.cardPadding,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  torch: {
    position: 'absolute',
    top: space.sm,
    end: space.sm,
    width: sizes.iconButton,
    height: sizes.iconButton,
    borderRadius: sizes.iconButton / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.scrim,
  },
  torchOn: { backgroundColor: colors.surface },
  centred: { alignSelf: 'center' },
  // The button drops under the words when they wrap.
  strip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.sm,
    rowGap: space.sm,
    minHeight: sizes.touch,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  stripIdle: { borderWidth: 1, borderColor: colors.border },
  unsaved: { backgroundColor: colors.warningSoft },
  stripWords: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexGrow: 1, flexShrink: 1, flexBasis: 180 },
  stripSpinner: { width: 32, height: 32 },
  stripText: { flex: 1 },
  typed: { gap: space.sm },
});
