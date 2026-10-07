import { Image } from 'expo-image';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import palette from '@/constants/palette';
import { attachmentExists, attachmentUri, type StagedAttachment } from '@/db/attachments';
import { isImageMime, shortName } from '@/lib/attachment';

/**
 * Files in the conversation — picking them, previewing them before they are
 * sent, and showing them inside the message that carried them.
 *
 * The same stored files and the same viewer as a record's receipts: a photo
 * attached here and then logged is ONE file, and it looks the same in both
 * places.
 */

const THUMB = 52;

function Thumb({
  file,
  size,
  onPress,
  testID,
}: {
  file: StagedAttachment;
  size: number;
  onPress: () => void;
  testID?: string;
}) {
  const missing = !attachmentExists(file.fileName);
  const image = isImageMime(file.mimeType) && !missing;
  const label = file.originalName ?? (image ? 'Photo' : 'Document');
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={missing ? `${label} — file missing` : label}
      style={{ width: size, height: size }}
      className="overflow-hidden rounded-lg border border-line bg-raised active:opacity-70">
      {image ? (
        <Image
          source={{ uri: attachmentUri(file.fileName) }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : (
        <View className="flex-1 items-center justify-center px-1">
          <Icon name="document" size={18} color={missing ? palette.line : palette.muted} />
          <Text className="mt-0.5 text-[9px] text-muted" numberOfLines={1}>
            {missing ? 'Missing' : shortName(label, 9)}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/** Files waiting to go with the next message, each removable. */
export function PendingFiles({
  files,
  onOpen,
  onRemove,
}: {
  files: StagedAttachment[];
  onOpen: (file: StagedAttachment) => void;
  onRemove: (fileName: string) => void;
}) {
  if (files.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Room on every edge for the remove badges that overhang the corners —
      // a scroll view clips whatever pokes past its content.
      contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 2, gap: 12 }}
      testID="assistant-pending-files">
      {files.map((file) => (
        <View key={file.fileName}>
          <Thumb file={file} size={THUMB} onPress={() => onOpen(file)} testID="assistant-pending-file" />
          <Pressable
            onPress={() => onRemove(file.fileName)}
            hitSlop={8}
            testID="assistant-pending-remove"
            accessibilityRole="button"
            accessibilityLabel={`Remove ${file.originalName ?? 'attachment'}`}
            className="absolute -right-1.5 -top-1.5 h-5 w-5 items-center justify-center rounded-full border border-line bg-ground active:opacity-70">
            <Icon name="close" size={10} color={palette.muted} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

/** The files a sent message carried, inside its bubble. */
export function MessageFiles({
  files,
  onOpen,
}: {
  files: StagedAttachment[];
  onOpen: (file: StagedAttachment) => void;
}) {
  return (
    <View className="flex-row flex-wrap justify-end gap-2" testID="assistant-message-files">
      {files.map((file) => (
        <Thumb key={file.fileName} file={file} size={files.length === 1 && isImageMime(file.mimeType) ? 160 : 72} onPress={() => onOpen(file)} />
      ))}
    </View>
  );
}

/** Camera or files — the two ways a receipt reaches the conversation. */
export function AttachMenu({
  visible,
  onCamera,
  onFiles,
  onClose,
}: {
  visible: boolean;
  onCamera: () => void;
  onFiles: () => void;
  onClose: () => void;
}) {
  const row = (icon: string, label: string, hint: string, onPress: () => void, testID: string) => (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      className="flex-row items-center gap-4 px-5 py-3.5 active:bg-surface">
      <View className="h-10 w-10 items-center justify-center rounded-full bg-raised">
        <Icon name={icon} size={20} color={palette.accent} />
      </View>
      <View className="flex-1">
        <Text className="text-[15px] text-ink">{label}</Text>
        <Text className="text-xs text-muted">{hint}</Text>
      </View>
    </Pressable>
  );
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1" onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss" />
      <View
        className="rounded-t-2xl border-t border-line bg-ground pb-8 pt-2"
        style={{ elevation: 16, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: -4 } }}
        testID="assistant-attach-menu">
        {row('camera', 'Take a photo', 'A receipt, a bill, a price tag', onCamera, 'assistant-attach-camera')}
        {row('folder', 'Choose a file', 'A photo or a PDF invoice or statement', onFiles, 'assistant-attach-files')}
      </View>
    </Modal>
  );
}
