import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { lastValueFrom, of } from 'rxjs';
import {
  canActOnTrip,
  canSeeClient,
  canSeeCylinder,
  canSeeOrder,
  canSeePayment,
  canSeeRefill,
} from '../../src/common/auth/policies';
import { ExactRoles, Roles } from '../../src/common/decorators/roles.decorator';
import { AppError } from '../../src/common/errors/app-error';
import { Feature, FeatureGuard, FeatureListInterceptor } from '../../src/common/features/feature';
import { RolesGuard } from '../../src/common/guards/roles.guard';
import type { SettingsService } from '../../src/modules/settings/settings.service';

@Roles(UserRole.DISTRIBUTOR)
class OrdersLikeController {
  cancel() {}

  @ExactRoles(UserRole.DISTRIBUTOR)
  place() {}

  @Roles(UserRole.DRIVER)
  fail() {}
}

@ExactRoles(UserRole.SUPER_ADMIN)
class OfficeController {
  settings() {}
}

class OpenController {
  me() {}
}

function context(
  controller: new () => object,
  method: string,
  req: Record<string, unknown>,
  res: Record<string, unknown> = {},
): ExecutionContext {
  return {
    getType: () => 'http',
    getClass: () => controller,
    getHandler: () => (controller.prototype as Record<string, unknown>)[method],
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
}

function codeOf(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof AppError ? error.code : 'not-an-app-error';
  }
}

describe('RolesGuard with @Roles and @ExactRoles (API_CONTRACT §3.1)', () => {
  const guard = new RolesGuard(new Reflector());
  const as = (role: string) => ({ user: { userId: 'u', role } });

  it('lets SUPER_ADMIN through @Roles routes', () => {
    expect(guard.canActivate(context(OrdersLikeController, 'cancel', as('SUPER_ADMIN')))).toBe(true);
    expect(guard.canActivate(context(OrdersLikeController, 'cancel', as('DISTRIBUTOR')))).toBe(true);
  });

  it('turns off the SUPER_ADMIN bypass on @ExactRoles routes', () => {
    expect(codeOf(() => guard.canActivate(context(OrdersLikeController, 'place', as('SUPER_ADMIN'))))).toBe('PERMISSION_DENIED');
    expect(guard.canActivate(context(OrdersLikeController, 'place', as('DISTRIBUTOR')))).toBe(true);
  });

  it("lets a handler's rule override the class's", () => {
    expect(guard.canActivate(context(OrdersLikeController, 'fail', as('DRIVER')))).toBe(true);
    expect(codeOf(() => guard.canActivate(context(OrdersLikeController, 'fail', as('DISTRIBUTOR'))))).toBe('PERMISSION_DENIED');
  });

  it('keeps office-exact routes to SUPER_ADMIN only', () => {
    expect(guard.canActivate(context(OfficeController, 'settings', as('SUPER_ADMIN')))).toBe(true);
    expect(codeOf(() => guard.canActivate(context(OfficeController, 'settings', as('ADMIN'))))).toBe('PERMISSION_DENIED');
  });

  it('allows routes without a rule and needs a user where there is one', () => {
    expect(guard.canActivate(context(OpenController, 'me', {}))).toBe(true);
    expect(codeOf(() => guard.canActivate(context(OfficeController, 'settings', {})))).toBe('AUTH_TOKEN_INVALID');
  });
});

describe('ownership policies return 404 (API_CONTRACT §3.2)', () => {
  const office = { role: 'SUPER_ADMIN' };
  const shop = { role: 'DISTRIBUTOR', distributorId: 'd-1' };
  const otherShop = { role: 'DISTRIBUTOR', distributorId: 'd-2' };
  const driver = { role: 'DRIVER', driverId: 'dr-1' };
  const lockedAdmin = { role: 'ADMIN' };
  const order = { id: 'o-1', distributorId: 'd-1', trip: { driverId: 'dr-1' } };

  it('canSeeOrder: the office, the owner, the trip driver', () => {
    expect(canSeeOrder(office, order)).toBe(order);
    expect(canSeeOrder(shop, order)).toBe(order);
    expect(canSeeOrder(driver, order)).toBe(order);
    expect(codeOf(() => canSeeOrder(otherShop, order))).toBe('NOT_FOUND');
    expect(codeOf(() => canSeeOrder({ role: 'DRIVER', driverId: 'dr-2' }, order))).toBe('NOT_FOUND');
    expect(codeOf(() => canSeeOrder(lockedAdmin, order))).toBe('NOT_FOUND');
    expect(codeOf(() => canSeeOrder(office, null))).toBe('NOT_FOUND');
  });

  it('never matches a missing id to a missing id', () => {
    const orphan = { distributorId: undefined as unknown as string, trip: { driverId: null } };
    expect(codeOf(() => canSeeOrder({ role: 'DISTRIBUTOR' }, orphan))).toBe('NOT_FOUND');
    expect(codeOf(() => canSeeOrder({ role: 'DRIVER' }, orphan))).toBe('NOT_FOUND');
  });

  it('canActOnTrip: the trip driver only, not even the office', () => {
    expect(canActOnTrip(driver, { driverId: 'dr-1' })).toEqual({ driverId: 'dr-1' });
    expect(codeOf(() => canActOnTrip(office, { driverId: 'dr-1' }))).toBe('NOT_FOUND');
  });

  it('canSeePayment and canSeeCylinder: the office and the owner', () => {
    expect(canSeePayment(shop, { distributorId: 'd-1' })).toBeTruthy();
    expect(canSeeCylinder(office, { distributorId: 'd-1' })).toBeTruthy();
    expect(codeOf(() => canSeePayment(otherShop, { distributorId: 'd-1' }))).toBe('NOT_FOUND');
    expect(codeOf(() => canSeeCylinder(driver, { distributorId: 'd-1' }))).toBe('NOT_FOUND');
  });

  it('canSeeRefill: the office, the owner, the assigned driver', () => {
    const refill = { distributorId: 'd-1', assignedDriverId: 'dr-1' };
    expect(canSeeRefill(driver, refill)).toBe(refill);
    expect(codeOf(() => canSeeRefill({ role: 'DRIVER', driverId: 'dr-9' }, refill))).toBe('NOT_FOUND');
  });

  it('canSeeClient: CLIENT_NOT_FOUND, and the office may only read', () => {
    const client = { distributorId: 'd-1' };
    expect(canSeeClient(office, client)).toBe(client);
    expect(codeOf(() => canSeeClient(office, client, { access: 'write' }))).toBe('CLIENT_NOT_FOUND');
    expect(canSeeClient(shop, client, { access: 'write' })).toBe(client);
    expect(codeOf(() => canSeeClient(otherShop, client))).toBe('CLIENT_NOT_FOUND');
  });
});

@Feature('transfers')
class TransfersLikeController {
  mine() {}
  create() {}
}

describe('@Feature switches (API_CONTRACT §3.4)', () => {
  function settings(on: boolean): SettingsService {
    return { get: jest.fn(async () => on) } as unknown as SettingsService;
  }

  it('refuses writes with 403 FEATURE_DISABLED and X-Feature-Disabled when the module is off', async () => {
    const guard = new FeatureGuard(new Reflector(), settings(false));
    const headers: Record<string, string> = {};
    const res = { setHeader: (name: string, value: string) => (headers[name] = value) };
    await expect(guard.canActivate(context(TransfersLikeController, 'create', { method: 'POST' }, res))).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    });
    expect(headers['X-Feature-Disabled']).toBe('transfers');
  });

  it('answers reads with [] and X-Feature-Disabled, without calling the handler', async () => {
    const guard = new FeatureGuard(new Reflector(), settings(false));
    const req: Record<string, unknown> = { method: 'GET' };
    const headers: Record<string, string> = {};
    const res = { setHeader: (name: string, value: string) => (headers[name] = value) };
    const ctx = context(TransfersLikeController, 'mine', req, res);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    const handle = jest.fn(() => of(['real rows']));
    const body = await lastValueFrom(new FeatureListInterceptor().intercept(ctx, { handle } as CallHandler));
    expect(body).toEqual([]);
    expect(headers['X-Feature-Disabled']).toBe('transfers');
    expect(handle).not.toHaveBeenCalled();
  });

  it('runs the route normally when the module is on', async () => {
    const settingsOn = settings(true);
    const guard = new FeatureGuard(new Reflector(), settingsOn);
    const ctx = context(TransfersLikeController, 'create', { method: 'POST' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(settingsOn.get).toHaveBeenCalledWith('features.transfers');
    const body = await lastValueFrom(new FeatureListInterceptor().intercept(ctx, { handle: () => of('created') }));
    expect(body).toBe('created');
  });
});
