import Link from 'next/link';
import type { ReactNode } from 'react';

const RELEASES = 'https://github.com/ahmedsaed/Peace/releases/latest';

function Shot({ name, alt }: { name: string; alt: string }) {
  return (
    <div className="phone feature-shot">
      <img src={`/screenshots/${name}.png`} alt={alt} width={540} height={1200} loading="lazy" />
    </div>
  );
}

function Feature({
  eyebrow,
  title,
  optional,
  shot,
  alt,
  flip,
  children,
}: {
  eyebrow: string;
  title: string;
  optional?: string;
  shot: string;
  alt: string;
  flip?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`feature${flip ? ' flip' : ''}`}>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h3>
          {title}
          {optional ? <span className="optional-tag">{optional}</span> : null}
        </h3>
        {children}
      </div>
      <Shot name={shot} alt={alt} />
    </div>
  );
}

export default function Home() {
  return (
    <>
      <div className="wrap">
        <div className="hero">
          <div>
            <h1>
              An expense tracker that <em>keeps its mouth shut.</em>
            </h1>
            <p className="lede">
              Every record you make lives on your phone. No account, no server, no ads, no analytics — and
              nothing reaches the network unless you ask it to.
            </p>
            <div className="ctas">
              <span className="button soon" aria-disabled="true">
                Coming soon to Google Play
              </span>
              <a className="button ghost" href={RELEASES}>
                Download the APK
              </a>
            </div>
            <p className="fineprint">Android only. Free, and free software: the source is on GitHub.</p>
          </div>
          <div className="phone">
            <img
              src="/screenshots/records.png"
              alt="The records list for a month, grouped by day, with expense, income and balance totals in the header"
              width={540}
              height={1200}
            />
          </div>
        </div>
      </div>

      <section id="features">
        <div className="wrap">
          <p className="eyebrow">What it is for</p>
          <h2>Built around the month, and the thing you do fifty times a month.</h2>
          <p className="section-intro">
            Type an amount. Everything else in Peace exists to make that ledger tell the truth afterwards:
            transfers appear once instead of twice, a refund nets against what it reversed, a credit card
            reads as money owed rather than an emptied wallet, and percentages add up to exactly 100.
          </p>

          <Feature
            eyebrow="Recording"
            title="Four taps and a thumb."
            shot="record"
            alt="The add-record screen: account and category pickers, a note field, and the calculator keypad"
          >
            <ul>
              <li>A calculator keypad — type 120 + 35 and save the answer. Digits and operators go on the side you prefer.</li>
              <li>Two-tier categories, so Coffee rolls up into Food everywhere.</li>
              <li>Transfers between your own accounts, written as one pair, counted once.</li>
              <li>Multi-currency, with the rate kept per record — last year’s purchase stays at last year’s rate.</li>
              <li>Credit cards with their limits, foreign-transaction and cash-withdrawal fees.</li>
              <li>Works in split-screen beside your bank’s notification, which is where records get logged.</li>
            </ul>
          </Feature>

          <Feature
            eyebrow="Making sense of it"
            title="Where it went, ranked — and what is left."
            shot="budgets"
            alt="The budgets screen with four categories and progress bars, one of them over budget"
            flip
          >
            <ul>
              <li>Every day netted, with the month’s expense, income and running position in the header.</li>
              <li>A category ring and a ranked breakdown, filterable by tag.</li>
              <li>Budgets per category, suggested from what you actually spend — no blank screen on day one.</li>
              <li>Tags for what categories cannot say: a trip, a renovation, a project.</li>
              <li>Search across notes, categories, accounts and tags, with the total of every match.</li>
              <li>Balance corrections for when the bank disagrees, never counted as spending.</li>
            </ul>
          </Feature>

          <Feature
            eyebrow="Less typing"
            title="Receipts and bank messages, read for you."
            optional="Optional"
            shot="penny-receipt"
            alt="A photographed café receipt turned into a proposed record with Add and Decline buttons"
          >
            <ul>
              <li>Photograph a receipt and have the shop, total and basket read into the form.</li>
              <li>Bank notifications offered as records to approve — never written behind your back.</li>
              <li>Cash out of an ATM is recognised as a transfer, so it is not counted twice.</li>
              <li>
                Off until you add your own Gemini API key. Bank messages are read only from senders you name; the
                list starts empty.
              </li>
            </ul>
          </Feature>

          <Feature
            eyebrow="Penny, the assistant"
            title="Ask in plain words. Get answers from your ledger, never estimates."
            optional="Optional"
            shot="penny-ask"
            alt="Penny comparing two months with a bar chart and a written answer"
            flip
          >
            <ul>
              <li>“How much did fuel cost me in December?” — worked out by the same totals every screen uses.</li>
              <li>Charts on request; tap a bar to see the records inside it. Reports as PDFs.</li>
              <li>Hand it a receipt or an invoice and ask about it, or have it logged with the file attached.</li>
              <li>It can change things too, but every change is a card you approve first, and deletes can be undone.</li>
              <li>Every amount it mentions is cited from your data — hide amounts, and its answers hide too.</li>
            </ul>
          </Feature>

          <Feature
            eyebrow="Keeping it"
            title="Backups you can open without this app."
            shot="actions"
            alt="A long press on a purchase showing its refund and the record actions"
          >
            <ul>
              <li>A backup is a plain zip: the database beside your receipts. Unzip it anywhere and your data is there.</li>
              <li>Restore brings back your records, receipts and settings — and “Undo last restore” brings back what it replaced.</li>
              <li>Optional Google Drive backup, sealed with a passphrase if you choose one.</li>
              <li>CSV export that keeps both sides of every transfer, so per-account balances still add up.</li>
            </ul>
          </Feature>
        </div>
      </section>

      <section>
        <div className="wrap">
          <p className="eyebrow">Also in the drawer</p>
          <h2>The rest of it.</h2>
          <div className="gallery">
            <figure>
              <img src="/screenshots/analysis.png" alt="A donut of spending by category with a ranked list" width={540} height={1200} loading="lazy" />
              <figcaption>
                Analysis<span>Where it went, ranked. The shares add up to exactly 100.</span>
              </figcaption>
            </figure>
            <figure>
              <img src="/screenshots/recurring.png" alt="Recurring payments with their schedules" width={540} height={1200} loading="lazy" />
              <figcaption>
                Recurring<span>Proposed each month for you to approve, edit or skip.</span>
              </figcaption>
            </figure>
            <figure>
              <img src="/screenshots/accounts.png" alt="Accounts with cash, bank and a credit card" width={540} height={1200} loading="lazy" />
              <figcaption>
                Accounts<span>A card is debt, not an empty wallet.</span>
              </figcaption>
            </figure>
            <figure>
              <img src="/screenshots/search.png" alt="Search filtered to one category with a total" width={540} height={1200} loading="lazy" />
              <figcaption>
                Search<span>It totals everything it finds, not just what fits on screen.</span>
              </figcaption>
            </figure>
            <figure>
              <img src="/screenshots/portfolio.png" alt="Portfolio target split and drift" width={540} height={1200} loading="lazy" />
              <figcaption>
                Portfolio<span>Rebalancing that never tells you to sell.</span>
              </figcaption>
            </figure>
            <figure>
              <img src="/screenshots/penny-chart.png" alt="Penny answering with a six-month bar chart" width={540} height={1200} loading="lazy" />
              <figcaption>
                Charts on request<span>Saved as an image or a CSV.</span>
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      <section id="privacy">
        <div className="wrap">
          <p className="eyebrow">Private by default</p>
          <h2>Nothing leaves your phone until you turn something on.</h2>
          <p className="section-intro">
            There is no Peace account and no Peace server. The few things that can talk to the internet are each
            off until you switch them on, and each one is listed on <Link href="/data/">Your data</Link>.
          </p>
          <div className="cards">
            <div className="card">
              <h3>One tap hides every amount</h3>
              <p>The eye in the header masks every figure on every screen, for reading your ledger beside someone.</p>
            </div>
            <div className="card">
              <h3>Your AI key, your requests</h3>
              <p>Receipts, bank messages and Penny use your own Gemini key, straight to Google. We never see them.</p>
            </div>
            <div className="card">
              <h3>Bank alerts, not your inbox</h3>
              <p>Peace reads the notification your messaging app already showed, and only from senders you name.</p>
            </div>
            <div className="card">
              <h3>No tracking of any kind</h3>
              <p>No analytics, no ads, no crash-reporting SDK — in the app, and on this website.</p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <p className="eyebrow">Deliberately not doing</p>
          <h2>What an app refuses to do describes it too.</h2>
          <div className="cards">
            <div className="card">
              <h3>Sync</h3>
              <p>Sync means a server, an account, and a copy of your spending somewhere you do not control.</p>
            </div>
            <div className="card">
              <h3>Budget carry-over</h3>
              <p>A limit that grows when you fail to use it is not a limit. What carries between months is money.</p>
            </div>
            <div className="card">
              <h3>Settings that do nothing</h3>
              <p>Every switch ships with the code that honours it, or it does not ship.</p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
