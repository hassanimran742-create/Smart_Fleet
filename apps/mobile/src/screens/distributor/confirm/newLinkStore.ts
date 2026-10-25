import { create } from 'zustand';

/**
 * [Inc 2] Orders whose customer number was just fixed (S15b): Edit customer answered
 * `confirmationNeedsNewLink: true`, so the order's card says "Number changed. Make a new link." and,
 * once, opens "Make a new link?" by itself when the order shows again. Kept for this app run only: the
 * card also works it out from the order's current number (confirmModel `numberChangedSinceLink`).
 */
interface NewLinkState {
  /** orderId → `ask`: open the "Make a new link?" sheet when the order is next on screen. */
  orders: Readonly<Record<string, { ask: boolean }>>;
  need: (orderId: string) => void;
  asked: (orderId: string) => void;
  done: (orderId: string) => void;
}

export const useNewLinkStore = create<NewLinkState>((set) => ({
  orders: {},
  need: (orderId) => set((state) => ({ orders: { ...state.orders, [orderId]: { ask: true } } })),
  asked: (orderId) =>
    set((state) => (state.orders[orderId] ? { orders: { ...state.orders, [orderId]: { ask: false } } } : state)),
  done: (orderId) =>
    set((state) => {
      if (!state.orders[orderId]) return state;
      const orders = { ...state.orders };
      delete orders[orderId];
      return { orders };
    }),
}));
