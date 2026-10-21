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
 *
 * A photo shows here and ALSO carries a Share button at the foot, because a
 * receipt is often wanted somewhere else — sent to whoever is paying you back,
 * or to an expenses form. Both go through the same share sheet.
 */

import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { useTheme } from '@/state/theme';
import { attachmentExists, attachmentUri, type StagedAttachment } from '@/db/attachments';
import { isImageMime } from '@/lib/attachment';
import { formatBytes } from '@/db/backup';

type Props = {
  attachment: StagedAttachment | null;
  onClose: () => void;
};

export function AttachmentViewer({ attachment, onClose }: Props) {
  const palette = useTheme();
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
        dialogTitle: label,
        // iOS only; Android goes by the mime type above. Left out for a photo,
        // where the system works it out from the file itself.
        UTI: image
          ? undefined
          : attachment.mimeType === 'text/plain'
            ? 'public.plain-text'
            : 'com.adobe.pdf',
      });
    } catch (e) {
      // Friendly sentence for the user, the real error for whoever fixes it.
      console.warn('[attachments] could not share the file', e);
      setError(image ? 'Could not share this photo.' : 'Could not open this file.');
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
        <View className="px-4 py-3">
          <Text className="text-sm text-white/80" numberOfLines={1}>
            {label}
          </Text>
        </View>

        {/* Dismissing by tapping the backdrop as well as the button: a
            full-screen overlay is the kind of thing people get stuck in. */}
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
              ) : null}
            </View>
          )}
        </Pressable>

        {/* The actions sit at the FOOT, under the thumb, rather than in a
            header corner — the same Cancel-left, act-right pair as the record
            screen. A photo is shared; anything else is opened in the app the
            phone uses for it, through the same share sheet. */}
        {error ? (
          <Text className="px-4 pb-2 text-center text-xs text-negative" testID="viewer-error">
            {error}
          </Text>
        ) : null}
        <View className="flex-row gap-3 px-4 pb-3 pt-2">
          <Pressable
            onPress={onClose}
            testID="viewer-close"
            accessibilityRole="button"
            className="h-12 flex-1 flex-row items-center justify-center gap-2 rounded-lg border border-line bg-surface active:opacity-70">
            <Icon name="close" size={16} color={palette.ink} />
            <Text className="text-sm font-medium text-ink">Close</Text>
          </Pressable>
          {missing ? null : (
            <Pressable
              onPress={openElsewhere}
              testID={image ? 'viewer-share' : 'viewer-open'}
              accessibilityRole="button"
              className="h-12 flex-1 flex-row items-center justify-center gap-2 rounded-lg bg-accent active:opacity-80">
              <Icon name={image ? 'share' : 'document'} size={16} color={palette['accent-ink']} />
              <Text className="text-sm font-semibold text-accent-ink">
                {image ? 'Share' : 'Open'}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}
