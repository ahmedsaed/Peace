/**
 * @jest-environment node
 */
import { listAttachments, orphanedFiles, referencedFiles } from '../db/repo/attachments';
import { sessionMessages } from '../db/repo/chat';
import { INLINE_ATTACHMENTS, sessionAttachments, type ChatAttachment } from './attachments';
import { ask, decide, run, toContents, type Deps, type ModelMeta } from './engine';
import type { Content, Part } from './gemini-chat';
import { applyWrite, prepareWrite } from './tools';
import { buildLedger, ctxFor, NOW, type Ledger } from './test-ledger';

const file = (n: number, mimeType = 'image/jpeg'): Omit<ChatAttachment, 'id'> => ({
  fileName: `${String(n).padStart(64, 'a')}.${mimeType === 'application/pdf' ? 'pdf' : 'jpg'}`,
  originalName: mimeType === 'application/pdf' ? `invoice-${n}.pdf` : null,
  mimeType,
  byteSize: 1000 + n,
  sha256: String(n).padStart(64, 'a'),
  width: null,
  height: null,
});

let ledger: Ledger;
beforeEach(() => {
  ledger = buildLedger();
});

const writer = () => ({ db: ledger.db, now: () => NOW });

describe('attaching files to a question', () => {
  it('gives each file a short id from its own row, and keeps the bytes out of the database', () => {
    const row = ask(writer(), 'What is this?', [file(1), file(2, 'application/pdf')]);
    const attached = sessionAttachments([row]);
    expect(attached.map((a) => a.id)).toEqual([`file${row.seq}-1`, `file${row.seq}-2`]);
    expect(JSON.stringify(row.content)).not.toContain('inlineData');
  });

  it('sends the bytes of the newest files and only describes the older ones', () => {
    for (let i = 1; i <= INLINE_ATTACHMENTS + 1; i++) ask(writer(), `receipt ${i}`, [file(i)]);
    const session = sessionMessages(ledger.db, 50);
    const loaded = new Map(sessionAttachments(session).map((a) => [a.fileName, 'BASE64']));
    loaded.delete(sessionAttachments(session)[0].fileName); // what the engine would not load
    const contents = toContents(session, loaded);

    const inline = contents.flatMap((c) => c.parts).filter((p) => p.inlineData);
    expect(inline).toHaveLength(INLINE_ATTACHMENTS);
    const first = contents[0].parts;
    expect(first[0].text).toMatch(/no longer in view/);
    // The question itself always follows its files.
    expect(first.at(-1)!.text).toBe('receipt 1');
  });

  it('introduces every inline file by the id the model must use', () => {
    const row = ask(writer(), '', [file(1)]);
    const [content] = toContents([row], new Map([[file(1).fileName, 'BASE64']]));
    expect(content.parts[0].text).toContain(`"file${row.seq}-1"`);
    expect(content.parts[1]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'BASE64' } });
  });
});

describe('keeping a file with a record', () => {
  it('logs a receipt as a record with the photo attached — one row, the same file', () => {
    const row = ask(writer(), 'log this', [file(1)]);
    const ctx = { ...ctxFor(ledger.db), attachments: sessionAttachments([row]) };
    const args = { type: 'expense', amount: 230, account: 'Cash', category: 'Coffee', attachments: [`file${row.seq}-1`] };

    const prepared = prepareWrite({ name: 'create_record', args }, ctx);
    if (!('preview' in prepared)) throw new Error(prepared.error);
    expect(prepared.preview.lines.find((l) => l.label === 'Attached')?.value).toBe('Photo');

    const { response } = applyWrite({ name: 'create_record', args }, ctx);
    const kept = listAttachments(ledger.db, response.id as string);
    expect(kept.map((a) => a.fileName)).toEqual([file(1).fileName]);
  });

  it('adds a file to an existing record', () => {
    const row = ask(writer(), 'this is the shoes receipt', [file(3, 'application/pdf')]);
    const ctx = { ...ctxFor(ledger.db), attachments: sessionAttachments([row]) };
    applyWrite({ name: 'update_records', args: { ids: [ledger.ids.shoes], add_attachments: [`file${row.seq}-1`] } }, ctx);
    expect(listAttachments(ledger.db, ledger.ids.shoes).map((a) => a.originalName)).toEqual(['invoice-3.pdf']);
  });

  it('refuses an id nobody attached, naming the ones that were', () => {
    const row = ask(writer(), 'log this', [file(1)]);
    const ctx = { ...ctxFor(ledger.db), attachments: sessionAttachments([row]) };
    const outcome = prepareWrite({ name: 'create_record', args: { type: 'expense', amount: 1, account: 'Cash', attachments: ['file999-1'] } }, ctx);
    expect(outcome).toEqual({ error: expect.stringMatching(new RegExp(`No file "file999-1".*file${row.seq}-1`)) });
  });

  it('carries the conversation’s files through the engine to an approved write', async () => {
    const asked = ask(writer(), 'log it', [file(5)]);
    const step: Deps['step'] = async () => ({
      role: 'model',
      parts: [{ functionCall: { name: 'create_record', args: { type: 'expense', amount: 99, account: 'Cash', attachments: [`file${asked.seq}-1`] } } } as Part],
    });
    const deps: Deps = { db: ledger.db, homeCurrency: 'EGP', now: () => NOW, step, loadAttachment: async () => 'BASE64' };
    expect(await run(deps)).toBe('awaiting');
    const model = sessionMessages(ledger.db, 50).find((r) => r.kind === 'model')!;
    const [proposal] = (model.meta as ModelMeta).proposals!;
    expect(proposal.status).toBe('pending');
    decide(deps, model.seq, 0, true);
    const records = ledger.db.query.attachments.findMany().sync();
    expect(records.map((a) => a.fileName)).toEqual([file(5).fileName]);
    void (model.content as Content);
  });
});

describe('the files a conversation refers to', () => {
  it('are not orphans — the launch sweep must not delete a receipt the chat still shows', () => {
    ask(writer(), 'what is this', [file(7)]);
    expect(referencedFiles(ledger.db).has(file(7).fileName)).toBe(true);
    expect(orphanedFiles(ledger.db, [file(7).fileName, 'stray.jpg'])).toEqual(['stray.jpg']);
  });
});
