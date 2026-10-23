/**
 * UXQ-011: every on-screen string comes from an i18n key, and a missing key fails the typecheck
 * (ADR-18, README rule 4, UX_MOBILE §2.2, §3.3, §6, UX_ADMIN §1.6, §2.11, §2.12).
 *
 * - The typecheck probes compile a virtual file inside each app with the app's own tsconfig and typed
 *   resources (i18n/types.d.ts): a made-up key must fail, a real one must pass. Nothing is written into
 *   the apps.
 * - The static scan applies the rules in test/helpers/ui-rules.ts. The foundation's files (the design
 *   systems, sign-in screens and shells) must pass now; the whole of apps/mobile/src and
 *   apps/admin-web/src/features (legacy/ excluded until touched, UX_ADMIN §2.11) passes once the UI
 *   lanes have replaced the old screens.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { APPS_DIR, describeHits, listSources, scanFile, type ScanOptions } from '../helpers/ui-rules';

const MOBILE = path.join(APPS_DIR, 'mobile');
const ADMIN = path.join(APPS_DIR, 'admin-web');

/** Type-checks `code` as if it were `<app>/src/__uxq011_probe__.tsx`, returning its own diagnostics. */
function probe(appDir: string, code: string): string[] {
  const configPath = path.join(appDir, 'tsconfig.json');
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    },
  });
  if (!parsed) throw new Error(`cannot read ${configPath}`);
  const probePath = path.join(appDir, 'src', '__uxq011_probe__.tsx').split(path.sep).join('/');
  const host = ts.createCompilerHost(parsed.options, true);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (name) => name.split(path.sep).join('/') === probePath || fileExists(name);
  host.readFile = (name) => (name.split(path.sep).join('/') === probePath ? code : readFile(name));
  host.getSourceFile = (name, version, onError, create) =>
    name.split(path.sep).join('/') === probePath
      ? ts.createSourceFile(name, code, version, true, ts.ScriptKind.TSX)
      : getSourceFile(name, version, onError, create);
  const typeFiles = parsed.fileNames.filter((file) => file.endsWith('.d.ts'));
  const program = ts.createProgram({ rootNames: [probePath, ...typeFiles], options: { ...parsed.options, noEmit: true }, host });
  const source = program.getSourceFile(probePath);
  if (!source) throw new Error('probe not loaded');
  return [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)].map((d) =>
    ts.flattenDiagnosticMessageText(d.messageText, '\n'),
  );
}

describe('UXQ-011 Every on-screen string comes from an i18n key, and a missing key fails the typecheck', () => {
  it('UXQ-011 the shop and driver app typecheck fails on a missing key and passes on a real one', () => {
    const missing = probe(
      MOBILE,
      "import { useTranslation } from 'react-i18next';\nexport function Probe(): string {\n  const { t } = useTranslation();\n  return t('home.notARealKey');\n}\n",
    );
    expect(missing.join('\n')).toMatch(/home\.notARealKey/);
    const real = probe(
      MOBILE,
      "import { useTranslation } from 'react-i18next';\nexport function Probe(): string {\n  const { t } = useTranslation();\n  return t('common.actions.retry');\n}\n",
    );
    expect(real).toEqual([]);
  }, 120_000);

  it('UXQ-011 the website typecheck fails on a missing key and passes on a real one', () => {
    const missing = probe(
      ADMIN,
      "import { useTranslation } from 'react-i18next';\nexport function Probe(): string {\n  const { t } = useTranslation('today');\n  return t('today:notARealKey');\n}\n",
    );
    expect(missing.join('\n')).toMatch(/notARealKey/);
    const real = probe(
      ADMIN,
      "import { useTranslation } from 'react-i18next';\nexport function Probe(): string {\n  const { t } = useTranslation('common');\n  return t('unknownStatus');\n}\n",
    );
    expect(real).toEqual([]);
  }, 120_000);

  const scan = (files: string[], options: (file: string) => ScanOptions) => describeHits(files.flatMap((file) => scanFile(file, options(file))));
  const code = (file: string): ScanOptions => ({ jsx: file.endsWith('.tsx'), allowHex: /[\\/](tokens\.ts|theme[\\/])/.test(file) });

  it('UXQ-011 the foundation files have no literal text, native alerts, stray hex colours, "Rs." or "On hold"', () => {
    const mobile = path.join(MOBILE, 'src');
    const admin = path.join(ADMIN, 'src');
    const files = [
      ...listSources(path.join(mobile, 'ui'), ['scan']),
      ...listSources(path.join(mobile, 'screens', 'auth')),
      path.join(mobile, 'navigation', 'RootNavigator.tsx'),
      path.join(mobile, 'components', 'ui.tsx'),
      ...listSources(path.join(admin, 'ui')),
      ...listSources(path.join(admin, 'app')),
    ];
    expect(files.length).toBeGreaterThan(20);
    expect(scan(files, code)).toEqual([]);
  });

  it('UXQ-011 English copy never shows a raw enum value, "Rs." or "On hold"', () => {
    const resources = [
      ...listSources(path.join(MOBILE, 'src', 'i18n', 'en')),
      ...listSources(path.join(ADMIN, 'src', 'i18n', 'en')),
    ].filter((file) => fs.readFileSync(file, 'utf8').length > 0);
    expect(scan(resources, () => ({ copy: true }))).toEqual([]);
  });

  it(
    'UXQ-011 the whole shop and driver app and every website page pass the static UI scan',
    () => {
      // screens/client is the retired customer login (ADR-03): no navigator mounts it.
      const files = [
        ...listSources(path.join(MOBILE, 'src')).filter((file) => !/[\\/]screens[\\/]client[\\/]/.test(file)),
        ...listSources(path.join(ADMIN, 'src', 'features')),
      ];
      expect(scan(files, code)).toEqual([]);
    },
  );
});
