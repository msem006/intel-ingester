'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, RefreshCw, Sparkles, BookOpen, CalendarDays, Layers } from 'lucide-react';
import { Nav } from '@/components/Nav';
import { Spinner } from '@/components/Spinner';
import { useTopics, useCreateTopic, useTriggerScan, useTriggerSynthesis } from '@/lib/hooks';
import { useRequireAuth } from '@/lib/api';
import type { Topic, TopicCreate } from '@/lib/types';

type OpState =
  | { kind: 'idle' }
  | { kind: 'running'; label: string; hint: string; color: 'amber' | 'indigo' }
  | { kind: 'error'; message: string };

function StatusPill({ state }: { state: OpState }) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'error') {
    return (
      <div className="mt-3 flex items-center gap-1.5 text-xs text-red-400">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
        {state.message}
      </div>
    );
  }
  const dot = state.color === 'amber' ? 'bg-amber-400 animate-pulse' : 'bg-indigo-400 animate-pulse';
  const text = state.color === 'amber' ? 'text-amber-300' : 'text-indigo-300';
  return (
    <div className="mt-3 flex flex-col gap-0.5">
      <div className={`flex items-center gap-1.5 text-xs font-medium ${text}`}>
        <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
        {state.label}
      </div>
      <p className="text-xs text-zinc-500 pl-3">{state.hint}</p>
    </div>
  );
}

function TopicCard({ topic }: { topic: Topic }) {
  const router = useRouter();
  const triggerScan = useTriggerScan();
  const triggerSynthesis = useTriggerSynthesis();
  const [scanState, setScanState] = useState<OpState>({ kind: 'idle' });
  const [synthState, setSynthState] = useState<OpState>({ kind: 'idle' });

  function handleScan(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setScanState({ kind: 'idle' });
    setSynthState({ kind: 'idle' });
    triggerScan.mutate(topic.topic_id, {
      onSuccess: (res) => {
        if (res.status === 'no_sources') {
          setScanState({ kind: 'error', message: 'No sources configured — add a source first.' });
        } else {
          const n = res.sources_triggered;
          setScanState({
            kind: 'running',
            label: `Scanning ${n} source${n !== 1 ? 's' : ''}…`,
            hint: `Workers run for ~2–5 min. Run Synthesise once complete.`,
            color: 'amber',
          });
        }
      },
      onError: (err) => setScanState({ kind: 'error', message: err.message }),
    });
  }

  function handleSynthesis(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setScanState({ kind: 'idle' });
    setSynthState({ kind: 'idle' });
    triggerSynthesis.mutate({ topicId: topic.topic_id }, {
      onSuccess: () => {
        setSynthState({
          kind: 'running',
          label: 'Synthesising…',
          hint: 'AI digest generates in ~5–10 min and will be emailed to you.',
          color: 'indigo',
        });
      },
      onError: (err) => setSynthState({ kind: 'error', message: err.message }),
    });
  }

  const activeState: OpState =
    synthState.kind !== 'idle' ? synthState :
    scanState.kind !== 'idle' ? scanState :
    { kind: 'idle' };

  return (
    <div
      onClick={() => router.push(`/topics/${topic.topic_id}`)}
      className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 cursor-pointer hover:border-zinc-700 transition-colors group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-zinc-100 font-semibold truncate group-hover:text-indigo-300 transition-colors">
            {topic.name}
          </h3>
          <p className="text-zinc-500 text-sm mt-0.5 line-clamp-2">{topic.description}</p>
        </div>
        {!topic.enabled && (
          <span className="ml-2 shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-zinc-800 text-zinc-500">
            disabled
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-zinc-500 mb-4">
        <span className="flex items-center gap-1">
          <CalendarDays size={11} />
          {topic.window_days}d window
        </span>
        <span className="flex items-center gap-1">
          <Layers size={11} />
          {topic.updated_at ? `Updated ${new Date(topic.updated_at).toLocaleDateString()}` : '—'}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleScan}
          disabled={triggerScan.isPending || triggerSynthesis.isPending}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-50 text-xs font-medium transition-colors"
        >
          {triggerScan.isPending ? <Spinner size={11} /> : <RefreshCw size={11} />}
          Run Scan
        </button>
        <button
          onClick={handleSynthesis}
          disabled={triggerSynthesis.isPending || triggerScan.isPending}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
        >
          {triggerSynthesis.isPending ? <Spinner size={11} /> : <Sparkles size={11} />}
          Synthesise
        </button>
      </div>

      <StatusPill state={activeState} />
    </div>
  );
}

function AddTopicInlineForm({ onClose }: { onClose: () => void }) {
  const createTopic = useCreateTopic();
  const [form, setForm] = useState<TopicCreate>({ name: '', description: '', window_days: 7 });
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await createTopic.mutateAsync(form);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create topic');
    }
  }

  return (
    <div className="bg-zinc-900 border border-indigo-800/50 rounded-xl p-5">
      <h3 className="text-zinc-200 font-semibold text-sm mb-4">New Topic</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="Topic name"
          required
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder:text-zinc-600 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
        />
        <textarea
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Description"
          required
          rows={2}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder:text-zinc-600 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
        />
        <div className="flex items-center gap-2">
          <label className="text-xs text-zinc-500 shrink-0">Window (days)</label>
          <input
            type="number"
            min={1}
            value={form.window_days}
            onChange={(e) => setForm((f) => ({ ...f, window_days: Number(e.target.value) }))}
            className="w-20 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={createTopic.isPending}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {createTopic.isPending ? <Spinner size={12} /> : null}
            Create
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

export default function DashboardPage() {
  useRequireAuth();
  const { data: topics, isLoading, error } = useTopics();
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="min-h-screen bg-zinc-950">
      <Nav />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-zinc-100">Dashboard</h1>
            <p className="text-zinc-500 text-sm mt-0.5">
              {topics ? `${topics.length} topic${topics.length !== 1 ? 's' : ''}` : 'Loading…'}
            </p>
          </div>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={14} />
            Add Topic
          </button>
        </div>

        {showForm && (
          <div className="mb-6">
            <AddTopicInlineForm onClose={() => setShowForm(false)} />
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Spinner size={24} />
          </div>
        )}

        {error && (
          <div className="bg-red-950/30 border border-red-900/50 rounded-xl px-4 py-3 text-red-400 text-sm">
            {error.message}
          </div>
        )}

        {topics && topics.length === 0 && !showForm && (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-zinc-900 border border-zinc-800 mb-4">
              <BookOpen size={24} className="text-zinc-600" />
            </div>
            <h3 className="text-zinc-300 font-medium mb-1">No topics yet</h3>
            <p className="text-zinc-600 text-sm mb-4">
              Create a topic to start ingesting and synthesising intelligence.
            </p>
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 mx-auto bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <Plus size={14} />
              Add Topic
            </button>
          </div>
        )}

        {topics && topics.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {topics.map((topic) => (
              <TopicCard key={topic.topic_id} topic={topic} />
            ))}
          </div>
        )}

        {/* Quick links */}
        {topics && topics.length > 0 && (
          <div className="mt-8 border-t border-zinc-800 pt-6">
            <Link
              href="/topics"
              className="text-zinc-500 hover:text-indigo-400 text-sm transition-colors"
            >
              Manage all topics →
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
