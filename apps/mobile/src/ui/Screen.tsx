import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { EnvBanner } from './EnvBanner';
import { FAB_CLEARANCE } from './Fab';
import { OfflineBanner } from './OfflineBanner';
import { colors, layout, space } from './tokens';

export interface ScreenProps {
  children?: ReactNode;
  /** Scroll the content (default). Use false for screens that hold their own FlatList. */
  scroll?: boolean;
  refreshing?: boolean;
  /** Adds pull-to-refresh (scrolling screens). */
  onRefresh?: () => void;
  /** The sticky bar at the bottom with the screen's one primary action. */
  footer?: ReactNode;
  /**
   * A list screen's "new" button (`<Fab …/>`), floating over the content at the bottom end. A screen
   * has a footer or a Fab, never both (UX_PRINCIPLES §7.3). A scrolling screen leaves room for it
   * under its content; a FlatList adds `FAB_CLEARANCE` to its own bottom padding.
   */
  fab?: ReactNode;
  /** A screen banner under the training and offline strips. */
  banner?: ReactNode;
  /** Side and top padding (the 16 dp gutter). */
  padded?: boolean;
  /**
   * Safe-area edges. The default leaves the top to the navigation header; screens without a header
   * (Sign in, the gates) pass `['top', 'left', 'right', 'bottom']`.
   */
  edges?: readonly Edge[];
  /** A 1 px line under the navigation header (UX_MOBILE §2.2 #4). On by default under a header. */
  headerBorder?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

const UNDER_HEADER: readonly Edge[] = ['left', 'right', 'bottom'];

/**
 * The frame of every screen (UX_MOBILE §2.2 #3): safe areas, the TRAINING and offline strips on top,
 * the keyboard, optional scroll with pull-to-refresh, and the sticky footer.
 */
export function Screen({
  children,
  scroll = true,
  refreshing = false,
  onRefresh,
  footer,
  fab,
  banner,
  padded = true,
  edges = UNDER_HEADER,
  headerBorder,
  contentStyle,
  testID,
}: ScreenProps) {
  const showHeaderBorder = headerBorder ?? !edges.includes('top');
  const padding = padded ? styles.padded : null;

  return (
    <SafeAreaView testID={testID} edges={edges} style={styles.root}>
      {showHeaderBorder ? <View style={styles.headerBorder} /> : null}
      <EnvBanner />
      <OfflineBanner />
      {banner}
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* The body and the Fab over it: the Fab's corner is this area's, above the footer and safe area. */}
        <View style={styles.fill}>
          {scroll ? (
            <ScrollView
              style={styles.fill}
              contentContainerStyle={[padding, styles.scrollContent, fab ? styles.fabRoom : null, contentStyle]}
              keyboardShouldPersistTaps="handled"
              refreshControl={
                onRefresh ? (
                  <RefreshControl
                    refreshing={refreshing}
                    onRefresh={onRefresh}
                    colors={[colors.brand]}
                    tintColor={colors.brand}
                  />
                ) : undefined
              }
            >
              {children}
            </ScrollView>
          ) : (
            <View style={[styles.fill, padding, contentStyle]}>{children}</View>
          )}
          {fab}
        </View>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  fill: { flex: 1 },
  padded: { padding: layout.gutter },
  scrollContent: { flexGrow: 1, paddingBottom: space.xxl },
  fabRoom: { paddingBottom: FAB_CLEARANCE },
  headerBorder: { height: 1, backgroundColor: colors.border },
  footer: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: layout.gutter,
    paddingVertical: space.md,
    gap: space.sm,
  },
});
