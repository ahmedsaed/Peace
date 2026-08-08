import { create } from 'zustand';

import type { Transaction } from '@/db/schema';

/**
 * A pending undo, held between screens.
 *
 * Deleting happens on the record screen, but the offer to undo has to appear on
 * the list you land back on — so it cannot live in either screen's state.
 *
 * The deleted ROWS are held here rather than a soft-delete flag on the table.
 * That keeps the schema honest (a deleted record is gone, not hiding behind a
 * filter every future query would have to remember) at the cost of the undo
 * lasting only as long as the app stays open, which is all an undo should
 * promise anyway.
 */
export type PendingUndo = {
  /** The rows to put back. Both legs, for a transfer. */
  rows: Transaction[];
  message: string;
  /** Distinguishes one offer from the next, so a stale timer cannot cancel a new one. */
  token: number;
};

type UndoStore = {
  pending: PendingUndo | null;
  offer: (rows: Transaction[], message: string) => void;
  clear: () => void;
};

export const useUndoStore = create<UndoStore>((set) => ({
  pending: null,
  offer: (rows, message) => set({ pending: { rows, message, token: Date.now() } }),
  clear: () => set({ pending: null }),
}));
