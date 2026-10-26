/**
 * @jest-environment node
 *
 * The readers against a REAL provider — a photographed receipt, a PDF invoice
 * and a bank message, each through the same `ai/read.ts` the app calls.
 * Skipped unless a key is supplied, and it COSTS MONEY, so it is run on
 * request and never by `npm test` or CI:
 *
 *   PEACE_AI_PROVIDER=deepseek PEACE_AI_KEY_FILE=.toolchain/deepseek-key \
 *     PEACE_AI_MODEL=deepseek-flash npx jest src/ai/live
 *
 * What only a provider can prove: that the schema is one it accepts, that a
 * file reaches it in a shape it reads, and that a real model returns fields
 * the parsers keep. Penny's half is `src/assistant/live.test.ts`.
 */
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

import { buildBankPrompt, BANK_RESPONSE_SCHEMA, parseBankReading } from '../lib/bank-sms';
import { runChecks } from './checks';
import { FLAVORS } from './openai/flavors';
import { isProviderId, type Endpoint } from './providers';
import { readBankMessage, readReceipt } from './read';

const provider = isProviderId(process.env.PEACE_AI_PROVIDER) ? process.env.PEACE_AI_PROVIDER : 'gemini';
const keyFile = process.env.PEACE_AI_KEY_FILE ?? process.env.PEACE_GEMINI_KEY_FILE;
const key = keyFile && fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8').trim() : '';
const model = process.env.PEACE_AI_MODEL ?? 'gemini-flash-latest';
const live = key ? describe : describe.skip;
const readsPdf = provider === 'gemini' || FLAVORS[provider]?.pdf != null;

jest.setTimeout(120_000);

/** jest-expo's `fetch` needs the native runtime; this one goes to the network. */
const nodeFetch = ((url: string, init: RequestInit = {}) =>
  new Promise((resolve, reject) => {
    const request = https.request(
      url,
      { method: init.method ?? 'GET', headers: init.headers as Record<string, string>, signal: init.signal ?? undefined },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () =>
          resolve({
            ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
            status: response.statusCode,
            headers: new Headers(),
            json: async () => JSON.parse(body),
          })
        );
      }
    );
    request.on('error', reject);
    if (init.body) request.write(init.body);
    request.end();
  })) as unknown as typeof fetch;

const endpoint: Endpoint = { provider, apiKey: key, model };
const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, '../assistant/__fixtures__', name)).toString('base64');

live(`readers on ${provider} · ${model}`, () => {
  it('reads the photographed receipt', async () => {
    const reading = await readReceipt(endpoint, fixture('receipt.jpg'), 'image/jpeg', {
      fetchImpl: nodeFetch,
      fallbackCurrency: 'EGP',
    });
    expect(reading.amountMinor).toBe(24080);
    expect(reading.occurredOn).toBe('2026-10-05');
  });

  (readsPdf ? it : it.skip)('reads the PDF invoice', async () => {
    const reading = await readReceipt(endpoint, fixture('invoice.pdf'), 'application/pdf', {
      fetchImpl: nodeFetch,
      fallbackCurrency: 'EGP',
    });
    expect(reading.amountMinor).toBe(70680);
  });

  it('reads a bank message into a record', async () => {
    const raw = await readBankMessage(
      endpoint,
      buildBankPrompt('Your CIB card ending 0042 was charged EGP 450.00 at CARREFOUR MAADI on 13/08.', ['CIB'], '', [
        'Groceries',
        'Transport',
      ]),
      BANK_RESPONSE_SCHEMA,
      { fetchImpl: nodeFetch }
    );
    const reading = parseBankReading(raw, 'EGP');
    expect(reading.amountMinor).toBe(45000);
    expect(reading.direction).toBe('out');
    expect(reading.category).toBe('Groceries');
  });

  /**
   * What the four checks find. Images and audio differ by model, so they are
   * reported rather than asserted; every model a feature can use must at least
   * return structured replies, and Penny's must call tools.
   */
  it('runs the checks a model gets when it is chosen', async () => {
    const results = await runChecks(endpoint, { fetchImpl: nodeFetch });
    console.log(`checks on ${provider} · ${model}`, JSON.stringify(results, null, 1));
    expect(results.json.result).toBe('yes');
    expect(results.tools.result).toBe('yes');
    expect(results.images.result).not.toBe('unknown');
    expect(results.audio.result).not.toBe('unknown');
  });
});
