import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';

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
 */
export function Snackbar({
  message,
  actionLabel,
  onAction,
  onDismiss,
  token,
  durationMs = 8000,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  token: number;
  durationMs?: number;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, durationMs]);

  return (
    <View
      testID="snackbar"
      className="absolute bottom-4 left-4 right-4 flex-row items-center justify-between gap-4 rounded-xl bg-raised px-4 py-3"
      style={{
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
