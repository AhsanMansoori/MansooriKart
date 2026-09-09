import * as React from 'react';
import { Calculator, CheckCircle2, RefreshCw } from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, Select, Spinner } from '../../components/ui';
import { applyDraftDropshipPricing, listPricingRules, previewDraftDropshipPricing, type PricingBatch, type PricingRule } from '../../services/admin/pricing';

function message(error: any) {
  return error?.normalizedMessage || error?.response?.data?.error?.message || error?.message || 'Something went wrong.';
}
function money(value: number | null, currency = 'PKR') {
  return value == null ? '—' : new Intl.NumberFormat('en-PK', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
}

export default function PricingPage() {
  const [rules, setRules] = React.useState<PricingRule[]>([]);
  const [ruleId, setRuleId] = React.useState('');
  const [batch, setBatch] = React.useState<PricingBatch | null>(null);
  const [busy, setBusy] = React.useState('');
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');

  React.useEffect(() => {
    listPricingRules().then(result => setRules(result.items)).catch(err => setError(message(err)));
  }, []);

  const preview = async () => {
    setBusy('preview'); setError(''); setNotice('');
    try { setBatch(await previewDraftDropshipPricing(ruleId || undefined)); }
    catch (err) { setError(message(err)); }
    finally { setBusy(''); }
  };

  const apply = async () => {
    if (!batch) return;
    setBusy('apply'); setError('');
    try {
      const result = await applyDraftDropshipPricing(ruleId || undefined);
      setBatch(result);
      setNotice(`Pricing applied to ${result.summary.updated} DRAFT dropship products. No product was published.`);
    } catch (err) { setError(message(err)); }
    finally { setBusy(''); }
  };

  return (
    <div className="space-y-6">
      <div>
        <Badge>J3 · Pricing</Badge>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">Dropship Pricing Review</h1>
        <p className="mt-2 text-sm text-muted-foreground">Preview rule-based prices against supplier cost before applying them to DRAFT dropship products.</p>
      </div>

      {error ? <Alert className="border-destructive/30 bg-destructive/5 text-destructive">{error}</Alert> : null}
      {notice ? <Alert className="border-success/30 bg-success/5">{notice}</Alert> : null}

      <Card className="p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Select value={ruleId} onChange={event => { setRuleId(event.target.value); setBatch(null); }}>
            <option value="">Automatic best matching active rule</option>
            {rules.map(rule => <option key={rule.id} value={rule.id}>{rule.name} · {rule.markupType === 'PERCENTAGE' ? `${rule.markupValue}%` : money(rule.markupValue)}</option>)}
          </Select>
          <Button onClick={preview} disabled={Boolean(busy)}>
            {busy === 'preview' ? <Spinner label="Calculating prices" /> : <Calculator size={16} aria-hidden="true" />}<span className="ml-2">Preview pricing</span>
          </Button>
        </div>
      </Card>

      {batch ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {[
              ['Targets', batch.summary.targets], ['Eligible', batch.summary.eligible], ['Will change', batch.summary.willChange],
              ['Overrides preserved', batch.summary.preservedOverrides], ['Blocked', batch.summary.blocked],
            ].map(([label, value]) => <Card key={String(label)} className="p-4"><p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-extrabold">{value}</p></Card>)}
          </div>

          {!batch.rows.length ? <EmptyState title="No DRAFT dropship products matched">Import supplier products first or review your target filters.</EmptyState> : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-left text-sm">
                  <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground"><tr>
                    <th className="px-4 py-3">Product</th><th className="px-4 py-3">Supplier cost</th><th className="px-4 py-3">Current</th><th className="px-4 py-3">Suggested</th>
                    <th className="px-4 py-3">Margin</th><th className="px-4 py-3">Rule</th><th className="px-4 py-3">Decision</th>
                  </tr></thead>
                  <tbody className="divide-y divide-border">
                    {batch.rows.map(row => <tr key={row.productId}>
                      <td className="px-4 py-4"><strong>{row.name || 'Unnamed product'}</strong><div className="text-xs text-muted-foreground">{row.sku || '—'}</div></td>
                      <td className="px-4 py-4">{money(row.supplierCost)}</td><td className="px-4 py-4">{money(row.currentPrice)}</td><td className="px-4 py-4 font-bold">{money(row.newPrice)}</td>
                      <td className="px-4 py-4">{row.grossMarginPercent == null ? '—' : `${row.grossMarginPercent.toFixed(2)}%`}</td>
                      <td className="px-4 py-4">{row.rule?.name || '—'}</td>
                      <td className="px-4 py-4">
                        <Badge className={row.willChange ? 'bg-success/15 text-foreground' : row.eligible ? 'bg-muted text-foreground' : 'bg-warning/20 text-foreground'}>{row.willChange ? 'Will change' : row.eligible ? 'No change' : 'Blocked'}</Badge>
                        {row.issues.length ? <div className="mt-2 max-w-xs text-xs text-muted-foreground">{row.issues.map(issue => issue.message).join(' ')}</div> : null}
                      </td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div><strong>{batch.summary.willChange}</strong> prices will change.<p className="text-xs text-muted-foreground">Margin basis: {batch.marginBasis}. Applying prices never publishes products.</p></div>
              <div className="flex gap-2">
                <Button className="bg-muted text-foreground hover:bg-border" onClick={preview} disabled={Boolean(busy)}><RefreshCw size={16} aria-hidden="true" /><span className="ml-2">Recalculate</span></Button>
                <Button onClick={apply} disabled={Boolean(busy) || batch.summary.willChange === 0}>{busy === 'apply' ? <Spinner label="Applying prices" /> : <CheckCircle2 size={16} aria-hidden="true" />}<span className="ml-2">Apply previewed pricing</span></Button>
              </div>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
