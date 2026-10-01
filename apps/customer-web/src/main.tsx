import './styles/customer-shell.css';
import './styles/customer-shared.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { customerRouter } from './app/router';
import { initialSessionState } from './app/initialSession';
import { CustomerSessionProvider } from './state/CustomerSessionProvider';

const root = document.getElementById('root');
if (!root) throw new Error('CUSTOMER_ROOT_NOT_FOUND');

createRoot(root).render(
  <StrictMode>
    <CustomerSessionProvider initialState={initialSessionState(window.location.hash)}>
      <RouterProvider router={customerRouter} />
    </CustomerSessionProvider>
  </StrictMode>,
);
