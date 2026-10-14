/**
 * Peace's own viewfinder: the notes field turns into the camera.
 *
 * WHY NOT THE CAMERA APP. Handing off to it means leaving Peace, taking the
 * photo, then confirming it on a second screen before coming back — three
 * moves for something done standing at a till. Here it is one: the shutter
 * attaches the photo and closes the viewfinder. There is no confirm step on
 * purpose, because the thumbnail that appears is the confirmation and its ✕
 * is the undo — cheaper than confirming every photo that came out fine.
 *
 * The phone's own camera stays one tap away ("Camera app"): it has night mode
 * and HDR, and it is the way out on a phone where this view misbehaves.
 *
 * IT ONLY RUNS WHILE IT IS SHOWN. Opening a record must never start the camera
 * — Android lights its "camera in use" dot, and the battery pays, for every
 * lunch typed by hand. The record screen mounts this only when asked, and it
 * closes itself when the app goes to the background, so returning never finds
 * a camera session that Android has already torn down underneath it.
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Keyboard, Linking, Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';

export type CapturedPhoto = { uri: string; width: number; height: number };

export function InlineCamera({
  onCapture,
  onClose,
  onCameraApp,
}: {
  /** Called once per shutter press, with the photo as taken (cache file). */
  onCapture: (photo: CapturedPhoto) => void;
  onClose: () => void;
  /** Hand over to the phone's camera app instead. */
  onCameraApp: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [torch, setTorch] = useState(false);
  const [shooting, setShooting] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // The keyboard would cover the shutter, and nobody is typing into a camera.
  useEffect(() => {
    Keyboard.dismiss();
  }, []);

  // Asked at the moment the camera is wanted, never at launch: a prompt with
  // nothing on screen to explain it is the one people deny.
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') onClose();
    });
    return () => sub.remove();
  }, [onClose]);

  async function shoot() {
    if (!ready || shooting || !camera.current) return;
    setShooting(true);
    try {
      // Full quality out of the sensor, then downscaled ONCE by the caller —
      // compressing here as well would put JPEG artefacts through JPEG again.
      const photo = await camera.current.takePictureAsync({
        quality: 1,
        exif: false,
      });
      if (photo?.uri) onCapture({ uri: photo.uri, width: photo.width, height: photo.height });
    } catch (e) {
      console.warn('[camera] could not take the picture', e);
      setFailed('The camera did not take that one. Try again, or use the camera app.');
      setShooting(false);
    }
  }

  const frame = 'flex-1 overflow-hidden rounded-lg bg-black';

  if (!permission) {
    return (
      <View className={`${frame} items-center justify-center`} testID="inline-camera">
        <ActivityIndicator color="#FFFFFF" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View className={`${frame} items-center justify-center gap-3 px-6`} testID="inline-camera-denied">
        <Text className="text-center text-sm leading-5 text-white">
          {permission.canAskAgain
            ? 'Peace needs the camera to photograph a receipt.'
            : 'Camera access is off for Peace. Turn it on in Android settings to photograph receipts here.'}
        </Text>
        <View className="flex-row gap-3">
          <ChromeButton
            label={permission.canAskAgain ? 'Allow camera' : 'Open settings'}
            onPress={() => (permission.canAskAgain ? void requestPermission() : void Linking.openSettings())}
            testID="inline-camera-allow"
          />
          <ChromeButton label="Close" onPress={onClose} testID="inline-camera-close" />
        </View>
      </View>
    );
  }

  return (
    <View className={frame} testID="inline-camera">
      <CameraView
        ref={camera}
        style={{ flex: 1 }}
        facing="back"
        mode="picture"
        enableTorch={torch}
        onCameraReady={() => setReady(true)}
        onMountError={({ message }) => {
          console.warn('[camera] preview failed to start', message);
          setFailed('The camera could not start here. The camera app still works.');
        }}
      />

      {/* Top: close on the right, where a thumb looks for it; the torch on the
          left, for receipts read by restaurant candlelight. */}
      <View className="absolute left-0 right-0 top-0 flex-row items-center justify-between p-2">
        <RoundButton
          icon="torch"
          label={torch ? 'Turn the torch off' : 'Turn the torch on'}
          selected={torch}
          onPress={() => setTorch((on) => !on)}
          testID="inline-camera-torch"
        />
        <RoundButton icon="close" label="Close the camera" onPress={onClose} testID="inline-camera-close" />
      </View>

      {failed ? (
        <View className="absolute left-3 right-3 top-14 rounded-lg bg-black/70 px-3 py-2">
          <Text className="text-center text-xs leading-4 text-white" testID="inline-camera-error">
            {failed}
          </Text>
        </View>
      ) : null}

      {/* Bottom: the shutter in the middle, the hand-over to the camera app
          beside it — quieter, because it is the exception. */}
      <View className="absolute bottom-0 left-0 right-0 flex-row items-center justify-center pb-3">
        <Pressable
          onPress={onCameraApp}
          accessibilityRole="button"
          accessibilityLabel="Use the camera app instead"
          testID="inline-camera-app"
          hitSlop={8}
          className="absolute left-3 rounded-full bg-black/50 px-3 py-1.5 active:opacity-70">
          <Text className="text-xs text-white">Camera app</Text>
        </Pressable>
        <Pressable
          onPress={shoot}
          disabled={!ready || shooting}
          accessibilityRole="button"
          accessibilityLabel="Take the photo"
          accessibilityState={{ disabled: !ready || shooting, busy: shooting }}
          testID="inline-camera-shutter"
          className={`h-16 w-16 items-center justify-center rounded-full border-4 border-white active:opacity-70 ${
            ready ? '' : 'opacity-40'
          }`}>
          {shooting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <View className="h-12 w-12 rounded-full bg-white" />
          )}
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Controls drawn ON the picture, so they are white on a dark scrim whatever
 * the theme: the background is a camera feed, not one of our surfaces.
 */
function RoundButton({
  icon,
  label,
  onPress,
  selected = false,
  testID,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  selected?: boolean;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      testID={testID}
      hitSlop={6}
      className={`h-10 w-10 items-center justify-center rounded-full active:opacity-70 ${
        selected ? 'bg-white' : 'bg-black/50'
      }`}>
      <Icon name={icon} size={20} color={selected ? '#000000' : '#FFFFFF'} />
    </Pressable>
  );
}

function ChromeButton({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      testID={testID}
      className="rounded-full bg-white/15 px-4 py-2 active:opacity-70">
      <Text className="text-sm font-medium text-white">{label}</Text>
    </Pressable>
  );
}
