import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CarePackageId } from './bookingDraft';
import { repeatOrder, resumeBooking, startBooking, viewOrder } from './bookingEntry';
import type { CustomerSessionState, NavigationIntent, SessionTransition } from './customerSession';

export interface CustomerSessionCommands {
  readonly startBooking: (service?: CarePackageId) => NavigationIntent | null;
  readonly resumeBooking: () => NavigationIntent | null;
  readonly repeatOrder: (orderId: string) => NavigationIntent | null;
  readonly viewOrder: (orderId: string) => NavigationIntent | null;
}

interface CustomerSessionValue {
  readonly state: CustomerSessionState;
  readonly commands: CustomerSessionCommands;
  /**
   * Applies a pure session command and returns its result, so a feature keeps its
   * own commands (and their extra results, such as a validation message) without
   * the provider having to know them.
   */
  readonly run: <Result extends { readonly state: CustomerSessionState }>(
    command: (state: CustomerSessionState) => Result,
  ) => Result;
}

const CustomerSessionContext = createContext<CustomerSessionValue | null>(null);

interface ProviderProps {
  readonly initialState: CustomerSessionState;
  readonly children: ReactNode;
}

/**
 * In-memory customer session. It holds the unsent draft and read-only order
 * snapshots for the current page lifetime only: there is no browser storage and
 * no network call here, so nothing in it can be mistaken for a saved booking.
 */
export function CustomerSessionProvider({ initialState, children }: ProviderProps) {
  const [state, setState] = useState(initialState);
  // Commands need the latest state synchronously to return their navigation intent.
  const stateRef = useRef(state);

  const apply = useCallback((transition: SessionTransition) => {
    stateRef.current = transition.state;
    setState(transition.state);
    return transition.intent;
  }, []);

  const commands = useMemo<CustomerSessionCommands>(
    () => ({
      startBooking: (service) => apply(startBooking(stateRef.current, service)),
      resumeBooking: () => apply(resumeBooking(stateRef.current)),
      repeatOrder: (orderId) => apply(repeatOrder(stateRef.current, orderId)),
      viewOrder: (orderId) => apply(viewOrder(stateRef.current, orderId)),
    }),
    [apply],
  );

  const run = useCallback<CustomerSessionValue['run']>((command) => {
    const result = command(stateRef.current);
    stateRef.current = result.state;
    setState(result.state);
    return result;
  }, []);

  const value = useMemo(() => ({ state, commands, run }), [state, commands, run]);
  return (
    <CustomerSessionContext.Provider value={value}>{children}</CustomerSessionContext.Provider>
  );
}

export function useCustomerSession(): CustomerSessionValue {
  const value = useContext(CustomerSessionContext);
  if (!value) throw new Error('CUSTOMER_SESSION_PROVIDER_MISSING');
  return value;
}
