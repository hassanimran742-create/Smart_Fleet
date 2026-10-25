/**
 * REV23 robustness-jobs-08: the pilot setup CLI in the image. A labels file that can't be written after the
 * transaction committed used to exit 1, which API_CONTRACT §10.5 defines as "refused or failed (nothing
 * written)": an operator would think nothing happened and run it again. It now exits 3 ("done, but the
 * labels file could not be saved"), with the labels printed. And a file the image doesn't have is refused
 * with the way to give it one (a mounted folder and a full path).
 */
import * as path from 'path';
import { EXIT_LABELS_NOT_SAVED } from '../../../src/modules/pilot-setup/cli/pilot-setup';
import { getTestPrisma, resetDb } from '../../helpers/db';
import { describeDb } from '../../helpers/describe-db';
import { removeScratchDir, runSetup, SAMPLE_FILE, scratchDir } from '../../inc3/setup/support';

jest.setTimeout(240_000);

// The module object itself (a namespace import wraps it in getters jest can't replace); the CLI calls
// `fs.writeFileSync` on this same object.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs') as typeof import('fs');

describeDb('REV23 robustness-jobs-08 the pilot setup CLI tells a committed run from a refused one', () => {
  const dir = scratchDir('rev23-labels');

  afterAll(() => removeScratchDir(dir));

  it('REV23 robustness-jobs-08 a run that committed but could not save its labels exits 3 and prints them', async () => {
    await resetDb();
    const labelsFile = path.join(dir, 'labels.csv');
    const realWrite = fs.writeFileSync;
    const spy = jest.spyOn(fs, 'writeFileSync').mockImplementation(((file: import('fs').PathOrFileDescriptor, ...rest: unknown[]) => {
      if (String(file) === labelsFile) throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      return (realWrite as (...args: unknown[]) => void).call(fs, file, ...rest);
    }) as typeof fs.writeFileSync);
    let run: Awaited<ReturnType<typeof runSetup>>;
    try {
      run = await runSetup(['--file', SAMPLE_FILE, '--test', '--labels', labelsFile]);
    } finally {
      spy.mockRestore();
    }
    expect(EXIT_LABELS_NOT_SAVED).toBe(3);
    expect(run.code).toBe(EXIT_LABELS_NOT_SAVED);
    expect(run.text).toContain('The cylinders are registered, but the labels file could not be written');
    // The labels are on the screen instead, and the data is there: it committed.
    expect(run.lines.some((line) => line.startsWith('AG-C0001,'))).toBe(true);
    expect(await getTestPrisma().cylinder.count()).toBeGreaterThan(0);
    expect(fs.existsSync(labelsFile)).toBe(false);
  });

  it('REV23 robustness-jobs-08 a setup file the image does not have is refused with how to mount one', async () => {
    const run = await runSetup(['--file', 'pilot/not-in-the-image.json', '--test', '--dry-run']);
    expect(run.code).toBe(1);
    expect(run.text).toContain("Refused: can't find pilot/not-in-the-image.json");
    expect(run.text).toContain('--file /pilot/<name>.json');
    expect(run.text).toContain('Nothing was written.');
  });
});
