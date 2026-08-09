import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ColorPicker,
  DangerButton,
  Field,
  FormHeader,
  IconPicker,
  Segmented,
  TextField,
} from '@/components/form';
import { PickerSheet, type PickerOption } from '@/components/picker-sheet';
import { db } from '@/db/client';
import {
  createCategory,
  deleteCategory,
  getCategory,
  InvariantError,
  listTopLevel,
  updateCategory,
} from '@/db/repo/categories';
import type { Category } from '@/db/schema';
import { newId } from '@/lib/id';

const KINDS: { value: Category['kind']; label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
];

const NO_PARENT = '__none__';

export default function CategoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();

  const existing = useMemo(() => (id ? getCategory(db, id) : undefined), [id]);

  const [name, setName] = useState(existing?.name ?? '');
  const [kind, setKind] = useState<Category['kind']>(existing?.kind ?? 'expense');
  const [parentId, setParentId] = useState<string | null>(existing?.parentId ?? null);
  const [icon, setIcon] = useState(existing?.icon ?? 'dots');
  const [color, setColor] = useState(existing?.color ?? '#6B5B4A');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only same-kind top-level categories can be a parent, and never itself.
  const parents = useMemo(
    () => listTopLevel(db, kind).filter((c) => c.id !== existing?.id),
    [kind, existing?.id]
  );
  const parent = parents.find((p) => p.id === parentId);

  const canSave = name.trim().length > 0;

  function onSave() {
    if (!canSave) return;
    try {
      if (existing) {
        updateCategory(db, existing.id, { name, kind, parentId, icon, color });
      } else {
        createCategory(db, { id: newId(), name, kind, parentId, icon, color });
      }
      router.back();
    } catch (e) {
      // The two-tier and matching-kind rules explain themselves — show them.
      setError(e instanceof InvariantError ? e.message : 'Could not save this category.');
    }
  }

  function onDelete() {
    if (!existing) return;
    try {
      // Safe by construction: records survive uncategorised and children are
      // promoted rather than deleted.
      deleteCategory(db, existing.id);
      router.back();
    } catch (e) {
      setError(e instanceof InvariantError ? e.message : 'Could not delete this category.');
    }
  }

  const parentOptions: PickerOption[] = [
    { id: NO_PARENT, label: 'None (top level)', icon: 'dots', color: '#6B5B4A' },
    ...parents.map((p) => ({ id: p.id, label: p.name, icon: p.icon, color: p.color })),
  ];

  return (
    <View
      className="flex-1 bg-ground"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      testID="category-screen">
      <FormHeader
        title={existing ? 'Edit category' : 'New category'}
        onCancel={() => router.back()}
        onSave={onSave}
        canSave={canSave}
      />

      <ScrollView contentContainerClassName="px-4 pb-8" keyboardShouldPersistTaps="handled">
        <Field label="Name">
          <TextField
            value={name}
            onChangeText={setName}
            placeholder="Groceries"
            testID="category-name"
          />
        </Field>

        <Field label="Kind">
          <Segmented
            options={KINDS}
            value={kind}
            onChange={(next) => {
              setKind(next);
              // A parent of the old kind would be invalid; clear rather than
              // let the save fail with a confusing message.
              setParentId(null);
            }}
            testIDPrefix="cat-kind"
          />
        </Field>

        <Field label="Parent">
          <View
            className="rounded-lg bg-surface px-4 py-3 active:opacity-70"
            onTouchEnd={() => setSheetOpen(true)}
            testID="category-parent">
            <Text className={`text-sm ${parent ? 'text-ink' : 'text-muted'}`}>
              {parent?.name ?? 'None (top level)'}
            </Text>
          </View>
          <Text className="mt-1.5 text-xs text-muted">
            Categories are two levels deep, so a sub-category cannot have children of its own.
          </Text>
        </Field>

        <Field label="Colour">
          <ColorPicker value={color} onChange={setColor} />
        </Field>

        <Field label="Icon">
          <IconPicker value={icon} color={color} onChange={setIcon} />
        </Field>

        {error ? (
          <Text className="mb-4 text-sm text-expense" testID="category-error">
            {error}
          </Text>
        ) : null}

        {existing ? (
          <>
            <DangerButton label="Delete category" onPress={onDelete} testID="category-delete" />
            <Text className="mt-3 text-xs text-muted">
              Records keep their money and become uncategorised. Sub-categories move up a level
              rather than being deleted.
            </Text>
          </>
        ) : null}
      </ScrollView>

      <PickerSheet
        visible={sheetOpen}
        title="Parent category"
        options={parentOptions}
        selectedId={parentId ?? NO_PARENT}
        onSelect={(picked) => {
          setParentId(picked === NO_PARENT ? null : picked);
          setSheetOpen(false);
        }}
        onClose={() => setSheetOpen(false)}
        testID="sheet-parent"
      />
    </View>
  );
}
