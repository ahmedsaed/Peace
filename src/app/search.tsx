import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { EmptyState, StackHeader } from '@/components/screen';
import palette from '@/constants/palette';

/**
 * Search, laid out but not wired.
 *
 * The field is a real, typeable input rather than a disabled stub so the
 * spacing and keyboard behaviour are the ones the finished screen will have.
 * Querying arrives with the rest of Stage 2 — the empty state says so plainly,
 * because a search box that silently returns nothing looks like a bug.
 */
export default function SearchScreen() {
  const [query, setQuery] = useState('');

  return (
    <View className="flex-1 bg-ground" testID="search-screen">
      <StackHeader title="Search" />

      <View className="bg-surface px-4 pb-3">
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Note, category or amount"
          placeholderTextColor={palette.muted}
          testID="search-input"
          autoFocus
          returnKeyType="search"
          className="rounded-lg bg-raised px-4 py-3 text-base text-ink"
        />
      </View>

      <EmptyState
        icon="search"
        title="Search is not wired up yet"
        hint="Filtering records by note, category, account and amount range lands in Stage 2."
      />
    </View>
  );
}
