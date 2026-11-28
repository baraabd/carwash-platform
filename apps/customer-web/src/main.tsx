import './styles/customer-shell.css';
import './styles/customer-shared.css';
import './styles/customer-forms.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { customerRouter } from './app/router';
import { CustomerSessionProvider } from './state/CustomerSessionProvider';
import { CustomerProductionProvider } from './data/CustomerProductionProvider';
import { ProductionBookingProvider } from './data/ProductionBookingProvider';
import { ProductionMembershipProvider } from './data/ProductionMembershipProvider';

const root = document.getElementById('root');
if (!root) throw new Error('CUSTOMER_ROOT_NOT_FOUND');

// Vite replaces MODE at build time. Only `vite build --mode parity` can include
// scenario data; query strings, hash routes and browser storage cannot enable it.
// Keep the import inside the branch so production assets omit fixture scenarios.
const initialState =
  import.meta.env.MODE === 'parity'
    ? (await import('./app/initialSession')).initialSessionState(window.location.hash)
    : await (
        await import('./data/productionSession')
      ).productionSession(window.location.origin, (url, init) =>
        fetch(url, { ...init, redirect: 'error' }),
      );

createRoot(root).render(
  <StrictMode>
    <CustomerSessionProvider initialState={initialState}>
      <CustomerProductionProvider>
        <ProductionBookingProvider>
          <ProductionMembershipProvider>
            <RouterProvider router={customerRouter} />
          </ProductionMembershipProvider>
        </ProductionBookingProvider>
      </CustomerProductionProvider>
    </CustomerSessionProvider>
  </StrictMode>,
);
