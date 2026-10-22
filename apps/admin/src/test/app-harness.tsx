// The pages' render harness (B14a's helpers, shared since T071). A page is rendered through the App,
// its router and its guard, with a fake client whose procedures are the case's mocks and a query
// cache that never retries; `currentPath` is where the router stands; `refusal` is the error the
// client raises for an API refusal; `inBothLocales` draws a page in Arabic, then English, under the
// design's rules.
import { QueryClient } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { TRPCClientError } from '@trpc/client';
import { StrictMode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { vi } from 'vitest';

import { App } from '../App';
import { expectDesignRules } from '../design/components/__tests__/harness';
import { type MessageKey, setLocale, translate } from '../i18n';
import type { AdminClient } from '../lib/client';
import { type AdminSession, createSessionStore } from '../lib/session';

/** A mutation or a query of the fake client: a mock the case answers. */
export const mutation = () => ({ mutate: vi.fn<(input?: unknown) => Promise<unknown>>() });
export const query = () => ({ query: vi.fn<(input?: unknown) => Promise<unknown>>() });

let path = '';
function Where() {
  const location = useLocation();
  path = `${location.pathname}${location.search}${location.hash}`;
  return null;
}

/** Where the router stands: the path, the query and the fragment. */
export function currentPath(): string {
  return path;
}

export function renderApp({
  at,
  session = null,
  api,
  strict = false,
}: {
  readonly at: string;
  readonly session?: AdminSession | null;
  /** The procedures the page calls, by their tRPC path. */
  readonly api: object;
  /** React's strict mode, which runs every effect twice. */
  readonly strict?: boolean;
}): {
  readonly view: RenderResult;
  readonly sessions: ReturnType<typeof createSessionStore>;
  readonly client: AdminClient;
  readonly queries: QueryClient;
} {
  const sessions = createSessionStore(() => window.sessionStorage);
  if (session !== null) sessions.write(session);
  const client = {
    api: api as AdminClient['api'],
    untyped: {} as AdminClient['untyped'],
    signOut: vi.fn(async () => sessions.clear()),
  };
  const queries = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const tree = (
    <MemoryRouter initialEntries={[at]}>
      <App client={client} sessions={sessions} queries={queries} />
      <Where />
    </MemoryRouter>
  );
  const view = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { view, sessions, client, queries };
}

/** The error the client raises for an API refusal of `code`, with its details. */
export function refusal(
  code: string,
  details: readonly { path: string; code: string }[] = [],
): TRPCClientError<never> {
  return new TRPCClientError('refused', {
    meta: { responseJSON: { error: { code, message: 'refused', details } } },
  });
}

export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/** Renders a page in Arabic, then in English, and checks it in each under the design's rules. */
export async function inBothLocales(
  open: () => { readonly view: { readonly container: HTMLElement; unmount(): void } },
  check: (t: Translate, locale: 'ar' | 'en') => void | Promise<void>,
): Promise<void> {
  for (const locale of ['ar', 'en'] as const) {
    setLocale(locale);
    const { view } = open();
    await check((key, values) => translate(locale, key, values), locale);
    expectDesignRules(view.container);
    view.unmount();
  }
  setLocale('ar');
}
