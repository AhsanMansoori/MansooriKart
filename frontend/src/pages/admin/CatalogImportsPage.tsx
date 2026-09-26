import * as React from 'react';
import { AlertCircle, CheckCircle2, FileSpreadsheet, History, UploadCloud } from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, Select, Spinner } from '../../components/ui';
import {
  confirmCatalogMapping,
  getMappingTargets,
  listCatalogImports,
  listSuppliers,
  previewCatalogImport,
  runCatalogImport,
  uploadCatalogCsv,
  type ImportJob,
  type MappingEntry,
  type MappingTargetConfig,
  type Supplier,
} from '../../services/admin/catalogImports';

type Step = 'upload' | 'mapping' | 'preview' | 'complete';

function normalizeSuggestedMapping(value: unknown, headers: string[]): Record<string, string> {
  const output: Record<string, string> = {};
  if (Array.isArray(value)) {
    for (const item of value as Array<any>) {
      if (item?.column && item?.target) output[String(item.column)] = String(item.target);
    }
  } else if (value && typeof value === 'object') {
    for (const [column, target] of Object.entries(value as Record<string, unknown>)) {
      if (typeof target === 'string') output[column] = target;
    }
  }
  return Object.fromEntries(headers.map(header => [header, output[header] ?? '']));
}

function errorMessage(error: any) {
  return error?.normalizedMessage || error?.response?.data?.error?.message || error?.message || 'Something went wrong.';
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CatalogImportsPage() {
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [config, setConfig] = React.useState<MappingTargetConfig | null>(null);
  const [history, setHistory] = React.useState<ImportJob[]>([]);
  const [supplierId, setSupplierId] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);
  const [job, setJob] = React.useState<ImportJob | null>(null);
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [previewRows, setPreviewRows] = React.useState<Array<Record<string, unknown>>>([]);
  const [previewTotal, setPreviewTotal] = React.useState(0);
  const [step, setStep] = React.useState<Step>('upload');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');

  const refreshHistory = React.useCallback(async () => {
    try {
      const result = await listCatalogImports(1, 8);
      setHistory(result.items);
    } catch {
      // History is useful, but should never block the primary import workflow.
    }
  }, []);

  React.useEffect(() => {
    let active = true;
    Promise.all([listSuppliers(), getMappingTargets()])
      .then(([supplierRows, mappingConfig]) => {
        if (!active) return;
        setSuppliers(supplierRows);
        setConfig(mappingConfig);
        if (supplierRows.length) setSupplierId(current => current || supplierRows[0].id);
      })
      .catch(err => active && setError(errorMessage(err)));
    void refreshHistory();
    return () => {
      active = false;
    };
  }, [refreshHistory]);

  const reset = () => {
    setFile(null);
    setJob(null);
    setHeaders([]);
    setMapping({});
    setPreviewRows([]);
    setPreviewTotal(0);
    setStep('upload');
    setError('');
    setSuccess('');
  };

  const handleUpload = async () => {
    if (!supplierId || !file) {
      setError('Choose an active supplier and a CSV file first.');
      return;
    }
    if (config && file.size > config.limits.maxFileBytes) {
      setError(`This file exceeds the ${formatBytes(config.limits.maxFileBytes)} backend upload limit.`);
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await uploadCatalogCsv({ supplierId, file, fulfillmentType: 'DROPSHIP' });
      const uploadHeaders = result.headers ?? result.job.headers ?? [];
      setJob(result.job);
      setHeaders(uploadHeaders);
      setMapping(normalizeSuggestedMapping(result.templateMapping || result.suggestedMapping, uploadHeaders));
      setStep('mapping');
      await refreshHistory();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const mappedEntries = React.useMemo<MappingEntry[]>(
    () => headers.map(column => ({ column, target: mapping[column] })).filter(entry => Boolean(entry.target)),
    [headers, mapping]
  );

  const missingRequired = React.useMemo(() => {
    if (!config) return [];
    const selected = new Set(mappedEntries.map(entry => entry.target));
    return config.required.filter(target => !selected.has(target));
  }, [config, mappedEntries]);

  const duplicateTargets = React.useMemo(() => {
    const counts = new Map<string, number>();
    mappedEntries.forEach(entry => counts.set(entry.target, (counts.get(entry.target) ?? 0) + 1));
    return [...counts.entries()].filter(([, count]) => count > 1).map(([target]) => target);
  }, [mappedEntries]);

  const handleConfirmMapping = async () => {
    if (!job || missingRequired.length || duplicateTargets.length) return;
    setBusy(true);
    setError('');
    try {
      const updated = await confirmCatalogMapping(job.id, {
        entries: mappedEntries,
        fulfillmentType: 'DROPSHIP',
      });
      setJob(updated);
      const preview = await previewCatalogImport(job.id);
      setJob(preview.job);
      setPreviewRows(preview.rows ?? []);
      setPreviewTotal(preview.totalRows ?? 0);
      setStep('preview');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!job) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await runCatalogImport(job.id);
      setJob(result.job);
      setStep('complete');
      setSuccess(
        result.replayed
          ? 'This completed import was safely replayed; no duplicate products were created.'
          : 'Import completed. New products remain DRAFT until you review, price, and publish them.'
      );
      await refreshHistory();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Badge>J2 · Supplier Catalog</Badge>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">CSV Catalog Import</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Upload a supplier feed, confirm how its columns map into MansooriKart, preview validation, then create DRAFT dropship products.
        </p>
      </div>

      {error ? <Alert className="border-destructive/30 bg-destructive/5 text-destructive">{error}</Alert> : null}
      {success ? <Alert className="border-success/30 bg-success/5 text-foreground">{success}</Alert> : null}

      <div className="grid gap-4 lg:grid-cols-4">
        {['1. Upload', '2. Mapping', '3. Preview', '4. Import'].map((label, index) => {
          const activeIndex = step === 'upload' ? 0 : step === 'mapping' ? 1 : step === 'preview' ? 2 : 3;
          return (
            <div
              key={label}
              className={`rounded-mk border px-4 py-3 text-sm font-semibold ${
                index <= activeIndex ? 'border-primary/40 bg-secondary text-secondary-foreground' : 'border-border bg-card text-muted-foreground'
              }`}
            >
              {label}
            </div>
          );
        })}
      </div>

      {step === 'upload' ? (
        <Card className="p-6">
          <div className="grid gap-5 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-semibold">
              Supplier
              <Select value={supplierId} onChange={event => setSupplierId(event.target.value)}>
                {!suppliers.length ? <option value="">No active suppliers found</option> : null}
                {suppliers.map(supplier => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name} ({supplier.code})
                  </option>
                ))}
              </Select>
            </label>

            <label className="grid gap-2 text-sm font-semibold">
              CSV file
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={event => setFile(event.target.files?.[0] ?? null)}
                className="block min-h-10 w-full rounded-mk border border-input bg-card px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1 file:font-semibold file:text-secondary-foreground"
              />
            </label>
          </div>

          {file ? (
            <div className="mt-4 rounded-mk bg-muted p-4 text-sm">
              <span className="font-semibold">{file.name}</span>
              <span className="ml-2 text-muted-foreground">{formatBytes(file.size)}</span>
            </div>
          ) : null}

          <div className="mt-6 flex justify-end">
            <Button onClick={handleUpload} disabled={busy || !supplierId || !file}>
              {busy ? <Spinner label="Uploading CSV" /> : <UploadCloud size={17} aria-hidden="true" />}
              <span className="ml-2">Upload and inspect</span>
            </Button>
          </div>
        </Card>
      ) : null}

      {step === 'mapping' && config ? (
        <Card className="p-6">
          <div className="mb-5">
            <h2 className="text-lg font-bold">Map supplier columns</h2>
            <p className="mt-1 text-sm text-muted-foreground">Required targets: {config.required.join(', ')}. Leave irrelevant supplier columns unmapped.</p>
          </div>

          <div className="overflow-x-auto rounded-mk border border-border">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">CSV column</th>
                  <th className="px-4 py-3">MansooriKart target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {headers.map(header => (
                  <tr key={header}>
                    <td className="px-4 py-3 font-semibold">{header}</td>
                    <td className="px-4 py-3">
                      <Select value={mapping[header] ?? ''} onChange={event => setMapping(current => ({ ...current, [header]: event.target.value }))}>
                        <option value="">Ignore this column</option>
                        {config.targets.map(target => (
                          <option key={target} value={target}>
                            {target}
                            {config.required.includes(target) ? ' *' : ''}
                          </option>
                        ))}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {missingRequired.length ? (
            <Alert className="mt-4 border-warning/30 bg-warning/5">
              Missing required mappings: <strong>{missingRequired.join(', ')}</strong>
            </Alert>
          ) : null}
          {duplicateTargets.length ? (
            <Alert className="mt-4 border-warning/30 bg-warning/5">
              Each target can only be mapped once. Duplicates: <strong>{duplicateTargets.join(', ')}</strong>
            </Alert>
          ) : null}

          <div className="mt-6 flex items-center justify-between gap-3">
            <Button className="bg-muted text-foreground hover:bg-border" onClick={reset} disabled={busy}>
              Start over
            </Button>
            <Button onClick={handleConfirmMapping} disabled={busy || Boolean(missingRequired.length) || Boolean(duplicateTargets.length)}>
              {busy ? <Spinner label="Validating mapping" /> : <CheckCircle2 size={17} aria-hidden="true" />}
              <span className="ml-2">Confirm mapping & preview</span>
            </Button>
          </div>
        </Card>
      ) : null}

      {step === 'preview' ? (
        <Card className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold">Validation preview</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Showing {previewRows.length} sampled rows from {previewTotal} total rows. No products have been written yet.
              </p>
            </div>
            <Badge>{job?.status ?? 'READY'}</Badge>
          </div>

          {previewRows.length ? (
            <div className="mt-5 overflow-x-auto rounded-mk border border-border">
              <table className="w-full min-w-[900px] text-left text-xs">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-3 py-3">#</th>
                    <th className="px-3 py-3">Preview data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {previewRows.map((row, index) => (
                    <tr key={index}>
                      <td className="px-3 py-3 align-top font-semibold">{index + 1}</td>
                      <td className="px-3 py-3 font-mono text-[11px] leading-5 text-muted-foreground">
                        <pre className="whitespace-pre-wrap">{JSON.stringify(row, null, 2)}</pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-5">
              <EmptyState title="No preview rows returned">Review the backend validation message above before importing.</EmptyState>
            </div>
          )}

          <Alert className="mt-5 border-info/30 bg-info/5">
            Importing creates or updates supplier catalog records and creates new products as <strong>DRAFT</strong>. It does not publish them.
          </Alert>

          <div className="mt-6 flex justify-end">
            <Button onClick={handleImport} disabled={busy}>
              {busy ? <Spinner label="Importing catalog" /> : <FileSpreadsheet size={17} aria-hidden="true" />}
              <span className="ml-2">Import as DRAFT products</span>
            </Button>
          </div>
        </Card>
      ) : null}

      {step === 'complete' && job ? (
        <Card className="p-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 text-success" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-bold">Import {job.jobNumber} complete</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Created {job.counters.createdRows}, updated {job.counters.updatedRows}, skipped {job.counters.skippedRows}, failed {job.counters.failedRows}.
              </p>
            </div>
          </div>
          {job.errorSummary?.length ? (
            <div className="mt-5 space-y-2">
              {job.errorSummary.map(item => (
                <Alert key={item.code} className="border-warning/30 bg-warning/5">
                  <strong>{item.code}</strong> · {item.message} ({item.count})
                </Alert>
              ))}
            </div>
          ) : null}
          <div className="mt-6">
            <Button onClick={reset}>Import another catalog</Button>
          </div>
        </Card>
      ) : null}

      <Card className="p-6">
        <div className="flex items-center gap-2">
          <History size={18} aria-hidden="true" />
          <h2 className="text-lg font-bold">Recent import jobs</h2>
        </div>

        {!history.length ? (
          <div className="mt-4 text-sm text-muted-foreground">No import history yet.</div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-3">Job</th>
                  <th className="px-3 py-3">File</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Rows</th>
                  <th className="px-3 py-3">Created</th>
                  <th className="px-3 py-3">Failed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {history.map(item => (
                  <tr key={item.id}>
                    <td className="px-3 py-3 font-semibold">{item.jobNumber}</td>
                    <td className="px-3 py-3">{item.fileName}</td>
                    <td className="px-3 py-3">
                      <Badge>{item.status}</Badge>
                    </td>
                    <td className="px-3 py-3">{item.counters.totalRows}</td>
                    <td className="px-3 py-3">{item.counters.createdRows}</td>
                    <td className="px-3 py-3">{item.counters.failedRows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!suppliers.length && !error ? (
        <Alert className="border-warning/30 bg-warning/5">
          <AlertCircle size={16} className="mr-2 inline" aria-hidden="true" />
          Create an active supplier before importing a catalog.
        </Alert>
      ) : null}
    </div>
  );
}
