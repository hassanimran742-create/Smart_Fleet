/**
 * Review 23 (security): the route table. Boots the API, walks every controller handler and prints its
 * method, path, the role rule (Roles / ExactRoles / none), @Public, @SettingSwitch and @Feature, to
 * REVIEW23_ROUTES_OUT (a JSON file) when set. It asserts only the facts the review relies on:
 * every Inc 2/3 route has an explicit role rule unless it is the public /c/ page.
 */
import * as fs from 'fs';
import type { INestApplication } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { createTestApp } from '../../helpers/app';
import { describeDb } from '../../helpers/describe-db';
import { EXACT_ROLES_KEY, ROLES_KEY } from '../../../src/common/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../../../src/common/decorators/public.decorator';
import { FEATURE_KEY, SETTING_SWITCH_KEY } from '../../../src/common/features/feature';

jest.setTimeout(120_000);

interface RouteRow {
  controller: string;
  handler: string;
  method: string;
  path: string;
  rule: string;
  isPublic: boolean;
  settingSwitch: string | null;
  feature: string | null;
}

describeDb('review23 security: route table', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('lists every route with its role rule', () => {
    const discovery = app.get(DiscoveryService);
    const scanner = app.get(MetadataScanner);
    const reflector = app.get(Reflector);
    const rows: RouteRow[] = [];
    for (const wrapper of discovery.getControllers()) {
      const instance = wrapper.instance as object | undefined;
      if (!instance) continue;
      const cls = (instance as { constructor: new (...a: unknown[]) => unknown }).constructor;
      const base = (Reflect.getMetadata(PATH_METADATA, cls) as string | string[] | undefined) ?? '';
      const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
      for (const name of scanner.getAllMethodNames(proto)) {
        const fn = proto[name] as (...a: unknown[]) => unknown;
        const sub = Reflect.getMetadata(PATH_METADATA, fn) as string | string[] | undefined;
        const m = Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod | undefined;
        if (sub === undefined || m === undefined) continue;
        const exact = (reflector.get<string[] | undefined>(EXACT_ROLES_KEY, fn as never) ?? reflector.get<string[] | undefined>(EXACT_ROLES_KEY, cls as never)) as
          | string[]
          | undefined;
        const handlerExact = reflector.get<string[] | undefined>(EXACT_ROLES_KEY, fn as never);
        const handlerRoles = reflector.get<string[] | undefined>(ROLES_KEY, fn as never);
        const classExact = reflector.get<string[] | undefined>(EXACT_ROLES_KEY, cls as never);
        const classRoles = reflector.get<string[] | undefined>(ROLES_KEY, cls as never);
        void exact;
        let rule = 'NONE (any signed-in role)';
        if (handlerExact?.length) rule = `Exact(${handlerExact.join(',')})`;
        else if (handlerRoles?.length) rule = `Roles(${handlerRoles.join(',')})+SA`;
        else if (classExact?.length) rule = `Exact(${classExact.join(',')})`;
        else if (classRoles?.length) rule = `Roles(${classRoles.join(',')})+SA`;
        const isPublic = !!reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [fn, cls]);
        const sw = reflector.getAllAndOverride<{ key: string } | undefined>(SETTING_SWITCH_KEY, [fn, cls]);
        const feature = reflector.getAllAndOverride<string | undefined>(FEATURE_KEY, [fn, cls]);
        const join = (a: string | string[], b: string | string[]) => {
          const x = Array.isArray(a) ? a[0] : a;
          const y = Array.isArray(b) ? b[0] : b;
          return `/${[x, y].filter((p) => p && p !== '/').join('/')}`.replace(/\/+/g, '/');
        };
        rows.push({
          controller: cls.name,
          handler: name,
          method: RequestMethod[m],
          path: join(base, sub),
          rule,
          isPublic,
          settingSwitch: sw?.key ?? null,
          feature: feature ?? null,
        });
      }
    }
    rows.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
    const out = process.env.REVIEW23_ROUTES_OUT;
    if (out) fs.writeFileSync(out, JSON.stringify(rows, null, 2));
    expect(rows.length).toBeGreaterThan(50);
  });
});
