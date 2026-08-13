/**
 * Receipts on the record screen.
 *
 * Two square buttons in the foot of the notes field and a row of square
 * previews beneath them — inside the same rounded surface, so the whole thing
 * reads as one control rather than as a toolbar that happens to sit near a
 * text box.
 *
 * The buttons are laid out as a FOOTER ROW rather than floated over the text.
 * Absolutely positioning them in the corner is what the design asks for
 * literally, and it puts two opaque squares on top of a field whose text
 * scrolls underneath them — fine while the note is short, unreadable the moment
 * it is not, and invisible in every screenshot taken with a short note.
 *
 * SPLIT-SCREEN IS A SUPPORTED LAYOUT, NOT AN EDGE CASE. At `tight` the note is
 * already a single line sharing a row with two picker squares; a preview strip
 * there would cost more height than the note itself has. So the previews are
 * dropped and the two buttons become one, with the count on it — nothing is
 * hidden, because the count is the thing you would look for, and the record
 * screen is the one screen that must survive 340dp of height.
 */

import { Image } from 'expo-image';
import { memo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import palette from '@/constants/palette';
import { attachmentExists, attachmentUri, type StagedAttachment } from '@/db/attachments';
import { isImageMime, shortName } from '@/lib/attachment';

export const PREVIEW_SIZE = 56;
/**
 * How far the corner badges overhang a tile.
 *
 * Both the remove and the read badge sit ON the corners, so the scroll view
 * needs this much padding at top and bottom or it slices them off — which is
 * exactly what happened to the read badge along the bottom edge.
 */
const BADGE_ROOM = 8;
/** Two 40dp buttons and the 8dp gap between them. */
const BUTTONS_WIDTH = 40 * 2 + 8;

type Props = {
  attachments: StagedAttachment[];
  onCamera: () => void;
  onFiles: () => void;
  onRemove: (fileName: string) => void;
  onOpen: (attachment: StagedAttachment) => void;
  /**
   * Read this receipt and fill in the form.
   *
   * Offered per attachment rather than once for the record, because a record
   * can carry several and only one of them is the receipt worth reading.
   */
  onRead: (attachment: StagedAttachment) => void;
  /** Which attachment is being read, so only its own badge spins. */
  reading: string | null;
  /** True in split-screen: previews go, the buttons merge, the count stays. */
  compact: boolean;
  busy?: boolean;
};

/**
 * One preview.
 *
 * A row whose FILE is missing is drawn as its own state rather than as a broken
 * image. That happens after restoring a backup made before attachments existed
 * — the rows describe receipts that were never in the file — and a grey box
 * with no explanation reads as a bug in the app rather than as the age of the
 * backup.
 */
const Preview = memo(function Preview({
  attachment,
  onOpen,
  onRemove,
  onRead,
  reading,
}: {
  attachment: StagedAttachment;
  onOpen: () => void;
  onRemove: () => void;
  onRead: () => void;
  reading: boolean;
}) {
  const missing = !attachmentExists(attachment.fileName);
  const image = isImageMime(attachment.mimeType) && !missing;
  const label = attachment.originalName ?? 'Receipt';

  return (
    <View style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}>
      <Pressable
        onPress={onOpen}
        testID={`attachment-${attachment.fileName.slice(0, 8)}`}
        accessibilityRole="button"
        accessibilityLabel={missing ? `${label} — file missing` : label}
        className="h-full w-full overflow-hidden rounded-lg border border-line bg-raised active:opacity-70">
        {image ? (
          <Image
            source={{ uri: attachmentUri(attachment.fileName) }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            // The file never changes under its name — it is named by its hash —
            // so there is nothing to invalidate and caching is free.
            cachePolicy="memory-disk"
          />
        ) : (
          <View className="flex-1 items-center justify-center px-1">
            <Icon
              name="document"
              size={18}
              color={missing ? palette.line : palette.muted}
            />
            <Text
              className={`mt-0.5 text-[9px] ${missing ? 'text-line' : 'text-muted'}`}
              numberOfLines={1}>
              {missing ? 'Missing' : shortName(label, 9)}
            </Text>
          </View>
        )}
      </Pressable>

      {/* Sits ON the corner of the thumbnail rather than beside it: a row of
          56px squares has no room for a second control per item, and a delete
          you have to long-press for is a delete nobody finds. */}
      <Pressable
        onPress={onRemove}
        hitSlop={8}
        testID={`attachment-remove-${attachment.fileName.slice(0, 8)}`}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${label}`}
        className="absolute -right-1.5 -top-1.5 h-5 w-5 items-center justify-center rounded-full border border-line bg-ground active:opacity-70">
        <Icon name="close" size={10} color={palette.muted} />
      </Pressable>

      {/**
       * "Read this one."
       *
       * Only on an IMAGE that is actually there — a PDF cannot be photographed
       * into a total by this path, and a missing file has nothing to read. An
       * affordance that is present but cannot work is the thing that teaches
       * you to stop trusting the app.
       */}
      {image ? (
        <Pressable
          onPress={onRead}
          disabled={reading}
          hitSlop={8}
          testID={`attachment-read-${attachment.fileName.slice(0, 8)}`}
          accessibilityRole="button"
          accessibilityLabel={reading ? `Reading ${label}` : `Read ${label} and fill in the record`}
          className="absolute -bottom-1.5 -right-1.5 h-5 w-5 items-center justify-center rounded-full border border-accent bg-ground active:opacity-70">
          {reading ? (
            <ActivityIndicator size="small" color={palette.accent} />
          ) : (
            <Icon name="sparkle" size={11} color={palette.accent} />
          )}
        </Pressable>
      ) : null}
    </View>
  );
});

function SquareButton({
  icon,
  label,
  onPress,
  disabled,
  testID,
  badge,
}: {
  icon: 'camera' | 'folder';
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
  badge?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`h-10 w-10 items-center justify-center rounded-lg border border-line active:opacity-70 ${
        disabled ? 'opacity-40' : ''
      }`}>
      <Icon name={icon} size={18} color={palette.muted} />
      {badge ? (
        <View className="absolute -right-1 -top-1 h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1">
          <Text className="text-[10px] font-semibold text-accent-ink">{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function AttachmentBar({
  attachments,
  onCamera,
  onFiles,
  onRemove,
  onOpen,
  onRead,
  reading,
  compact,
  busy,
}: Props) {
  /**
   * One button in split-screen, and it opens the CAMERA.
   *
   * Of the two, the camera is the one that cannot be done later — the receipt
   * is in your hand now. Picking a file that is already on the phone can wait
   * for a full-height window, and the count on the badge still says how many
   * are attached.
   */
  if (compact) {
    return (
      <SquareButton
        icon="camera"
        label={`Attach a receipt. ${attachments.length} attached`}
        onPress={onCamera}
        disabled={busy}
        testID="attach-camera"
        badge={attachments.length}
      />
    );
  }

  /**
   * The strip and the buttons share one band; the buttons FLOAT over its right.
   *
   * They had a row of their own, which cost 40dp of a screen that fights for
   * every pixel and pushed the receipts a whole row further from the field they
   * belong to. Floating them puts the previews beside the buttons rather than
   * above them, and the band is no taller than one thumbnail.
   */
  return (
    <View
      className="relative"
      // Only as tall as it needs to be: one thumbnail plus its badges when
      // there are receipts, one button when there are none. A band sized for
      // previews that do not exist is 32dp of a short screen given to nothing.
      style={{ minHeight: attachments.length > 0 ? PREVIEW_SIZE + BADGE_ROOM * 2 : 40 }}
      testID="attachment-bar">
      {attachments.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            gap: 10,
            // Room for the badges, which overhang the corners of every tile and
            // would otherwise be sliced off by the scroll view's own bounds —
            // the read badge was visibly clipped along the bottom edge.
            paddingTop: BADGE_ROOM,
            paddingBottom: BADGE_ROOM,
            /**
             * SCROLL PAST THE LAST ONE.
             *
             * Without this the final thumbnail comes to rest UNDER the floating
             * buttons and cannot be moved out from beneath them — the one
             * receipt you just added is the one you cannot see. The trailing
             * space is the buttons' own width, so the last tile can be scrolled
             * fully clear into the middle of the strip.
             */
            paddingRight: BUTTONS_WIDTH + 12,
          }}
          testID="attachment-previews">
          {attachments.map((attachment) => (
            <Preview
              key={attachment.fileName}
              attachment={attachment}
              onOpen={() => onOpen(attachment)}
              onRemove={() => onRemove(attachment.fileName)}
              onRead={() => onRead(attachment)}
              reading={reading === attachment.fileName}
            />
          ))}
        </ScrollView>
      ) : null}

      {/* Over the strip, not in the flow. `pointerEvents="box-none"` on the
          wrapper so the scroll gesture still reaches the strip everywhere the
          buttons themselves are not. */}
      <View
        className="absolute bottom-0 right-0 flex-row gap-2"
        pointerEvents="box-none"
        style={{ width: BUTTONS_WIDTH }}>
        <SquareButton
          icon="camera"
          label="Photograph a receipt"
          onPress={onCamera}
          disabled={busy}
          testID="attach-camera"
        />
        <SquareButton
          icon="folder"
          label="Attach a file"
          onPress={onFiles}
          disabled={busy}
          testID="attach-file"
        />
      </View>
    </View>
  );
}
