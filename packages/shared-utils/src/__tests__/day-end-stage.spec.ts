import { deriveDayEndStage } from '../day-end-stage';

const sheet = '2026-10-21T15:00:00.000Z';
const upload = '2026-10-21T16:00:00.000Z';
const later = '2026-10-21T17:00:00.000Z';
const latest = '2026-10-21T18:00:00.000Z';

describe('deriveDayEndStage (API_CONTRACT §1.4, G09-12)', () => {
  it('has no stage but NOT_STARTED without a day row', () => {
    expect(deriveDayEndStage(null)).toBe('NOT_STARTED');
    expect(deriveDayEndStage(undefined)).toBe('NOT_STARTED');
  });

  it('reads APPROVED and SUBMITTED from the status first', () => {
    expect(deriveDayEndStage({ status: 'APPROVED', sentBackAt: latest, uploadedAt: upload })).toBe('APPROVED');
    expect(deriveDayEndStage({ status: 'SUBMITTED', reopenedAt: latest })).toBe('WAITING_FOR_APPROVAL');
  });

  it('is READY when the latest upload is newer than the newest sheet', () => {
    expect(deriveDayEndStage({ status: 'OPEN', sheetSnapshotAt: sheet, uploadedAt: upload })).toBe('READY');
    expect(deriveDayEndStage({ status: 'OPEN', sheetSnapshotAt: new Date(sheet), uploadedAt: new Date(upload) })).toBe('READY');
  });

  it('is NOT_STARTED while there is no upload from the newest sheet', () => {
    expect(deriveDayEndStage({ status: 'OPEN' })).toBe('NOT_STARTED');
    expect(deriveDayEndStage({ status: 'OPEN', sheetSnapshotAt: sheet })).toBe('NOT_STARTED');
    // A new sheet was downloaded after the upload: the upload is from an older sheet.
    expect(deriveDayEndStage({ status: 'OPEN', sheetSnapshotAt: later, uploadedAt: upload })).toBe('NOT_STARTED');
  });

  it('is SENT_BACK after a send-back or reopen with no upload since the later one', () => {
    expect(deriveDayEndStage({ status: 'OPEN', sheetSnapshotAt: sheet, uploadedAt: upload, sentBackAt: later })).toBe('SENT_BACK');
    expect(deriveDayEndStage({ status: 'OPEN', reopenedAt: later })).toBe('SENT_BACK');
    expect(
      deriveDayEndStage({ status: 'OPEN', sheetSnapshotAt: sheet, uploadedAt: later, sentBackAt: upload, reopenedAt: latest }),
    ).toBe('SENT_BACK');
  });

  it('is READY again once the shop uploads after the send-back', () => {
    expect(
      deriveDayEndStage({ status: 'OPEN', sentBackAt: upload, sheetSnapshotAt: later, uploadedAt: latest }),
    ).toBe('READY');
    expect(
      deriveDayEndStage({ status: 'OPEN', sentBackAt: upload, sheetSnapshotAt: latest, uploadedAt: later }),
    ).toBe('NOT_STARTED');
  });
});
