import { ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Screen, ScreenHeader } from '@/components/screen';
import { db } from '@/db/client';
import { listCategoryTree, type CategoryNode } from '@/db/repo/categories';
import type { Category } from '@/db/schema';

function Row({ category, indented }: { category: Category; indented?: boolean }) {
  return (
    <View
      className={`flex-row items-center gap-3 py-2.5 ${indented ? 'pl-10' : ''}`}
      testID={`category-${category.id}`}>
      <View
        className={`items-center justify-center rounded-full ${indented ? 'h-7 w-7' : 'h-9 w-9'}`}
        style={{ backgroundColor: category.color ?? '#6B5B4A' }}>
        <Icon name={category.icon ?? 'dots'} size={indented ? 13 : 17} color="#FFFFFF" />
      </View>
      <Text className={indented ? 'text-sm text-muted' : 'text-base text-ink'}>
        {category.name}
      </Text>
    </View>
  );
}

function Section({ title, nodes }: { title: string; nodes: CategoryNode[] }) {
  return (
    <View className="mb-6">
      <Text className="mb-2 border-b border-line pb-1.5 text-sm font-semibold text-ink">
        {title}
      </Text>
      {nodes.map((node) => (
        <View key={node.id}>
          <Row category={node} />
          {node.children.map((child) => (
            <Row key={child.id} category={child} indented />
          ))}
        </View>
      ))}
    </View>
  );
}

export default function CategoriesScreen() {
  // Two separate lists, never mixed — a category is income XOR expense.
  const expense = listCategoryTree(db, 'expense');
  const income = listCategoryTree(db, 'income');

  return (
    <Screen testID="categories-screen">
      <ScreenHeader title="Categories" />
      {/* Income first, matching the reference app. It is the far shorter list,
          so leading with it keeps both sections reachable — putting ~26 expense
          rows first buries income below the fold entirely. */}
      <ScrollView contentContainerClassName="px-4 pt-4 pb-8">
        <Section title="Income categories" nodes={income} />
        <Section title="Expense categories" nodes={expense} />
      </ScrollView>
    </Screen>
  );
}
