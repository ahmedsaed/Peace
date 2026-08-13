import { NativeModule, requireNativeModule } from 'expo';

/**
 * The native surface, and nothing more.
 *
 * Four questions and one hand-over. Everything about which messages matter and
 * what they mean is decided in `src/lib/bank-sms.ts`, where it is testable
 * without a phone.
 */
/**
 * Fired when the service captures a notification while the app is running.
 *
 * The app otherwise only looks on launch and on foreground, so a message
 * arriving while someone is looking at the records list would show up nowhere
 * until they navigated — which reads as the feature being broken.
 */
export type NotificationListenerEvents = {
  onCapture: () => void;
};

declare class NotificationListenerModule extends NativeModule<NotificationListenerEvents> {
  /** Has the user granted notification access on the system settings screen? */
  isPermitted(): boolean;
  /** Open that screen. There is no dialog for this permission. */
  openSettings(): void;
  /** Whether Peace should be capturing — separate from Android's permission. */
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  /** How many captures are waiting, without consuming them. */
  pendingCount(): number;
  /**
   * Take everything captured and clear it, as a JSON array.
   *
   * Raw JSON rather than a typed array: the shape is validated in one place in
   * JavaScript, and a native-side type would be a second definition of it.
   */
  drain(): string;
}

export default requireNativeModule<NotificationListenerModule>('NotificationListener');
