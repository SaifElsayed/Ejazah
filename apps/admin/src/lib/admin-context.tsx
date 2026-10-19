// T037: what every page of the panel reaches without props: the one client and the session store,
// created once in main.tsx (a test hands in its own).
import { createContext, type ReactNode, useContext } from 'react';

import type { AdminClient } from './client';
import type { SessionStore } from './session';

export interface AdminServices {
  readonly client: AdminClient;
  readonly sessions: SessionStore;
}

const AdminContext = createContext<AdminServices | null>(null);

export function AdminProvider({
  services,
  children,
}: {
  readonly services: AdminServices;
  readonly children: ReactNode;
}) {
  return <AdminContext.Provider value={services}>{children}</AdminContext.Provider>;
}

/** The client and the session store; throws outside the App, where no page renders. */
export function useAdmin(): AdminServices {
  const services = useContext(AdminContext);
  if (services === null) throw new Error('useAdmin: no AdminProvider above this component');
  return services;
}
