// B42 lane S: the render harness of the shared pieces. `app-harness.tsx` draws a page through the
// App and its router, and these pieces belong to no route of their own, so a piece is drawn here
// as a page draws it: inside the console's frame, with the query cache, the fake client (the
// case's mocks, `mutation()` and `query()` of `app-harness.tsx`) and a router, whose position
// `currentPath` answers.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { vi } from 'vitest';

import { Console } from '../../design/components';
import { AdminProvider } from '../../lib/admin-context';
import type { AdminClient } from '../../lib/client';
import { createSessionStore } from '../../lib/session';

let path = '';
function Where() {
  const location = useLocation();
  path = `${location.pathname}${location.search}`;
  return null;
}

/** Where the router stands after a piece's link was pressed: the path and the query. */
export function currentPath(): string {
  return path;
}

/** Draws `ui` as a page would, with `api` as the client's procedures, at `/`. */
export function renderPiece(ui: () => ReactElement, api: object): { readonly view: RenderResult } {
  const sessions = createSessionStore(() => window.sessionStorage);
  const client: AdminClient = {
    api: api as AdminClient['api'],
    untyped: {} as AdminClient['untyped'],
    signOut: vi.fn(async () => undefined),
  };
  const queries = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queries}>
      <AdminProvider services={{ client, sessions }}>
        <MemoryRouter initialEntries={['/']}>
          <Console>{ui()}</Console>
          <Where />
        </MemoryRouter>
      </AdminProvider>
    </QueryClientProvider>,
  );
  return { view };
}
