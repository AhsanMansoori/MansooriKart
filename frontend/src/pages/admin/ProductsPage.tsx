import * as React from 'react';
import { CheckCircle2, RefreshCw, Search, Send, Tag } from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, Input, Select, Spinner } from '../../components/ui';
import { listAdminProducts, previewPublication, publishProducts, updateAdminProduct, type AdminProduct, type PublicationCandidate } from '../../services/admin/catalog';

function message(error: any) {
  return error?.normalizedMessage || error?.response?.data?.error?.message || error?.message || 'Something went wrong.';
}
function money(value: number | null | undefined, currency = 'PKR') {
  return value == null ? '—' : new Intl.NumberFormat('en-PK', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
}

export default function ProductsPage() {
  const [products, setProducts] = React.useState<AdminProduct[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [status, setStatus] = React.useState<'DRAFT' | 'ACTIVE' | 'ARCHIVED'>('DRAFT');
  const [search, setSearch] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState('');
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [publication, setPublication] = React.useState<PublicationCandidate[] | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await listAdminProducts({ status, search: query || undefined, limit: 50 });
      setProducts(result.items);
      setSelected(new Set());
      setPublication(null);
    } catch (err) {
      setError(message(err));
    } finally {
      setLoading(false);
    }
  }, [status, query]);

  React.useEffect(() => { void load(); }, [load]);

  const toggle = (id: string) => {
    setSelected(current => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setPublication(null);
  };

  const savePrice = async (product: AdminProduct, value: string) => {
    const price = Number(value);
    if (!Number.isFinite(price) || price < 0 || price === product.price) return;
    setBusy(product.id);
    setError('');
    try {
      const updated = await updateAdminProduct(product.id, { price });
      setProducts(current => current.map(item => item.id === product.id ? updated : item));
      setNotice(`Saved manual price for ${updated.name}. It is now protected as an admin override.`);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy('');
    }
  };

  const preview = async () => {
    if (!selected.size) return;
    setBusy('preview');
    setError('');
    setNotice('');
    try {
      const result = await previewPublication([...selected]);
      setPublication(result.candidates);
      setNotice(`${result.summary.publishable} of ${result.summary.requested} selected products pass the publication gate.`);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy('');
    }
  };

  const publish = async () => {
    if (!publication || !selected.size) return;
    const publishable = publication.filter(item => item.publishable);
    if (!publishable.length) return;
    setBusy('publish');
    setError('');
    try {
      const result = await publishProducts([...selected]);
      setNotice(`Published ${result.summary.publishedCount}; rejected ${result.summary.rejectedCount}.`);
      await load();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Badge>J3 · Catalog</Badge>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight">Catalog Review & Publication</h1>
          <p className="mt-2 text-sm text-muted-foreground">Review imported DRAFT products, correct selling prices, run the publication gate, then publish deliberately.</p>
        </div>
        <Button className="bg-muted text-foreground hover:bg-border" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" /><span className="ml-2">Refresh</span>
        </Button>
      </div>

      {error ? <Alert className="border-destructive/30 bg-destructive/5 text-destructive">{error}</Alert> : null}
      {notice ? <Alert className="border-success/30 bg-success/5">{notice}</Alert> : null}

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-[180px_1fr_auto]">
          <Select value={status} onChange={event => setStatus(event.target.value as any)}>
            <option value="DRAFT">Draft products</option>
            <option value="ACTIVE">Published products</option>
            <option value="ARCHIVED">Archived products</option>
          </Select>
          <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, SKU or slug" onKeyDown={event => event.key === 'Enter' && setQuery(search.trim())} />
          <Button onClick={() => setQuery(search.trim())}><Search size={16} aria-hidden="true" /><span className="ml-2">Search</span></Button>
        </div>
      </Card>

      {selected.size ? (
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm"><strong>{selected.size}</strong> selected</div>
            <div className="flex gap-2">
              <Button className="bg-muted text-foreground hover:bg-border" onClick={preview} disabled={Boolean(busy)}>
                {busy === 'preview' ? <Spinner label="Checking publication" /> : <CheckCircle2 size={16} aria-hidden="true" />}
                <span className="ml-2">Publication preview</span>
              </Button>
              <Button onClick={publish} disabled={Boolean(busy) || !publication?.some(item => item.publishable)}>
                {busy === 'publish' ? <Spinner label="Publishing products" /> : <Send size={16} aria-hidden="true" />}
                <span className="ml-2">Publish selected</span>
              </Button>
            </div>
          </div>

          {publication ? (
            <div className="mt-4 grid gap-2">
              {publication.map((candidate, index) => (
                <div key={candidate.productId || candidate.id || index} className="rounded-mk border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <strong>{candidate.name || candidate.productId || candidate.id || `Product ${index + 1}`}</strong>
                    <Badge className={candidate.publishable ? 'bg-success/15 text-foreground' : 'bg-warning/20 text-foreground'}>
                      {candidate.publishable ? 'Publishable' : 'Blocked'}
                    </Badge>
                  </div>
                  {!candidate.publishable ? <p className="mt-2 text-xs text-muted-foreground">{candidate.issues.map(issue => issue.code).join(', ')}</p> : null}
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      {loading ? (
        <Card className="p-8"><Spinner label="Loading products" /></Card>
      ) : !products.length ? (
        <EmptyState title="No products found">Try another status or search. Imported supplier products will appear here as DRAFT.</EmptyState>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-left text-sm">
              <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Select</th><th className="px-4 py-3">Product</th><th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Cost</th><th className="px-4 py-3">Selling price</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {products.map(product => (
                  <tr key={product.id} className="align-top">
                    <td className="px-4 py-4"><input type="checkbox" checked={selected.has(product.id)} onChange={() => toggle(product.id)} aria-label={`Select ${product.name}`} /></td>
                    <td className="px-4 py-4">
                      <div className="font-bold">{product.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{product.sku} · {product.category}{product.brand ? ` · ${product.brand}` : ''}</div>
                    </td>
                    <td className="px-4 py-4"><Badge>{product.fulfillmentType}</Badge><div className="mt-1 text-xs text-muted-foreground">{product.sourceType || 'MANUAL'}</div></td>
                    <td className="px-4 py-4">{money(product.costPrice, product.currency)}</td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <input
                          key={`${product.id}-${product.price}`}
                          type="number"
                          min="0"
                          step="0.01"
                          defaultValue={product.price}
                          onBlur={event => void savePrice(product, event.currentTarget.value)}
                          className="w-32 rounded-mk border border-input bg-card px-3 py-2"
                          aria-label={`Selling price for ${product.name}`}
                        />
                        {busy === product.id ? <Spinner label="Saving price" /> : null}
                      </div>
                      {product.sellingPriceOverridden ? <div className="mt-1 text-xs text-muted-foreground">Manual override</div> : null}
                    </td>
                    <td className="px-4 py-4"><Badge>{product.status}</Badge></td>
                    <td className="px-4 py-4 text-xs text-muted-foreground">{product.updatedAt ? new Date(product.updatedAt).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Alert className="border-info/30 bg-info/5">
        <Tag size={16} className="mr-2 inline" aria-hidden="true" />
        Pricing rules are managed separately under <strong>Pricing</strong>. This page only saves deliberate manual price overrides and controls publication.
      </Alert>
    </div>
  );
}
