import { readFileSync } from 'fs';
import { join } from 'path';

import { channels, cssVariables, SYSTEM_PAIR, THEMES, TOKENS } from '../constants/themes';
import { SETTING_DEFAULTS } from './settings';
import { describeTheme, resolveTheme, THEME_IDS, themeColors, type ThemeColors } from './theme';

/**
 * Every theme is CHECKED, not eyeballed.
 *
 * A theme is eleven colours, and the ways one goes wrong are invisible on the
 * screen it was designed on: muted text that reads fine on the ground and
 * vanishes in a search field, an accent legible as a button and illegible as
 * a link, an income green and an expense red that a colour-blind person sees
 * as the same olive. So the rules are numbers, and a new theme — or a nudge to
 * an old one — has to pass them.
 */

// --- WCAG 2 contrast -------------------------------------------------------

function linear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => linear(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// --- Colour-blindness simulation -------------------------------------------
//
// Machado, Oliveira & Fernandes (2009), full severity, applied in linear RGB.
// Distances are CIE76 ΔE in Lab: about 2 is barely noticeable, and anything
// over 20 is plainly a different colour.

const DEFICIENCIES = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
} as const;

type Matrix = (typeof DEFICIENCIES)[keyof typeof DEFICIENCIES];

function simulate(hex: string, m: Matrix | null): [number, number, number] {
  const c = rgb(hex);
  if (!m) return c;
  return m.map((row) => Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2]))) as [
    number,
    number,
    number,
  ];
}

function lab([r, g, b]: [number, number, number]): [number, number, number] {
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function deltaE(a: string, b: string, m: Matrix | null): number {
  const [p, q] = [lab(simulate(a, m)), lab(simulate(b, m))];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

// ---------------------------------------------------------------------------

// Pairs that knowingly miss the bar, each with the floor it must still clear,
// so a waiver is a decision written down and not a way to stop looking.
//
// Ledger keeps the salmon red it shipped with. Any red that a deuteranope can
// tell from its yellow-green income turns pink, and the owner chose the red:
// the +/- sign still carries the meaning, and Graphite, Paper and Mist all
// clear 20 for anybody who needs the colour to do it.
const WAIVED: Record<string, number> = {
  'ledger/deuteranopia': 8,
};

const themes = THEME_IDS.map((id) => [id, themeColors(id)] as const);

describe.each(themes)('the %s theme', (_id, c: ThemeColors) => {
  it('defines every token as a six-digit hex', () => {
    for (const token of TOKENS) expect(c[token]).toMatch(/^#[0-9A-F]{6}$/);
  });

  // 7:1 is WCAG AAA for body text, which every theme clears with room to
  // spare; the floor is there to catch a mistake, not to grade a design.
  it.each(['ground', 'surface', 'raised'] as const)('keeps ink readable on %s', (bg) => {
    expect(contrast(c.ink, c[bg])).toBeGreaterThanOrEqual(7);
  });

  // Muted is captions, hints and placeholders — and placeholders sit in
  // inputs, which are `raised`. That is the pair that fails first.
  it.each(['ground', 'surface', 'raised'] as const)('keeps muted text readable on %s', (bg) => {
    expect(contrast(c.muted, c[bg])).toBeGreaterThanOrEqual(4.5);
  });

  // The accent is text too — links, the active tab's label, "Undo".
  it.each(['ground', 'surface'] as const)('keeps the accent readable as text on %s', (bg) => {
    expect(contrast(c.accent, c[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps what sits on the accent readable', () => {
    expect(contrast(c['accent-ink'], c.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['income', 'expense', 'transfer'] as const)('keeps %s amounts readable', (money) => {
    for (const bg of ['ground', 'surface', 'raised'] as const) {
      expect(contrast(c[money], c[bg])).toBeGreaterThanOrEqual(4.5);
    }
  });

  // Rule 1 of the design system: colour is never the ONLY signal for money
  // direction — a sign always goes with it. But the colour should still help
  // the one person in twelve who cannot tell a red from a green.
  it.each([null, ...Object.keys(DEFICIENCIES)] as const)(
    'tells income from expense under %s',
    (deficiency) => {
      const m = deficiency ? DEFICIENCIES[deficiency as keyof typeof DEFICIENCIES] : null;
      const floor = WAIVED[`${_id}/${deficiency}`] ?? 20;
      expect(deltaE(c.income, c.expense, m)).toBeGreaterThanOrEqual(floor);
    }
  );

  // Transfer is a third thing and must not read as either. Its bar is lower:
  // a transfer row also carries its own icon and never a +/- of its own.
  it.each([null, ...Object.keys(DEFICIENCIES)] as const)(
    'tells transfer from income and expense under %s',
    (deficiency) => {
      const m = deficiency ? DEFICIENCIES[deficiency as keyof typeof DEFICIENCIES] : null;
      expect(deltaE(c.transfer, c.income, m)).toBeGreaterThanOrEqual(12);
      expect(deltaE(c.transfer, c.expense, m)).toBeGreaterThanOrEqual(12);
    }
  );

  // A light theme inverts the surface order: cards are the lightest thing,
  // and `raised` — inputs, chips, a pressed row — is a step DARKER than the
  // card it sits on. Either way it must be visibly different from it.
  it('separates raised from surface', () => {
    expect(deltaE(c.raised, c.surface, null)).toBeGreaterThanOrEqual(5);
  });
});

describe('the contrast helper', () => {
  // The checks above are only as good as this function.
  it('measures black on white at 21:1 and a colour on itself at 1:1', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#E3A33C', '#E3A33C')).toBe(1);
  });

  it('sees red and green converge under deuteranopia', () => {
    expect(deltaE('#CC3333', '#33AA33', null)).toBeGreaterThan(
      2 * deltaE('#CC3333', '#33AA33', DEFICIENCIES.deuteranopia)
    );
  });
});

describe('dark and light', () => {
  it('marks each theme by what it is, which the status bar follows', () => {
    for (const id of THEME_IDS) {
      const c = themeColors(id);
      expect(THEMES[id].dark).toBe(luminance(rgb(c.ground)) < luminance(rgb(c.ink)));
    }
  });

  it('pairs a dark theme with a light one for "Match phone"', () => {
    expect(THEMES[SYSTEM_PAIR.dark as keyof typeof THEMES].dark).toBe(true);
    expect(THEMES[SYSTEM_PAIR.light as keyof typeof THEMES].dark).toBe(false);
  });
});

describe('the setting', () => {
  // A ledger from before themes has no row, and reads the default. Somebody
  // who has used the dark app every evening must not wake up to a cream one —
  // only a FIRST launch follows the phone (first-run.test.ts).
  it('is Ledger for an install that never chose', () => {
    expect(resolveTheme(SETTING_DEFAULTS.theme, 'light')).toBe('ledger');
  });
});

describe('resolveTheme', () => {
  it('uses the theme chosen, whatever the phone says', () => {
    expect(resolveTheme('paper', 'dark')).toBe('paper');
    expect(resolveTheme('graphite', 'light')).toBe('graphite');
  });

  it('follows the phone for "system"', () => {
    expect(resolveTheme('system', 'light')).toBe('paper');
    expect(resolveTheme('system', 'dark')).toBe('ledger');
  });

  // A phone that reports nothing has not asked for light, and Ledger is what
  // Peace looked like before anybody could choose.
  it('falls back to dark when the phone does not say', () => {
    expect(resolveTheme('system', null)).toBe('ledger');
  });

  // A backup from a newer build may name a theme this one has never heard of.
  it('reads a theme it does not know as Ledger', () => {
    expect(resolveTheme('sepia', 'light')).toBe('ledger');
    expect(resolveTheme('', 'light')).toBe('ledger');
    expect(resolveTheme('toString', 'light')).toBe('ledger');
  });

  it('says what "system" is showing right now', () => {
    expect(describeTheme('system', 'light')).toBe('Match phone · Paper now');
    expect(describeTheme('mist', 'dark')).toBe('Mist');
  });
});

describe('the CSS variables', () => {
  it('are bare channels, which is what <alpha-value> needs', () => {
    expect(channels('#17140F')).toBe('23 20 15');
    expect(cssVariables(themeColors('ledger'))['--color-accent-ink']).toBe('23 20 15');
  });

  // The `:root` block in tailwind.config.js is what draws before the theme is
  // known. It must be Ledger, which is also what the database gate's spinner
  // and the status bar above it assume.
  it('default to Ledger before any theme is applied', () => {
    const config = readFileSync(join(__dirname, '..', '..', 'tailwind.config.js'), 'utf8');
    expect(config).toContain('cssVariables(THEMES.ledger.colors)');
  });
});

// The splash is drawn by Android before any of this code runs, from the colours
// app.config.js hands the splash plugin: one for `values/`, one for
// `values-night/`. They must be the grounds of the pair "Match phone" resolves
// to, or the first frame of the app is a different colour from the splash it
// fades out of.
describe('the splash', () => {
  it('opens on the ground of the light and the dark theme of the system pair', () => {
    const { expo } = require('../../app.json');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const config = require('../../app.config.js')({ config: expo });
    const splash = config.plugins.find(
      (p: unknown) => Array.isArray(p) && p[0] === 'expo-splash-screen',
    )[1];
    expect(splash.backgroundColor).toBe(THEMES[SYSTEM_PAIR.light as keyof typeof THEMES].colors.ground);
    expect(splash.dark.backgroundColor).toBe(THEMES[SYSTEM_PAIR.dark as keyof typeof THEMES].colors.ground);
    expect(splash.image).toBe('./assets/images/splash-icon.png');
  });
});
