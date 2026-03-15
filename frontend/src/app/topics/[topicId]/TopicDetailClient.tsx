'use client';

import { useState, use } from 'react';
import Link from 'next/link';
import {
  RefreshCw,
  Sparkles,
  Plus,
  Trash2,
  ChevronLeft,
  ExternalLink,
} from 'lucide-react';
import { Nav } from '@/components/Nav';
import { Spinner } from '@/components/Spinner';
import { SourceBadge } from '@/components/SourceBadge';
import { StatusBadge } from '@/components/StatusBadge';
import {
  useTopic,
  useSources,
  useDigests,
  useCreateSource,
  useDeleteSource,
  useUpdateSource,
  useTriggerScan,
  useTriggerSynthesis,
} from '@/lib/hooks';
import type { SourceCreate, SourceType, DigestSummary } from '@/lib/types';
import { useRequireAuth } from '@/lib/api';

type Tab = 'digest' | 'sources' | 'history';

// ---------------------------------------------------------------------------
// Add Source form
// ---------------------------------------------------------------------------

const SOURCE_TYPES: SourceType[] = ['rss', 'reddit', 'youtube', 'podcast', 'pdf', 'manual'];

function defaultConfig(type: SourceType): Record<string, unknown> {
  switch (type) {
    case 'rss':
      return { feed_url: '', lookback_days: 7, max_items: 50 };
    case 'reddit':
      return { subreddits: [], post_limit: 25, min_score: 10, lookback_days: 7 };
    case 'youtube':
      return { channel_ids: [], max_results: 20, lookback_days: 7 };
    case 'podcast':
      return { feed_url: '', lookback_days: 14, max_episodes: 5 };
    case 'pdf':
      return { urls: [] };
    case 'manual':
      return { pending_items: [] };
  }
}

function AddSourceForm({
  topicId,
  onClose,
}: {
  topicId: string;
  onClose: () => void;
}) {
  const createSource = useCreateSource(topicId);
  const [name, setName] = useState('');
  const [sourceType, setSourceType] = useState<SourceType>('rss');
  const [configRaw, setConfigRaw] = useState(() =>
    JSON.stringify(defaultConfig('rss'), null, 2),
  );
  const [error, setError] = useState('');

  function handleTypeChange(t: SourceType) {
    setSourceType(t);
    setConfigRaw(JSON.stringify(defaultConfig(t), null, 2));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    let config: unknown;
    try {
      config = JSON.parse(configRaw);
    } catch {
      setError('Invalid JSON in config');
      return;
    }
    const body: SourceCreate = { name, source_type: sourceType, config: config as SourceCreate['config'] };
    try {
      await createSource.mutateAsync(body);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add source');
    }
  }

  return (
    <div className="bg-zinc-900 border border-indigo-800/50 rounded-xl p-5 mb-4">
      <h3 className="text-zinc-200 font-semibold text-sm mb-4">Add Source</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wide">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="HN ML Feed"
              required
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder:text-zinc-600 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wide">Type</label>
            <select
              value={sourceType}
              onChange={(e) => handleTypeChange(e.target.value as SourceType)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
            >
              {SOURCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wide">
            Config (JSON)
          </label>
          <textarea
            value={configRaw}
            onChange={(e) => setConfigRaw(e.target.value)}
            rows={6}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 resize-y"
          />
        </div>
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={createSource.isPending}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {createSource.isPending && <Spinner size={12} />}
            Add Source
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 text-sm px-3 py-2 rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sources tab
// ---------------------------------------------------------------------------

function SourcesTab({ topicId }: { topicId: string }) {
  const { data: sources, isLoading, error } = useSources(topicId);
  const deleteSource = useDeleteSource(topicId);
  const [showForm, setShowForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  function handleDelete(sourceId: string) {
    if (deleteConfirm !== sourceId) {
      setDeleteConfirm(sourceId);
      return;
    }
    deleteSource.mutate(sourceId, { onSettled: () => setDeleteConfirm(null) });
  }

  function ToggleEnabled({ sourceId, enabled }: { sourceId: string; enabled: boolean }) {
    const updateSource = useUpdateSource(topicId, sourceId);
    return (
      <button
        onClick={() => updateSource.mutate({ enabled: !enabled })}
        disabled={updateSource.isPending}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          enabled ? 'bg-indigo-600' : 'bg-zinc-700'
        } disabled:opacity-50`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
            enabled ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    );
  }

  if (isLoading)
    return (
      <div className="flex justify-center py-12">
        <Spinner size={20} />
      </div>
    );
  if (error)
    return <div className="text-red-400 text-sm py-6">{error.message}</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-zinc-500 text-sm">{sources?.length ?? 0} source(s)</p>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          <Plus size={13} />
          Add Source
        </button>
      </div>

      {showForm && <AddSourceForm topicId={topicId} onClose={() => setShowForm(false)} />}

      {sources && sources.length === 0 && (
        <div className="text-center py-12 text-zinc-600 text-sm">No sources yet.</div>
      )}

      {sources && sources.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide font-medium">
                  Name
                </th>
                <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide font-medium">
                  Type
                </th>
                <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide font-medium hidden sm:table-cell">
                  Last run
                </th>
                <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide font-medium">
                  Enabled
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {sources.map((source) => (
                <tr key={source.source_id} className="hover:bg-zinc-800/20 transition-colors">
                  <td className="px-4 py-3 text-zinc-200 font-medium">{source.name}</td>
                  <td className="px-4 py-3">
                    <SourceBadge type={source.source_type} />
                  </td>
                  <td className="px-4 py-3 text-zinc-500 text-xs hidden sm:table-cell">
                    {source.last_run_at
                      ? new Date(source.last_run_at).toLocaleDateString()
                      : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    <ToggleEnabled sourceId={source.source_id} enabled={source.enabled} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(source.source_id)}
                      className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
                        deleteConfirm === source.source_id
                          ? 'bg-red-900/40 text-red-400'
                          : 'text-zinc-600 hover:text-red-400 hover:bg-zinc-800'
                      }`}
                    >
                      <Trash2 size={11} />
                      {deleteConfirm === source.source_id ? 'Confirm' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History tab
// ---------------------------------------------------------------------------

function HistoryTab({ topicId, digests }: { topicId: string; digests: DigestSummary[] }) {
  if (digests.length === 0)
    return <div className="text-center py-12 text-zinc-600 text-sm">No digests yet.</div>;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide font-medium">
              Date
            </th>
            <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide font-medium hidden sm:table-cell">
              Items
            </th>
            <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide font-medium hidden md:table-cell">
              Summary
            </th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60">
          {digests.map((d) => (
            <tr key={d.digest_id} className="hover:bg-zinc-800/20 transition-colors">
              <td className="px-4 py-3 text-zinc-300 whitespace-nowrap">
                {new Date(d.created_at).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </td>
              <td className="px-4 py-3 text-zinc-500 hidden sm:table-cell">{d.item_count}</td>
              <td className="px-4 py-3 text-zinc-500 max-w-sm hidden md:table-cell">
                <span className="truncate block">{d.summary}</span>
              </td>
              <td className="px-4 py-3 text-right">
                <Link
                  href={`/digests/${d.digest_id}?topicId=${topicId}`}
                  className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  <ExternalLink size={11} />
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Latest Digest tab
// ---------------------------------------------------------------------------

function LatestDigestTab({ topicId, digests }: { topicId: string; digests: DigestSummary[] }) {
  if (digests.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-zinc-600 text-sm">No digests yet.</p>
        <p className="text-zinc-700 text-xs mt-1">
          Run a scan then trigger synthesis to generate your first digest.
        </p>
      </div>
    );
  }

  const latest = digests[0];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-zinc-500 text-xs">
            {new Date(latest.created_at).toLocaleDateString(undefined, {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
            {' · '}
            {latest.item_count} items · {latest.window_days}d window
          </p>
        </div>
        <Link
          href={`/digests/${latest.digest_id}?topicId=${topicId}`}
          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1"
        >
          <ExternalLink size={11} />
          Full digest
        </Link>
      </div>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <p className="text-zinc-200 text-sm leading-relaxed">{latest.summary}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TopicDetailPage({
  params,
}: {
  params: Promise<{ topicId: string }>;
}) {
  useRequireAuth();
  const { topicId } = use(params);
  const { data: topic, isLoading: topicLoading, error: topicError } = useTopic(topicId);
  const { data: digests } = useDigests(topicId);
  const triggerScan = useTriggerScan();
  const triggerSynthesis = useTriggerSynthesis();
  const [tab, setTab] = useState<Tab>('digest');
  const [scanMsg, setScanMsg] = useState('');
  const [synthMsg, setSynthMsg] = useState('');

  async function handleScan() {
    setScanMsg('');
    try {
      const res = await triggerScan.mutateAsync(topicId);
      setScanMsg(`Scan triggered — ${res.sources_triggered} source(s) queued`);
    } catch (err) {
      setScanMsg(err instanceof Error ? err.message : 'Scan failed');
    }
  }

  async function handleSynthesis() {
    setSynthMsg('');
    try {
      await triggerSynthesis.mutateAsync({ topicId });
      setSynthMsg('Synthesis started — digest will be ready shortly');
    } catch (err) {
      setSynthMsg(err instanceof Error ? err.message : 'Synthesis failed');
    }
  }

  if (topicLoading)
    return (
      <div className="min-h-screen bg-zinc-950">
        <Nav />
        <div className="flex justify-center py-20">
          <Spinner size={24} />
        </div>
      </div>
    );

  if (topicError)
    return (
      <div className="min-h-screen bg-zinc-950">
        <Nav />
        <div className="max-w-5xl mx-auto px-4 py-8 text-red-400 text-sm">{topicError.message}</div>
      </div>
    );

  if (!topic) return null;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'digest', label: 'Latest Digest' },
    { key: 'sources', label: 'Sources' },
    { key: 'history', label: 'History' },
  ];

  return (
    <div className="min-h-screen bg-zinc-950">
      <Nav />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Breadcrumb */}
        <div className="mb-4">
          <Link
            href="/topics"
            className="flex items-center gap-1 text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
          >
            <ChevronLeft size={13} />
            Topics
          </Link>
        </div>

        {/* Header */}
        <div className="flex items-start justify-between mb-6 gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-zinc-100">{topic.name}</h1>
              <StatusBadge
                label={topic.enabled ? 'enabled' : 'disabled'}
                variant={topic.enabled ? 'enabled' : 'disabled'}
              />
            </div>
            <p className="text-zinc-500 text-sm mt-1">{topic.description}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleScan}
              disabled={triggerScan.isPending}
              className="flex items-center gap-1.5 py-2 px-3 rounded-lg border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-50 text-sm font-medium transition-colors"
            >
              {triggerScan.isPending ? <Spinner size={13} /> : <RefreshCw size={13} />}
              Run Scan
            </button>
            <button
              onClick={handleSynthesis}
              disabled={triggerSynthesis.isPending}
              className="flex items-center gap-1.5 py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              {triggerSynthesis.isPending ? <Spinner size={13} /> : <Sparkles size={13} />}
              Synthesise
            </button>
          </div>
        </div>

        {/* Status messages */}
        {scanMsg && (
          <div className="mb-4 bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-zinc-300 text-sm">
            {scanMsg}
          </div>
        )}
        {synthMsg && (
          <div className="mb-4 bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-zinc-300 text-sm">
            {synthMsg}
          </div>
        )}

        {/* Tabs */}
        <div className="border-b border-zinc-800 mb-6">
          <div className="flex gap-0">
            {tabs.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === key
                    ? 'border-indigo-500 text-indigo-400'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        {tab === 'digest' && (
          <LatestDigestTab topicId={topicId} digests={digests ?? []} />
        )}
        {tab === 'sources' && <SourcesTab topicId={topicId} />}
        {tab === 'history' && (
          <HistoryTab topicId={topicId} digests={digests ?? []} />
        )}
      </main>
    </div>
  );
}
