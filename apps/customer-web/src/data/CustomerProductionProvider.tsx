import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useCustomerSession } from '../state/CustomerSessionProvider';
import { emptySession } from '../state/emptySession';
import { sizeName } from '../widgets/vehicle-editor/vehicleEditorModel';
import {
  browserCsrf,
  ProductionCustomer,
  type ProductionCustomerSnapshot,
} from './productionCustomer';

interface Value {
  readonly client: ProductionCustomer;
  readonly snapshot: ProductionCustomerSnapshot;
}
const Context = createContext<Value | null>(null);

function ProductionRuntime({ children }: { readonly children: ReactNode }) {
  const { run } = useCustomerSession();
  const [client] = useState(
    () =>
      new ProductionCustomer({
        origin: window.location.origin,
        fetch: (url, init) => fetch(url, { ...init, redirect: 'error', cache: 'no-store' }),
        csrf: () => browserCsrf(document.cookie),
        newKey: () => crypto.randomUUID(),
      }),
  );
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const lastPrincipal = useRef<string | null>(null);

  useEffect(() => {
    void client.load();
  }, [client]);

  useLayoutEffect(() => {
    const authenticated = snapshot.authStatus === 'authenticated';
    const principal =
      authenticated && snapshot.session
        ? `${snapshot.session.principalKind}:${snapshot.session.subject}:${snapshot.session.sessionId}:${snapshot.session.authVersion}`
        : null;
    const changed = lastPrincipal.current !== principal;
    lastPrincipal.current = principal;
    run((previous) => {
      // A logout/recovery/identity switch must also clear private drafts, orders
      // and saved-address session copies, not merely replace the visible name.
      const state = changed
        ? { ...emptySession(), productionData: previous.productionData }
        : previous;
      return {
        state: {
          ...state,
          profile: {
            name: authenticated ? (snapshot.profile?.contact.displayName ?? '') : '',
            phone: authenticated ? (snapshot.profile?.contact.phone ?? '') : '',
          },
          vehicles: authenticated
            ? snapshot.vehicles.map((vehicle) => ({
                id: vehicle.vehicleId,
                type: vehicle.type,
                name: vehicle.nickname ?? vehicle.model ?? sizeName(vehicle.type),
                plate: vehicle.plate?.text ?? '',
                color: vehicle.color ?? '',
              }))
            : [],
          productionData: {
            catalog: previous.productionData?.catalog ?? null,
            catalogStatus: previous.productionData?.catalogStatus ?? 'unavailable',
            profileStatus:
              authenticated && snapshot.profileStatus === 'available'
                ? 'available'
                : snapshot.authStatus === 'anonymous'
                  ? 'anonymous'
                  : 'unavailable',
          },
        },
      };
    });
  }, [run, snapshot]);
  const value = useMemo(() => ({ client, snapshot }), [client, snapshot]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Parity mounts no production runtime and issues no authentication or owner calls. */
export function CustomerProductionProvider({ children }: { readonly children: ReactNode }) {
  const { state } = useCustomerSession();
  return state.runtimeMode === 'parity' ? (
    children
  ) : (
    <ProductionRuntime>{children}</ProductionRuntime>
  );
}

export function useCustomerProduction(): Value | null {
  return useContext(Context);
}
