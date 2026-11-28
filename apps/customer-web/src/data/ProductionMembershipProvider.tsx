import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useCustomerProduction } from './CustomerProductionProvider';
import { browserCsrf } from './productionCustomer';
import { ProductionMembership, type MembershipSnapshot } from './productionMembership';

const Context = createContext<{
  readonly client: ProductionMembership;
  readonly snapshot: MembershipSnapshot;
} | null>(null);
const key = (subject: string): string => `washgo.subscription-recovery.v1:${subject}`;
function Runtime({ children }: { readonly children: ReactNode }) {
  const customer = useCustomerProduction()!;
  const [client] = useState(
    () =>
      new ProductionMembership({
        origin: window.location.origin,
        fetch: (url, init) => fetch(url, { ...init, redirect: 'error', cache: 'no-store' }),
        csrf: () => browserCsrf(document.cookie),
        newKey: () => crypto.randomUUID(),
        recovery: {
          read: (subject) => {
            const value: unknown = JSON.parse(
              window.sessionStorage.getItem(key(subject)) ?? 'null',
            );
            if (!value || typeof value !== 'object') return { pendingKey: null, purchaseId: null };
            const record = value as Record<string, unknown>;
            return {
              pendingKey: typeof record.pendingKey === 'string' ? record.pendingKey : null,
              purchaseId: typeof record.purchaseId === 'string' ? record.purchaseId : null,
            };
          },
          write: (subject, value) => {
            if (!value.pendingKey && !value.purchaseId)
              window.sessionStorage.removeItem(key(subject));
            else window.sessionStorage.setItem(key(subject), JSON.stringify(value));
          },
        },
      }),
  );
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const session =
    customer.snapshot.authStatus === 'authenticated' ? customer.snapshot.session : null;
  useLayoutEffect(() => {
    client.bindSession(session);
  }, [client, session]);
  const value = useMemo(() => ({ client, snapshot }), [client, snapshot]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function ProductionMembershipProvider({ children }: { readonly children: ReactNode }) {
  return useCustomerProduction() ? <Runtime>{children}</Runtime> : children;
}
export const useProductionMembership = () => useContext(Context);
