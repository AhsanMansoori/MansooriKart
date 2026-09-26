import { useLocation } from 'react-router-dom';
import { EmptyState } from '../../components/ui';

export default function AdminPlaceholder() {
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') || 'module';

  return (
    <EmptyState title={`${name.charAt(0).toUpperCase()}${name.slice(1)} is next`}>
      This route is intentionally present as a navigation boundary. Its workflow will be implemented against the existing /api/v1 backend rather than mocked.
    </EmptyState>
  );
}
