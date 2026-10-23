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
 * The steps the v1 panel serves (UX_MOBILE §5): the driver's scans on the legacy route. Inc 2 (§7.1)
 * adds the store's RECEIVE and the refill steps; HAND_BACK then moves to the shop's receive scan.
 */
export type ScanStep = 'LOAD' | 'HANDOVER' | 'TAKE_BACK' | 'HAND_BACK';

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
  /** The step's store or customer, for the title: "Load at Ahmed Gas Store". */
  place: string;
  /** Sends one read. Resolves with what the server did; rejects with the error (an ApiError). */
  onScan: (read: ScanRead) => Promise<ScanOutcome>;
  /** False while the screen is hidden: the camera stops. It also stops while the app is in the background. */
  active?: boolean;
  /** Tells the screen whether the camera may run, so the screen keeps one main button. */
  onCameraAllowedChange?: (allowed: boolean) => void;
  testID?: string;
}

/** Read-loop timings (UX_MOBILE §7.1; the same-QR ignore is kept from TransferScanScreen.tsx:64-67). */
const SAME_CODE_IGNORE_MS = 2_500;
const REARM_AFTER_SUCCESS_MS = 600;
const REARM_AFTER_REFUSAL_MS = 1_200;
/** A position older than this isn't attached to a scan. */
const FIX_MAX_AGE_MS = 5 * 60_000;

/** Vibration: one short buzz for a recorded scan, a double buzz for a refusal, a stutter for "not sent". */
const BUZZ_RECORDED = 40;
const BUZZ_REFUSED = [0, 100, 80, 100];
const BUZZ_NOT_SENT = [0, 60, 60, 60, 60, 60];

/** The result strip under the camera. */
type Strip =
  | { kind: 'aim' }
  | { kind: 'recorded' }
  | { kind: 'already' }
  | { kind: 'refused'; message: string; callOffice: boolean }
  | { kind: 'notSent'; message: string; read: ScanRead };

interface StripLook {
  background: string;
  text: TextTone;
  icon: IconName;
  iconTone: IconTone;
}

const STRIP_LOOKS: Record<Strip['kind'], StripLook> = {
  aim: { background: colors.surface, text: 'secondary', icon: 'scan', iconTone: 'secondary' },
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
 * ScanPanel v1 core (UX_MOBILE §5; it replaces the free-choice ScanScreen). The screen opens it for one
 * fixed step, so there is nothing to choose.
 *
 * - The camera reads QR labels only, in a continuous loop: one request at a time, the same label is
 *   ignored for 2.5 seconds, and the loop re-arms 600 ms after a recorded scan and 1.2 seconds after
 *   a refusal.
 * - Every result shows in the strip under the camera, never in a pop-up, with vibration: recorded
 *   (green), already recorded (grey), refused (red, the mapped `errors.<CODE>` text; it stays until
 *   the next good scan) and not sent (amber, with Retry for the same read).
 * - A best-effort position is attached when the phone already has one; it never delays a scan.
 */
export function ScanPanel({ step, place, onScan, active = true, onCameraAllowedChange, testID }: ScanPanelProps) {
  const { t } = useTranslation();
  const office = useOfficeContact();
  const { height } = useWindowDimensions();
  const appActive = useAppActive();
  const [permission, requestPermission] = useCameraPermissions();
  const [strip, setStrip] = useState<Strip>({ kind: 'aim' });
  const [checking, setChecking] = useState(false);
  const [count, setCount] = useState(0);
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

  const allowed = permission?.granted === true;
  useEffect(() => {
    if (permission) onCameraAllowedChange?.(allowed);
  }, [permission, allowed, onCameraAllowedChange]);

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
          setCount((n) => n + 1);
          setStrip({ kind: 'recorded' });
          Vibration.vibrate(BUZZ_RECORDED);
        } else {
          setStrip({ kind: 'already' });
        }
        armedAt.current = Date.now() + REARM_AFTER_SUCCESS_MS;
      } catch (thrown) {
        if (!mounted.current) return;
        const error = toApiError(thrown);
        const message = toUserMessage(error, t);
        if (error.retryable) {
          setStrip({ kind: 'notSent', message, read });
          Vibration.vibrate(BUZZ_NOT_SENT);
        } else {
          setStrip({ kind: 'refused', message, callOffice: errorAction(error) === 'CALL_OFFICE' });
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

  const stripText =
    strip.kind === 'aim'
      ? t('scan.aim')
      : strip.kind === 'recorded'
        ? t(`scan.step.${step}.recorded`)
        : strip.kind === 'already'
          ? t('scan.already')
          : strip.message;

  // VoiceOver has no live regions: announce each new result (TalkBack reads the live region).
  useEffect(() => {
    if (Platform.OS === 'ios' && strip.kind !== 'aim') AccessibilityInfo.announceForAccessibility(stripText);
  }, [strip, stripText]);

  const cameraHeight = Math.round(Math.min(Math.max(height * 0.38, 200), 380));
  const cameraOn = allowed && active && appActive && !cameraFailed;
  const look = STRIP_LOOKS[strip.kind];
  const problem = strip.kind === 'refused' || strip.kind === 'notSent';

  return (
    <View testID={testID} style={styles.panel}>
      <View style={styles.heading}>
        <Text variant="title">{t(`scan.step.${step}.title`, { place })}</Text>
        <Text tone="secondary">{t(`scan.step.${step}.hint`)}</Text>
      </View>

      {permission && !allowed ? (
        <View style={styles.permission}>
          <Icon name="scan" size={48} tone="brand" />
          <Text align="center">{permission.canAskAgain ? t('scan.camera.why') : t('scan.camera.blocked')}</Text>
          {permission.canAskAgain ? (
            <Button label={t('scan.camera.allow')} icon="scan" onPress={() => void requestPermission()} />
          ) : (
            <Button
              label={t('scan.camera.openSettings')}
              onPress={() => void Linking.openSettings().catch(() => undefined)}
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
              ) : (
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

      {checking ? (
        <View style={styles.checking}>
          <ActivityIndicator color={colors.brand} />
          <Text variant="label" tone="secondary">
            {t('scan.checking')}
          </Text>
        </View>
      ) : null}

      <View
        testID={testID ? `${testID}.strip` : undefined}
        accessibilityRole={problem ? 'alert' : undefined}
        accessibilityLiveRegion={strip.kind === 'refused' ? 'assertive' : 'polite'}
        style={[styles.strip, { backgroundColor: look.background }, strip.kind === 'aim' ? styles.stripAim : null]}
      >
        <View style={styles.stripRow}>
          <Icon name={look.icon} size={24} tone={look.iconTone} />
          <Text variant="bodyStrong" tone={look.text} style={styles.stripText}>
            {stripText}
          </Text>
        </View>
        {strip.kind === 'notSent' ? (
          <Button
            label={t('scan.retry')}
            onPress={() => void send(strip.read)}
            loading={checking}
            variant="secondary"
            fullWidth={false}
          />
        ) : null}
        {strip.kind === 'refused' && strip.callOffice && office.phone ? (
          <Button
            label={t('common.actions.callTheOffice')}
            onPress={office.call}
            icon="call"
            variant="inverse"
            fullWidth={false}
          />
        ) : null}
      </View>

      <Text variant="bodyStrong" tabular accessibilityLiveRegion="polite">
        {t('scan.count', { count })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: space.md },
  heading: { gap: space.xs },
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
  permission: {
    alignItems: 'center',
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
  checking: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  strip: {
    minHeight: sizes.touch,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  stripAim: { borderWidth: 1, borderColor: colors.border },
  stripRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  stripText: { flex: 1 },
});
