import { useCallback } from 'react';

import { formatMinor, maskFormatted } from '@/lib/money';
import { useSetting } from '@/state/settings';

/**
 * The formatter's shape, for the helpers that are not components.
 *
 * A plain function that builds a sentence out of amounts cannot hold a hook, so
 * it takes this instead of reaching for `formatMinor` — which is the whole
 * point: the type is what lets such a helper stay on the masked path rather
 * than becoming the one place that quietly is not.
 */
export type Money = (
  minor: number,
  currency?: string,
  opts?: { showSign?: boolean; locale?: string }
) => string;

/**
 * THE ONLY WAY MONEY REACHES A SCREEN.
 *
 * `formatMinor` stays pure and knows nothing about who is looking; this is the
 * render boundary that also asks whether amounts are currently masked. Screens
 * call `money(...)` exactly where they used to call `formatMinor(...)`, so the
 * signature is deliberately identical.
 *
 * WHY A CHOKE POINT RATHER THAN A FLAG PER SCREEN. Sixty-odd places render an
 * amount. A masking rule written out at each of them gets missed at one, and
 * the miss is invisible in review and catastrophic in use: the control says
 * amounts are hidden, the user believes it, and a figure is sitting on screen.
 * `no-unmasked-money.test.ts` fails if `formatMinor` is imported anywhere under
 * `src/app` or `src/components`, so a new screen cannot forget — the rule is
 * structural rather than remembered.
 *
 * NOT APPLIED TO EXPORTS, and it cannot be by construction: the CSV writer and
 * the backup deal in raw minor units and never format anything. A mask that
 * could reach a file would be data loss wearing a privacy feature's clothes.
 */
export function useMoney(): Money {
  const hidden = useSetting('hideAmounts');

  return useCallback(
    (minor: number, currency?: string, opts?: { showSign?: boolean; locale?: string }) => {
      const formatted = formatMinor(minor, currency, opts);
      return hidden ? maskFormatted(formatted) : formatted;
    },
    [hidden]
  );
}

/**
 * The same decision for code that is not rendering a figure — a progress bar's
 * width, a chart label, an accessibility string.
 *
 * Geometry is deliberately NOT masked. The category ring and the budget bars
 * are drawn from proportions, and a proportion is not an amount: hiding the
 * figures while leaving the shape is the trade this feature makes, so that a
 * masked screen is still worth looking at. Anything that would put a NUMBER in
 * a label has to go through `useMoney` instead.
 */
export function useAmountsHidden(): boolean {
  return useSetting('hideAmounts');
}
