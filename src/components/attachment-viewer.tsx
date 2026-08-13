/**
 * A receipt, full screen.
 *
 * A 56px thumbnail proves a photo was attached and nothing more — you cannot
 * read a total off it, which is the entire reason for photographing a receipt.
 * Tapping one has to open something.
 *
 * A PDF is handed to whatever app the phone uses for PDFs rather than rendered
 * here. Bundling a PDF renderer to display an invoice somebody already has a
 * reader for would be a native dependency, an APK several megabytes larger, and
 * a worse reader than the one they chose.
 */

import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import palette from '@/constants/palette';
import { attachmentExists, attachmentUri, type StagedAttachment } from '@/db/attachments';
import { isImageMime } from '@/lib/attachment';
import { formatBytes } from '@/db/backup';

type Props = {
  attachment: StagedAttachment | null;
  onClose: () => void;
};

export function AttachmentViewer({ attachment, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);

  if (!attachment) return null;

  const missing = !attachmentExists(attachment.fileName);
  const image = isImageMime(attachment.mimeType) && !missing;
  const label = attachment.originalName ?? 'Receipt';

  async function openElsewhere() {
    if (!attachment) return;
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setError('This phone has no app that can open it.');
        return;
      }
      await Sharing.shareAsync(attachmentUri(attachment.fileName), {
        mimeType: attachment.mimeType,
        UTI: 'com.adobe.pdf',
      });
    } catch (e) {
      // Friendly sentence for the user, the real error for whoever fixes it.
      console.warn('[attachments] could not open the file', e);
      setError('Could not open this file.');
    }
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View
        className="flex-1 bg-black/90"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
        testID="attachment-viewer">
        <View className="flex-row items-center justify-between px-4 py-3">
          <Text className="flex-1 text-sm text-white/80" numberOfLines={1}>
            {label}
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            testID="viewer-close"
            accessibilityRole="button"
            accessibilityLabel="Close"
            className="h-10 w-10 items-center justify-center rounded-lg active:opacity-70">
            <Icon name="close" size={18} color="#ffffff" />
          </Pressable>
        </View>

        {/* Dismissing by tapping the backdrop as well as the button: a
            full-screen overlay with one small target in a corner is the kind
            of thing people get stuck in. */}
        <Pressable className="flex-1 items-center justify-center px-4" onPress={onClose}>
          {image ? (
            <Image
              source={{ uri: attachmentUri(attachment.fileName) }}
              style={{ width: '100%', height: '100%' }}
              contentFit="contain"
              cachePolicy="memory-disk"
              testID="viewer-image"
            />
          ) : (
            <View className="items-center gap-3">
              <Icon name="document" size={48} color={missing ? palette.line : '#ffffff'} />
              <Text className="text-center text-base text-white/80">
                {missing
                  ? 'This file is not on this phone.'
                  : `${attachment.mimeType} · ${formatBytes(attachment.byteSize)}`}
              </Text>
              {missing ? (
                <Text className="max-w-xs text-center text-xs text-white/50">
                  It was attached on another device, or restored from a backup made before Peace
                  kept receipts.
                </Text>
              ) : (
                <Pressable
                  onPress={openElsewhere}
                  testID="viewer-open"
                  accessibilityRole="button"
                  className="mt-2 rounded-lg bg-accent px-5 py-3 active:opacity-80">
                  <Text className="text-sm font-semibold text-accent-ink">Open</Text>
                </Pressable>
              )}
              {error ? <Text className="text-xs text-negative">{error}</Text> : null}
            </View>
          )}
        </Pressable>
      </View>
    </Modal>
  );
}
