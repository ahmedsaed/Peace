import { COMMENT_GAP, noteWithReading } from './note';

describe('noteWithReading', () => {
  const reading = 'Carrefour\n\n2x milk 45.00\nbread 12.50';

  describe('when nothing has been typed', () => {
    it('leaves room above for a comment', () => {
      const note = noteWithReading('', reading, { leaveRoom: true });

      expect(note).toBe(`${COMMENT_GAP}${reading}`);
      // The point of the gap: there are empty lines to tap into, and the
      // reading still starts on its own line.
      expect(note.split('\n')[0]).toBe('');
      expect(note.trimStart()).toBe(reading);
    });

    it('leaves no room in split-screen, where the field is one line tall', () => {
      // Blank lines in a 44px single-line input push the text out of view, so
      // the field reads as empty at the moment it has just been filled.
      expect(noteWithReading('', reading, { leaveRoom: false })).toBe(reading);
      expect(noteWithReading('', reading)).toBe(reading);
    });

    it('treats a note holding only whitespace as empty', () => {
      expect(noteWithReading('   \n  ', reading, { leaveRoom: true })).toBe(
        `${COMMENT_GAP}${reading}`
      );
    });
  });

  describe('when something has been typed', () => {
    // The regression this exists for: setNote(filled) replaced the note, so a
    // receipt photographed after typing threw the typing away.
    it('keeps what was typed and puts the reading underneath', () => {
      const note = noteWithReading('lunch with Sara', reading);

      expect(note).toBe(`lunch with Sara${COMMENT_GAP}${reading}`);
      expect(note).toContain('lunch with Sara');
      expect(note.startsWith('lunch with Sara')).toBe(true);
    });

    it('does not add a gap above text the user already put first', () => {
      // They have already written their comment at the top; room for another
      // one above it is just an empty line they have to delete.
      expect(noteWithReading('lunch with Sara', reading, { leaveRoom: true })).toBe(
        `lunch with Sara${COMMENT_GAP}${reading}`
      );
    });

    it('does not pile up blank lines when the note ends in whitespace', () => {
      expect(noteWithReading('lunch with Sara\n\n\n', reading)).toBe(
        `lunch with Sara${COMMENT_GAP}${reading}`
      );
    });

    it('does not stack a second copy when the same receipt is read twice', () => {
      // Reading again is what someone does when the first answer looked wrong.
      const once = noteWithReading('lunch with Sara', reading);
      expect(noteWithReading(once, reading)).toBe(once);
    });
  });

  describe('when the reading found nothing', () => {
    // The failure path has to be the quietest one: it must not clear a note and
    // must not leave a gap behind in it either.
    it.each(['', '   ', '\n\n'])('leaves the note exactly as it was (%j)', (empty) => {
      expect(noteWithReading('lunch with Sara', empty)).toBe('lunch with Sara');
      expect(noteWithReading('', empty, { leaveRoom: true })).toBe('');
    });
  });

  // Whatever this returns is trimmed by every save path, so an untouched gap
  // can never reach the ledger.
  it('survives the trim that every save applies', () => {
    expect(noteWithReading('', reading, { leaveRoom: true }).trim()).toBe(reading);
    expect(noteWithReading('lunch with Sara', reading).trim()).toBe(
      `lunch with Sara${COMMENT_GAP}${reading}`
    );
  });
});
