'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2, ChevronRight } from 'lucide-react';
import { Nav } from '@/components/Nav';
import { Spinner } from '@/components/Spinner';
import { StatusBadge } from '@/components/StatusBadge';
import { useTopics, useCreateTopic, useDeleteTopic } from '@/lib/hooks';
import type { TopicCreate } from '@/lib/types';

function NewTopicForm({ onClose }: { onClose: () => void }) {
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
    <div className="bg-zinc-900 border border-indigo-800/50 rounded-xl p-5 mb-4">
      <h3 className="text-zinc-200 font-semibold text-sm mb-4">New Topic</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wide">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="AI Research"
              required
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder:text-zinc-600 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wide">
              Window (days)
            </label>
            <input
              type="number"
              min={1}
              value={form.window_days}
              onChange={(e) => setForm((f) => ({ ...f, window_days: Number(e.target.value) }))}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wide">
            Description
          </label>
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="What intelligence should this topic track?"
            required
            rows={2}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder:text-zinc-600 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
          />
        </div>
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={createTopic.isPending}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {createTopic.isPending && <Spinner size={12} />}
            Create Topic
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

export default function TopicsPage() {
  const { data: topics, isLoading, error } = useTopics();
  const deleteTopic = useDeleteTopic();
  const [showForm, setShowForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  async function handleDelete(id: string) {
    if (deleteConfirm !== id) {
      setDeleteConfirm(id);
      return;
    }
    try {
      await deleteTopic.mutateAsync(id);
    } catch {
      // error handled silently — user can retry
    }
    setDeleteConfirm(null);
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      <Nav />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-zinc-100">Topics</h1>
            <p className="text-zinc-500 text-sm mt-0.5">Manage intelligence topics</p>
          </div>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={14} />
            New Topic
          </button>
        </div>

        {showForm && <NewTopicForm onClose={() => setShowForm(false)} />}

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

        {topics && topics.length === 0 && (
          <div className="text-center py-16 text-zinc-600 text-sm">No topics yet.</div>
        )}

        {topics && topics.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide font-medium">
                    Name
                  </th>
                  <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide font-medium hidden md:table-cell">
                    Description
                  </th>
                  <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide font-medium hidden sm:table-cell">
                    Window
                  </th>
                  <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide font-medium">
                    Status
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {topics.map((topic) => (
                  <tr key={topic.topic_id} className="hover:bg-zinc-800/30 transition-colors group">
                    <td className="px-4 py-3">
                      <Link
                        href={`/topics/${topic.topic_id}`}
                        className="flex items-center gap-1 text-zinc-200 hover:text-indigo-300 font-medium transition-colors"
                      >
                        {topic.name}
                        <ChevronRight
                          size={12}
                          className="text-zinc-600 group-hover:text-indigo-400 transition-colors"
                        />
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-zinc-500 max-w-xs hidden md:table-cell">
                      <span className="truncate block">{topic.description}</span>
                    </td>
                    <td className="px-4 py-3 text-zinc-400 hidden sm:table-cell">
                      {topic.window_days}d
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        label={topic.enabled ? 'enabled' : 'disabled'}
                        variant={topic.enabled ? 'enabled' : 'disabled'}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(topic.topic_id)}
                        disabled={deleteTopic.isPending && deleteConfirm === topic.topic_id}
                        className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
                          deleteConfirm === topic.topic_id
                            ? 'bg-red-900/40 text-red-400 hover:bg-red-900/60'
                            : 'text-zinc-600 hover:text-red-400 hover:bg-zinc-800'
                        }`}
                      >
                        {deleteTopic.isPending && deleteConfirm === topic.topic_id ? (
                          <Spinner size={11} />
                        ) : (
                          <Trash2 size={11} />
                        )}
                        {deleteConfirm === topic.topic_id ? 'Confirm delete' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
