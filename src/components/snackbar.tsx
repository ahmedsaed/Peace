import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * A transient message with one action, pinned above the tab bar.
 *
 * Auto-dismisses, because an undo the user ignored should not linger over the
 * list forever — but 8 seconds rather than the usual 4-5. This offer is the only
 * way back from deleting a financial record, and someone who deletes and then
 * hesitates needs time to decide.
 *
 * `token` restarts the timer: without it, a second delete would inherit the
 * first offer's countdown and vanish almost immediately.
 *
 * It clears the system navigation bar unless `overTabBar` says a tab bar is
 * already in between. The app is drawn edge to edge, so on a stack screen
 * `bottom-4` alone put the message under the three-button bar — the snackbar
 * "visible" and its Undo untappable, which gesture navigation never showed.
 */
export function Snackbar({
  message,
  actionLabel,
  onAction,
  onDismiss,
  token,
  durationMs = 8000,
  testID = 'snackbar',
  overTabBar = false,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  token: number;
  durationMs?: number;
  /** Named per screen where a flow has to tell two of them apart. */
  testID?: string;
  /** The screen sits above the tab bar, which already clears the nav bar. */
  overTabBar?: boolean;
}) {
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, durationMs]);

  return (
    <View
      testID={testID}
      className="absolute left-4 right-4 flex-row items-center justify-between gap-4 rounded-xl bg-raised px-4 py-3"
      style={{
        bottom: 16 + (overTabBar ? 0 : insets.bottom),
        elevation: 8,
        shadowColor: '#000',
        shadowOpacity: 0.5,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
      }}>
      <Text className="flex-1 text-sm text-ink" numberOfLines={2}>
        {message}
      </Text>

      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={12} testID="snackbar-action" accessibilityRole="button">
          <Text className="text-sm font-semibold uppercase tracking-wide text-accent">
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
