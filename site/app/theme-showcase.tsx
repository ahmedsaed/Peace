'use client';

import { useEffect, useState, type CSSProperties } from 'react';

import data from '@/lib/themes.json';

/**
 * The themes section: the same month in every theme, and the section itself
 * repainted in whichever one is chosen.
 *
 * The colours come from the app's own table (copied in by
 * scripts/copy-assets.mjs), and the phones are real screenshots from the demo
 * flow — so nothing here is a mock-up of what a theme might look like. The
 * screenshots for every theme are stacked and cross-faded rather than swapped,
 * so changing theme never waits on an image.
 */

type ThemeId = keyof typeof data.themes;
type Choice = ThemeId | 'system';

const IDS = Object.keys(data.themes) as ThemeId[];

const BLURB: Record<ThemeId, string> = {
  ledger: 'Warm and dark. The original, and easy on the eyes at night.',
  graphite: 'True black and the most contrast. Kind to OLED batteries.',
  paper: 'Ledger in daylight: warm cream and burnt amber.',
  mist: 'Cool and light, with a blue accent.',
};

/** The tokens shown in the swatch strip, in the order the design system lists them. */
const STRIP = ['ground', 'surface', 'raised', 'ink', 'muted', 'accent', 'income', 'expense', 'transfer'] as const;

function vars(id: ThemeId): CSSProperties {
  const c = data.themes[id].colors as Record<string, string>;
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [`--t-${k}`, v])) as CSSProperties;
}

/** What "Match phone" resolves to on THIS device — the same rule the app uses. */
function useDeviceScheme(): 'dark' | 'light' {
  const [scheme, setScheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const read = () => setScheme(query.matches ? 'light' : 'dark');
    read();
    query.addEventListener('change', read);
    return () => query.removeEventListener('change', read);
  }, []);
  return scheme;
}

export function ThemeShowcase() {
  const [choice, setChoice] = useState<Choice>('ledger');
  const device = useDeviceScheme();
  const active: ThemeId =
    choice === 'system' ? (data.systemPair[device] as ThemeId) : choice;
  const colors = data.themes[active].colors as Record<string, string>;

  return (
    <section id="themes" className="themes" style={vars(active)} data-dark={data.themes[active].dark}>
      <div className="wrap themes-grid">
        <div>
          <p className="eyebrow themes-eyebrow">Appearance</p>
          <h2>One ledger, four lights.</h2>
          <p className="section-intro themes-intro">
            Dark for the evening, light for the bus, true black for an OLED screen — or let Peace follow your phone.
            Only the chrome changes. Your categories keep their colours, and every figure stays where you left it.
          </p>

          <div className="themes-picker" role="radiogroup" aria-label="Theme">
            {IDS.map((id) => (
              <ThemeTile key={id} id={id} selected={choice === id} onSelect={() => setChoice(id)} />
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={choice === 'system'}
              className={`themes-tile themes-tile-system${choice === 'system' ? ' selected' : ''}`}
              onClick={() => setChoice('system')}>
              <span className="themes-dots" aria-hidden="true">
                <span style={{ background: data.themes[data.systemPair.dark as ThemeId].colors.ground }} />
                <span style={{ background: data.themes[data.systemPair.light as ThemeId].colors.ground }} />
              </span>
              <span className="themes-tile-name">Match phone</span>
              <span className="themes-tile-blurb">
                {choice === 'system'
                  ? `Your device is ${device} right now, so this is ${data.themes[active].label}.`
                  : `${data.themes.ledger.label} when your phone is dark, ${data.themes.paper.label} when it is light.`}
              </span>
            </button>
          </div>

          <ul className="themes-strip" aria-label={`${data.themes[active].label} colours`}>
            {STRIP.map((token) => (
              <li key={token}>
                <span className="themes-chip" style={{ background: colors[token] }} />
                <span className="themes-token">{token}</span>
                <code>{colors[token]}</code>
              </li>
            ))}
          </ul>
          <p className="themes-proof">
            Every theme is checked by the app’s own tests: text contrast to WCAG levels on every surface, and income
            kept apart from expense under simulated red–green and blue–yellow colour blindness.
          </p>
        </div>

        <div className="themes-phones" aria-live="polite">
          <Stack id={active} shot="analysis" back />
          <Stack id={active} shot="records" />
        </div>
      </div>
    </section>
  );
}

function ThemeTile({ id, selected, onSelect }: { id: ThemeId; selected: boolean; onSelect: () => void }) {
  const c = data.themes[id].colors;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`themes-tile${selected ? ' selected' : ''}`}
      onClick={onSelect}>
      <span className="themes-swatch" style={{ background: c.ground, borderColor: c.surface }} aria-hidden="true">
        <span style={{ background: c.surface }}>
          <i style={{ background: c.ink }} />
          <i style={{ background: c.expense }} />
          <i style={{ background: c.income }} />
        </span>
        <b style={{ background: c.accent }} />
      </span>
      <span className="themes-tile-name">{data.themes[id].label}</span>
      <span className="themes-tile-blurb">{BLURB[id]}</span>
    </button>
  );
}

/**
 * One phone holding every theme's screenshot of the same screen, only the
 * active one visible. All are in the page from the start, so a click is a
 * fade, not a download.
 */
function Stack({ id, shot, back = false }: { id: ThemeId; shot: 'records' | 'analysis'; back?: boolean }) {
  return (
    <div className={`phone themes-phone${back ? ' themes-phone-back' : ''}`}>
      <div className="themes-frames">
        {IDS.map((theme) => (
          <img
            key={theme}
            src={`/screenshots/theme-${theme}-${shot}.png`}
            alt={
              theme === id
                ? `The ${shot === 'records' ? 'records list' : 'spending breakdown'} in the ${data.themes[theme].label} theme`
                : ''
            }
            aria-hidden={theme !== id}
            width={540}
            height={1200}
            loading={theme === 'ledger' ? 'eager' : 'lazy'}
            className={theme === id ? 'on' : ''}
          />
        ))}
      </div>
    </div>
  );
}
