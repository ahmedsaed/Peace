import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Fab, Screen, ScreenHeader } from '@/components/screen';
import { db } from '@/db/client';
import { listCategoryTree, type CategoryNode } from '@/db/repo/categories';
import type { Category } from '@/db/schema';

function Row({
  category,
  indented,
  onPress,
}: {
  category: Category;
  indented?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center gap-3 py-2.5 active:opacity-70 ${indented ? 'pl-10' : ''}`}
      testID={`category-${category.id}`}>
      <View
        className={`items-center justify-center rounded-full ${indented ? 'h-7 w-7' : 'h-9 w-9'}`}
        style={{ backgroundColor: category.color ?? '#6B5B4A' }}>
        <Icon name={category.icon ?? 'dots'} size={indented ? 13 : 17} color="#FFFFFF" />
      </View>
      <Text className={indented ? 'text-sm text-muted' : 'text-base text-ink'}>
        {category.name}
      </Text>
    </Pressable>
  );
}

function Section({
  title,
  nodes,
  onOpen,
}: {
  title: string;
  nodes: CategoryNode[];
  onOpen: (id: string) => void;
}) {
  return (
    <View className="mb-6">
      <Text className="mb-2 border-b border-line pb-1.5 text-sm font-semibold text-ink">
        {title}
      </Text>
      {nodes.map((node) => (
        <View key={node.id}>
          <Row category={node} onPress={() => onOpen(node.id)} />
          {node.children.map((child) => (
            <Row key={child.id} category={child} indented onPress={() => onOpen(child.id)} />
          ))}
        </View>
      ))}
    </View>
  );
}

export default function CategoriesScreen() {
  const router = useRouter();
  // Two separate lists, never mixed — a category is income XOR expense.
  const [expense, setExpense] = useState<CategoryNode[]>([]);
  const [income, setIncome] = useState<CategoryNode[]>([]);

  useFocusEffect(
    useCallback(() => {
      setExpense(listCategoryTree(db, 'expense'));
      setIncome(listCategoryTree(db, 'income'));
    }, [])
  );

  const open = (id: string) => router.push({ pathname: '/category', params: { id } });

  return (
    <Screen testID="categories-screen">
      <ScreenHeader title="Categories" />
      {/* Income first, matching the reference app. It is the far shorter list,
          so leading with it keeps both sections reachable — putting ~26 expense
          rows first buries income below the fold entirely. */}
      <ScrollView contentContainerClassName="px-4 pt-4 pb-8">
        <Section title="Income categories" nodes={income} onOpen={open} />
        <Section title="Expense categories" nodes={expense} onOpen={open} />
      </ScrollView>

      <Fab onPress={() => router.push('/category')} testID="fab-category" />
    </Screen>
  );
}
