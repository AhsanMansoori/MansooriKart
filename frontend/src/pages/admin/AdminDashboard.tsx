import { ArrowRight, FileSpreadsheet, PackageCheck, ShoppingCart, Tags } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Card } from '../../components/ui';

const workflows = [
  {
    title: 'Import supplier catalog',
    description: 'Upload supplier CSV files, map columns, validate rows, and create draft products.',
    to: '/admin/imports',
    icon: FileSpreadsheet,
  },
  {
    title: 'Review draft products',
    description: 'Check imported catalog data before anything is visible on the storefront.',
    to: '/admin/products',
    icon: PackageCheck,
  },
  {
    title: 'Configure pricing',
    description: 'Apply markup and pricing rules while keeping supplier costs private.',
    to: '/admin/pricing',
    icon: Tags,
  },
  {
    title: 'Manage fulfillment',
    description: 'Track customer orders and the supplier fulfillment lifecycle.',
    to: '/admin/orders',
    icon: ShoppingCart,
  },
];

export default function AdminDashboard() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Badge>Phase J</Badge>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight">Super Admin Dashboard</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            The admin foundation is ready. The next implementation focus is the supplier-to-storefront dropshipping workflow.
          </p>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Primary admin workflows">
        {workflows.map(({ title, description, to, icon: Icon }) => (
          <Card key={to} className="p-5">
            <div className="mb-4 inline-flex rounded-mk bg-secondary p-2.5 text-secondary-foreground">
              <Icon size={20} aria-hidden="true" />
            </div>
            <h2 className="font-bold">{title}</h2>
            <p className="mt-2 min-h-12 text-sm leading-6 text-muted-foreground">{description}</p>
            <Link to={to} className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-primary-foreground">
              Open workflow <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </Card>
        ))}
      </section>

      <Card className="p-6">
        <h2 className="text-lg font-bold">Launch workflow</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Supplier → CSV Upload → Column Mapping → Preview → Validation → Import → Draft Product → Review → Pricing → Publish → Storefront
        </p>
      </Card>
    </div>
  );
}
