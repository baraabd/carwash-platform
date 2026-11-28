import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { PrincipalRef } from '@carwash/contracts/common';
import { useCustomerProduction } from './CustomerProductionProvider';
import { browserCsrf } from './productionCustomer';
import { ProductionBookingClient, type ProductionBookingSnapshot } from './productionBooking';

interface Value {
  readonly client: ProductionBookingClient;
  readonly snapshot: ProductionBookingSnapshot;
}
const Context = createContext<Value | null>(null);
const keyFor = (principal: PrincipalRef) =>
  `washgo.pending-booking.v1:${principal.kind}:${principal.subjectId}`;

function Runtime({ children }: { readonly children: ReactNode }) {
  const customer = useCustomerProduction()!;
  const [client] = useState(
    () =>
      new ProductionBookingClient({
        origin: window.location.origin,
        fetch: (url, init) => fetch(url, { ...init, redirect: 'error', cache: 'no-store' }),
        csrf: () => browserCsrf(document.cookie),
        newKey: () => crypto.randomUUID(),
        recovery: {
          read: (principal) => window.sessionStorage.getItem(keyFor(principal)),
          write: (principal, key) => window.sessionStorage.setItem(keyFor(principal), key),
          clear: (principal) => window.sessionStorage.removeItem(keyFor(principal)),
        },
      }),
  );
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const session =
    customer.snapshot.authStatus === 'authenticated' ? customer.snapshot.session : null;
  useLayoutEffect(() => {
    client.bindSession(session);
  }, [client, session]);
  useEffect(() => {
    void client.loadCatalog();
  }, [client]);
  const value = useMemo(() => ({ client, snapshot }), [client, snapshot]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Parity retains its frozen in-memory model and sends no owner traffic. */
export function ProductionBookingProvider({ children }: { readonly children: ReactNode }) {
  const production = useCustomerProduction();
  return production ? <Runtime>{children}</Runtime> : children;
}
export function useProductionBooking(): Value | null {
  return useContext(Context);
}
