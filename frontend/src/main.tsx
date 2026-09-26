import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary';
import { NotificationProvider } from './context/NotificationProvider';
import { queryClient } from './lib/queryClient';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <NotificationProvider>
          <App />
        </NotificationProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
