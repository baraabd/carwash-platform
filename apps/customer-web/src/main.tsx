import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { customerRouter } from './app/router';
import './styles/customer-shell.css';

const root = document.getElementById('root');
if (!root) throw new Error('CUSTOMER_ROOT_NOT_FOUND');

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={customerRouter} />
  </StrictMode>,
);
