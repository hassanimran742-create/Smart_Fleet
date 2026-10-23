/**
 * A small typed face over supertest (the repo has no @types/supertest, and the suites add no
 * dependencies). Every call returns supertest's own chainable, awaitable request.
 *
 *   const api = http(app);
 *   const res = await api.get('/api/v1/app/config').set('X-App-Variant', 'driver').expect(200);
 */
import type { INestApplication } from '@nestjs/common';

export interface TestResponse {
  status: number;
  // The JSON body of a test response is whatever the route sent.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  text: string;
  headers: Record<string, string>;
}

export interface TestRequest extends PromiseLike<TestResponse> {
  set(field: string, value: string): TestRequest;
  set(fields: Record<string, string>): TestRequest;
  send(body?: unknown): TestRequest;
  query(params: Record<string, unknown>): TestRequest;
  field(name: string, value: string): TestRequest;
  attach(field: string, file: Buffer, options?: { filename?: string; contentType?: string }): TestRequest;
  expect(status: number): TestRequest;
}

export interface TestClient {
  get(url: string): TestRequest;
  post(url: string): TestRequest;
  put(url: string): TestRequest;
  patch(url: string): TestRequest;
  delete(url: string): TestRequest;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const supertest = require('supertest') as (server: unknown) => TestClient;

/** Requests against the app's HTTP server. */
export function http(app: INestApplication): TestClient {
  return supertest(app.getHttpServer());
}
