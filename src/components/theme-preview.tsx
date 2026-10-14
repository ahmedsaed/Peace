import { Text, View } from 'react-native';

import { WORDMARK_FONT } from '@/components/wordmark';
import type { ThemeColors } from '@/lib/theme';

/**
 * The records screen in miniature, drawn in one theme's LITERAL colours.
 *
 * Settings › Appearance is the one place that draws themes other than the
 * active one, so this takes a palette as a prop rather than reading
 * `useTheme()`. Text is drawn as bars rather than words, and figures as
 * coloured bars rather than amounts: a preview is geometry, it names no sum,
 * and so it has nothing for "hide amounts" to mask.
 *
 * Category circles keep their own colours in every theme — they are data
 * (docs/design-system.md, rule 4) — which is exactly what the preview should
 * show: the chrome changes around them.
 */
const ROWS = [
  { circle: '#B03A3A', title: 30, note: 20, amount: 'expense' as const, width: 18 },
  { circle: '#3B4E9E', title: 24, note: 26, amount: 'expense' as const, width: 14 },
  { circle: '#2E7D46', title: 34, note: 16, amount: 'income' as const, width: 22 },
];

export function ThemePreview({ colors: c, height = 210 }: { colors: ThemeColors; height?: number }) {
  return (
    <View
      style={{
        height,
        borderRadius: 14,
        overflow: 'hidden',
        backgroundColor: c.ground,
        borderWidth: 1,
        borderColor: c.line,
      }}>
      {/* Header: the wordmark, the two header buttons, the month's totals. */}
      <View style={{ backgroundColor: c.surface, paddingHorizontal: 9, paddingTop: 7, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text
            style={{ fontFamily: WORDMARK_FONT, fontSize: 13, lineHeight: 19, color: c.accent, includeFontPadding: false }}>
            Peace
          </Text>
          <View style={{ flexDirection: 'row', gap: 5 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.ink }} />
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.ink }} />
          </View>
        </View>
        <View style={{ marginTop: 6, flexDirection: 'row', justifyContent: 'space-between' }}>
          {(['expense', 'income', 'income'] as const).map((tone, i) => (
            <View key={i} style={{ alignItems: 'center', gap: 3, flex: 1 }}>
              <View style={{ width: 16, height: 2, borderRadius: 1, backgroundColor: c.muted }} />
              <View style={{ width: 24, height: 4, borderRadius: 2, backgroundColor: c[tone] }} />
            </View>
          ))}
        </View>
      </View>

      {/* A day heading and three records. */}
      <View style={{ paddingHorizontal: 9, paddingTop: 7 }}>
        <View style={{ width: 34, height: 3, borderRadius: 2, backgroundColor: c.muted, marginBottom: 5 }} />
        {/* Two rows when short, or the add button sits on the third. */}
        {ROWS.slice(0, height < 180 ? 2 : 3).map((row, i) => (
          <View
            key={i}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingVertical: 5,
              borderBottomWidth: 1,
              borderBottomColor: c.line,
            }}>
            <View style={{ width: 13, height: 13, borderRadius: 7, backgroundColor: row.circle }} />
            <View style={{ flex: 1, gap: 3 }}>
              <View style={{ width: row.title, height: 3, borderRadius: 2, backgroundColor: c.ink }} />
              <View style={{ width: row.note, height: 2, borderRadius: 1, backgroundColor: c.muted }} />
            </View>
            <View style={{ width: row.width, height: 4, borderRadius: 2, backgroundColor: c[row.amount] }} />
          </View>
        ))}
      </View>

      {/* The add button, and the tab bar with Records active. */}
      <View
        style={{
          position: 'absolute',
          right: 9,
          bottom: 30,
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: c.accent,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <View style={{ position: 'absolute', width: 9, height: 2, backgroundColor: c['accent-ink'] }} />
        <View style={{ position: 'absolute', width: 2, height: 9, backgroundColor: c['accent-ink'] }} />
      </View>
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 22,
          backgroundColor: c.surface,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-around',
        }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <View
            key={i}
            style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: i === 0 ? c.accent : c.muted }}
          />
        ))}
      </View>
    </View>
  );
}
