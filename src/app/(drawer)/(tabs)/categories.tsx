import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { ArchivedGroup } from '@/components/archived-group';
import { EntityActions, type EntityItem } from '@/components/entity-actions';
import { Icon } from '@/components/icon';
import { Fab, Screen } from '@/components/screen';
import { db } from '@/db/client';
import { checkDeletion, deleteEntity } from '@/db/repo/archive';
import {
  InvariantError,
  listArchivedCategories,
  listCategoryTree,
  updateCategory,
  type CategoryNode,
} from '@/db/repo/categories';
import type { Category } from '@/db/schema';
import { idSlug } from '@/lib/slug';

function Row({
  category,
  indented,
  dimmed = false,
  onPress,
  onLongPress,
}: {
  category: Category;
  indented?: boolean;
  dimmed?: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      className={`flex-row items-center gap-3 py-2.5 active:opacity-70 ${
        indented ? 'pl-10' : ''
      } ${dimmed ? 'opacity-60' : ''}`}
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
  onHold,
}: {
  title: string;
  nodes: CategoryNode[];
  onOpen: (id: string) => void;
  onHold: (category: Category) => void;
}) {
  return (
    <View className="mb-6">
      <Text className="mb-2 border-b border-line pb-1.5 text-sm font-semibold text-ink">
        {title}
      </Text>
      {nodes.map((node) => (
        <View key={node.id}>
          <Row category={node} onPress={() => onOpen(node.id)} onLongPress={() => onHold(node)} />
          {node.children.map((child) => (
            <Row
              key={child.id}
              category={child}
              indented
              onPress={() => onOpen(child.id)}
              onLongPress={() => onHold(child)}
            />
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
  const [archived, setArchived] = useState<Category[]>([]);
  const [acting, setActing] = useState<EntityItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const reload = useCallback(() => {
    setExpense(listCategoryTree(db, 'expense'));
    setIncome(listCategoryTree(db, 'income'));
    setArchived(listArchivedCategories(db));
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const open = (id: string) => router.push({ pathname: '/category', params: { id } });

  function hold(category: Category) {
    const { blocking, records } = checkDeletion(db, { kind: 'category', id: category.id });
    setNotice(null);
    setProblem(null);
    setActing({
      kind: 'category',
      id: category.id,
      name: category.name,
      icon: category.icon,
      color: category.color,
      detail: category.kind === 'income' ? 'Income' : 'Expense',
      archived: category.archived,
      records,
      blocking,
      testKey: idSlug(category.id),
    });
  }

  function showRecords(item: EntityItem) {
    const { filter } = checkDeletion(db, { kind: 'category', id: item.id });
    setActing(null);
    if (filter) router.push({ pathname: '/search', params: filter });
  }

  function archive(item: EntityItem) {
    // Both cascades — down to the children, up to the parent — live inside
    // `updateCategory`, so nothing here has to remember them.
    updateCategory(db, item.id, { archived: !item.archived });
    setActing(null);
    setNotice(item.archived ? `${item.name} is back.` : `${item.name} is put away.`);
    reload();
  }

  function remove(item: EntityItem) {
    try {
      deleteEntity(db, { kind: 'category', id: item.id });
      setNotice(`${item.name} deleted.`);
    } catch (error) {
      setProblem(error instanceof InvariantError ? error.message : `Could not delete ${item.name}.`);
    }
    setActing(null);
    reload();
  }

  return (
    <Screen testID="categories-screen">
      {/* Same as Accounts: the tab bar already names this screen. */}
      {/* Income first, matching the reference app. It is the far shorter list,
          so leading with it keeps both sections reachable — putting ~26 expense
          rows first buries income below the fold entirely. */}
      <ScrollView contentContainerClassName="px-4 pt-4 pb-8">
        {notice ? (
          <Text className="pb-2 text-xs text-muted" testID="categories-notice">
            {notice}
          </Text>
        ) : null}
        {problem ? (
          <Text className="pb-2 text-xs text-expense" testID="categories-problem">
            {problem}
          </Text>
        ) : null}

        <Section title="Income categories" nodes={income} onOpen={open} onHold={hold} />
        <Section title="Expense categories" nodes={expense} onOpen={open} onHold={hold} />

        {/* This tab had NO archived surface at all: a category put away simply
            vanished, and the only way back was a Settings screen. */}
        <ArchivedGroup
          count={archived.length}
          hint="Still on every record that wore them, and off every picker. Hold one to bring it back."
          testID="categories-archived">
          {archived.map((category) => (
            <Row
              key={category.id}
              category={category}
              indented={!!category.parentId}
              dimmed
              onPress={() => open(category.id)}
              onLongPress={() => hold(category)}
            />
          ))}
        </ArchivedGroup>

        <Text className="px-1 pt-3 text-xs leading-5 text-muted">
          Hold a category to see its records, put it away, or delete it.
        </Text>
      </ScrollView>

      <EntityActions
        item={acting}
        onClose={() => setActing(null)}
        onShowRecords={showRecords}
        onUpdateBalance={() => {}}
        onEdit={(item) => {
          setActing(null);
          open(item.id);
        }}
        onRename={() => {}}
        onArchive={archive}
        onDelete={remove}
      />

      <Fab onPress={() => router.push('/category')} testID="fab-category" />
    </Screen>
  );
}
