import React from 'react';

export default class ErrorBoundary extends React.Component {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError)
      return (
        <main role="alert" className="min-h-screen bg-canvas p-8 text-deep-navy">
          <h1 className="text-2xl font-bold">Something went wrong</h1>
          <p className="mt-2 text-neutral">Please refresh the page and try again.</p>
        </main>
      );
    return this.props.children;
  }
}
