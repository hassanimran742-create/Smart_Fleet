import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Vibration,
  View,
  useWindowDimensions,
} from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Location from 'expo-location';
import { errorAction, toApiError, toUserMessage } from '../../api/errors';
import { useOfficeContact } from '../../hooks/useAppConfig';
import { Button } from '../Button';
import { Icon, type IconName } from '../Icon';
import { Text } from '../Text';
import { colors, layout, radius, sizes, space, type IconTone, type TextTone } from '../tokens';

/**
 * The steps the Inc 1 panel serves (driver spec §1.2, UX_MOBILE §5): the driver's scans on the legacy
 * route. Inc 2 (§7.1) adds the store's receive and the refill steps.
 */
export type ScanStep = 'LOAD' | 'HANDOVER' | 'TAKE_BACK' | 'UNLOAD';

/** What the server did with a read: a new move, or one it already had. */
export type ScanOutcome = 'recorded' | 'already';

/** One read of a cylinder's QR label, with a best-effort position. */
export interface ScanRead {
  code: string;
  lat?: number;
  lng?: number;
}

export interface ScanPanelProps {
  step: ScanStep;
  /** Sends one read. Resolves with what the server did; rejects with the error (an ApiError). */
  onScan: (read: ScanRead) => Promise<ScanOutcome>;
  /**
   * False while the screen is hidden or a sheet is open: the camera stops. It also stops while the app
   * is in the background.
   */
  active?: boolean;
  /**
   * The step's count is reached. Turning true after a scan plays the long buzz (driver spec §1.3);
   * `undefined` while the count isn't known yet, so a count that loads complete never buzzes.
   */
  complete?: boolean;
  testID?: string;
}

/** Read-loop timings (UX_MOBILE §7.1; the same-QR ignore is kept from TransferScanScreen.tsx:64-67). */
const SAME_CODE_IGNORE_MS = 2_500;
const REARM_AFTER_SUCCESS_MS = 600;
const REARM_AFTER_REFUSAL_MS = 1_200;
/** A position older than this isn't attached to a scan. */
const FIX_MAX_AGE_MS = 5 * 60_000;

/**
 * Vibration (rulebook §9.2): a short buzz for a recorded scan, a double buzz for a refusal, a stutter
 * for "not sent", and a long buzz when the step's count is reached.
 */
const BUZZ_RECORDED = 40;
const BUZZ_REFUSED = [0, 100, 80, 100];
const BUZZ_NOT_SENT = [0, 60, 60, 60, 60, 60];
const BUZZ_COMPLETE = 200;

/** The camera's height: 28% of the window, between 160 and 300 dp (driver spec §1.2). */
export function cameraHeightFor(windowHeight: number): number {
  return Math.round(Math.min(Math.max(windowHeight * 0.28, 160), 300));
}

/** The result strip under the camera. */
type Strip =
  | { kind: 'idle' }
  | { kind: 'recorded' }
  | { kind: 'already' }
  | { kind: 'refused'; message: string; callOffice: boolean }
  | { kind: 'notSent'; read: ScanRead };

interface StripLook {
  background: string;
  text: TextTone;
  icon: IconName;
  iconTone: IconTone;
}

/** Solid strips with white text for the results read in sunlight (rulebook §9.3). */
const STRIP_LOOKS: Record<Strip['kind'], StripLook> = {
  idle: { background: colors.surface, text: 'default', icon: 'scan', iconTone: 'brand' },
  recorded: { background: colors.scanOk, text: 'onBrand', icon: 'ok', iconTone: 'onBrand' },
  already: { background: colors.neutralSoft, text: 'default', icon: 'info', iconTone: 'neutral' },
  refused: { background: colors.scanError, text: 'onBrand', icon: 'error', iconTone: 'onBrand' },
  notSent: { background: colors.warningSoft, text: 'warning', icon: 'offline', iconTone: 'warning' },
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

/**
 * The camera of a step screen (driver spec §1.2–§1.3, §5; UX_MOBILE §5). The screen gives it one fixed
 * step, so there is nothing to choose; the title and the count are the screen's (StepFrame, CountBar).
 *
 * - The camera reads QR labels only, in a continuous loop: one request at a time, the same label is
 *   ignored for 2.5 seconds, and the loop re-arms 600 ms after a recorded scan and 1.2 seconds after
 *   a refusal. The screen stays awake while it runs.
 * - Every result shows in the 56 dp strip under the camera, never in a pop-up, with vibration:
 *   recorded (solid green), already recorded (grey), refused (solid red, the mapped `errors.<CODE>`
 *   text, with "Call office" when that is the fix; it stays until the next result) and not sent
 *   (amber, with Retry for the same read). While a read is checked, the strip says so in place.
 * - While a recorded or refused result is up, the camera has a 4 dp frame in its colour.
 * - A best-effort position is attached when the phone already has one; it never delays a scan.
 */
export function ScanPanel({ step, onScan, active = true, complete, testID }: ScanPanelProps) {
  const { t } = useTranslation();
  const office = useOfficeContact();
  const { height } = useWindowDimensions();
  const appActive = useAppActive();
  const [permission, requestPermission] = useCameraPermissions();
  const [strip, setStrip] = useState<Strip>({ kind: 'idle' });
  const [checking, setChecking] = useState(false);
  const [torch, setTorch] = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);

  const busy = useRef(false);
  const armedAt = useRef(0);
  const lastRead = useRef<{ code: string; at: number } | null>(null);
  const fix = useRef<{ lat: number; lng: number } | null>(null);
  const mounted = useRef(true);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The long buzz when the count is reached after a scan (false → true), never on the first render.
  const wasComplete = useRef(complete);
  useEffect(() => {
    if (complete === true && wasComplete.current === false) Vibration.vibrate(BUZZ_COMPLETE);
    if (complete !== undefined) wasComplete.current = complete;
  }, [complete]);

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
  }, [refreshFix]);

  const send = useCallback(
    async (read: ScanRead) => {
      if (busy.current) return;
      busy.current = true;
      setChecking(true);
      try {
        const outcome = await onScanRef.current(read);
        if (!mounted.current) return;
        if (outcome === 'recorded') {
          setStrip({ kind: 'recorded' });
          Vibration.vibrate(BUZZ_RECORDED);
        } else {
          setStrip({ kind: 'already' });
        }
        armedAt.current = Date.now() + REARM_AFTER_SUCCESS_MS;
      } catch (thrown) {
        if (!mounted.current) return;
        const error = toApiError(thrown);
        if (error.retryable) {
          setStrip({ kind: 'notSent', read });
          Vibration.vibrate(BUZZ_NOT_SENT);
        } else {
          setStrip({
            kind: 'refused',
            message: toUserMessage(error, t),
            callOffice: errorAction(error) === 'CALL_OFFICE',
          });
          Vibration.vibrate(BUZZ_REFUSED);
        }
        armedAt.current = Date.now() + REARM_AFTER_REFUSAL_MS;
      } finally {
        busy.current = false;
        if (mounted.current) setChecking(false);
        refreshFix();
      }
    },
    [refreshFix, t],
  );

  const onRead = useCallback(
    (result: BarcodeScanningResult) => {
      // Some labels and scanners add spaces or a newline; the stored value has none.
      const code = (result.data ?? '').trim();
      if (!code || busy.current) return;
      const now = Date.now();
      if (now < armedAt.current) return;
      const last = lastRead.current;
      if (last && last.code === code && now - last.at < SAME_CODE_IGNORE_MS) return;
      lastRead.current = { code, at: now };
      void send({ code, ...(fix.current ?? {}) });
    },
    [send],
  );

  const allowed = permission?.granted === true;
  const cameraOn = allowed && active && appActive && !cameraFailed;
  const cameraHeight = cameraHeightFor(height);

  // While a read is checked, the strip keeps the idle look with a spinner (nothing jumps).
  const look = STRIP_LOOKS[checking ? 'idle' : strip.kind];
  let stripText: string;
  if (checking) stripText = t('scan.checking');
  else if (strip.kind === 'recorded') stripText = t(`scan.step.${step}.recorded`);
  else if (strip.kind === 'already') stripText = t('scan.already');
  else if (strip.kind === 'refused') stripText = strip.message;
  else if (strip.kind === 'notSent') stripText = t('scan.notSent');
  else stripText = t(`scan.step.${step}.hint`);

  // VoiceOver has no live regions: announce each new result (TalkBack reads the live region).
  useEffect(() => {
    if (Platform.OS === 'ios' && strip.kind !== 'idle') AccessibilityInfo.announceForAccessibility(stripText);
  }, [strip, stripText]);

  const problem = !checking && (strip.kind === 'refused' || strip.kind === 'notSent');
  // The hint shows once the camera may run (also while a sheet pauses it, so nothing jumps); before
  // the permission is known, or when the camera failed, the camera block alone speaks.
  const showStrip = checking || strip.kind !== 'idle' || (allowed && !cameraFailed);
  const frameColour = checking
    ? null
    : strip.kind === 'recorded'
      ? colors.scanOk
      : strip.kind === 'refused'
        ? colors.scanError
        : null;

  return (
    <View testID={testID} style={styles.panel}>
      {permission && !allowed ? (
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
                onBarcodeScanned={checking ? undefined : onRead}
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
      )}

      {showStrip ? (
        <View
          testID={testID ? `${testID}.strip` : undefined}
          accessibilityRole={problem ? 'alert' : undefined}
          accessibilityLiveRegion={!checking && strip.kind === 'refused' ? 'assertive' : 'polite'}
          style={[
            styles.strip,
            { backgroundColor: look.background },
            look === STRIP_LOOKS.idle ? styles.stripIdle : null,
          ]}
        >
          <View style={styles.stripWords}>
            {checking ? (
              <ActivityIndicator color={colors.brand} style={styles.stripSpinner} />
            ) : (
              <Icon name={look.icon} size={32} tone={look.iconTone} />
            )}
            <Text variant="bodyStrong" tone={look.text} numberOfLines={2} style={styles.stripText}>
              {stripText}
            </Text>
          </View>
          {!checking && strip.kind === 'notSent' ? (
            <Button
              label={t('scan.retry')}
              onPress={() => void send(strip.read)}
              variant="secondary"
              fullWidth={false}
            />
          ) : null}
          {!checking && strip.kind === 'refused' && strip.callOffice && office.phone ? (
            <Button
              label={t('common.actions.callOffice')}
              onPress={office.call}
              icon="call"
              variant="inverse"
              fullWidth={false}
            />
          ) : null}
        </View>
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
  stripWords: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexGrow: 1, flexShrink: 1, flexBasis: 180 },
  stripSpinner: { width: 32, height: 32 },
  stripText: { flex: 1 },
});
