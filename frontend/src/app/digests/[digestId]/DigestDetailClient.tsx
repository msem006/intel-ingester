'use client';

import { use } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, ExternalLink, TrendingUp, Lightbulb, Zap, Quote } from 'lucide-react';
import { Nav } from '@/components/Nav';
import { Spinner } from '@/components/Spinner';
import { useDigest } from '@/lib/hooks';
import type { SignalConfidence } from '@/lib/types';
import { useRequireAuth } from '@/lib/api';

const confidenceClasses: Record<SignalConfidence, string> = {
  high: 'bg-emerald-900/40 text-emerald-400 border-emerald-800/50',
  medium: 'bg-yellow-900/40 text-yellow-400 border-yellow-800/50',
  low: 'bg-zinc-800 text-zinc-400 border-zinc-700',
};

export default function DigestDetailPage({
  params,
}: {
  params: Promise<{ digestId: string }>;
}) {
  useRequireAuth();
  const { digestId } = use(params);
  const searchParams = useSearchParams();
  const topicId = searchParams.get('topicId') ?? '';

  const { data: digest, isLoading, error } = useDigest(topicId, digestId);

  if (isLoading)
    return (
      <div className="min-h-screen bg-zinc-950">
        <Nav />
        <div className="flex justify-center py-20">
          <Spinner size={24} />
        </div>
      </div>
    );

  if (error)
    return (
      <div className="min-h-screen bg-zinc-950">
        <Nav />
        <div className="max-w-4xl mx-auto px-4 py-8 text-red-400 text-sm">{error.message}</div>
      </div>
    );

  if (!digest) return null;

  const { synthesis } = digest;

  return (
    <div className="min-h-screen bg-zinc-950">
      <Nav />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Breadcrumb */}
        <div className="mb-6">
          {topicId ? (
            <Link
              href={`/topics/${topicId}`}
              className="flex items-center gap-1 text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
            >
              <ChevronLeft size={13} />
              Back to topic
            </Link>
          ) : (
            <Link
              href="/dashboard"
              className="flex items-center gap-1 text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
            >
              <ChevronLeft size={13} />
              Dashboard
            </Link>
          )}
        </div>

        {/* Meta */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-zinc-500 text-xs mb-2">
            <span>
              {new Date(digest.created_at).toLocaleDateString(undefined, {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
            <span>·</span>
            <span>{digest.item_count} items</span>
            <span>·</span>
            <span>{digest.window_days}d window</span>
            {digest.email_sent_at && (
              <>
                <span>·</span>
                <span className="text-emerald-500">Email sent</span>
              </>
            )}
          </div>
          <h1 className="text-2xl font-bold text-zinc-100">Intelligence Digest</h1>
        </div>

        {/* Summary hero */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
          <p className="text-zinc-200 text-base leading-relaxed">{synthesis.summary}</p>
        </div>

        {/* Top Trends */}
        {synthesis.top_trends.length > 0 && (
          <section className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp size={15} className="text-indigo-400" />
              <h2 className="text-zinc-200 font-semibold text-sm uppercase tracking-wide">
                Top Trends
              </h2>
            </div>
            <div className="space-y-3">
              {synthesis.top_trends.map((t, i) => (
                <div
                  key={i}
                  className="bg-zinc-900 border-l-2 border-indigo-500 border border-zinc-800 rounded-r-xl pl-4 pr-5 py-4"
                >
                  <p className="text-zinc-100 font-medium text-sm mb-1">{t.trend}</p>
                  <p className="text-zinc-400 text-sm">{t.evidence}</p>
                  {t.source_urls.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {t.source_urls.map((url, j) => (
                        <a
                          key={j}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                        >
                          <ExternalLink size={10} />
                          Source {j + 1}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Key Insights */}
        {synthesis.key_insights.length > 0 && (
          <section className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Lightbulb size={15} className="text-yellow-400" />
              <h2 className="text-zinc-200 font-semibold text-sm uppercase tracking-wide">
                Key Insights
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {synthesis.key_insights.map((ins, i) => (
                <div
                  key={i}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"
                >
                  <p className="text-zinc-100 text-sm font-medium mb-1.5">{ins.insight}</p>
                  <p className="text-zinc-500 text-xs leading-relaxed">{ins.implication}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Emerging Signals */}
        {synthesis.emerging_signals.length > 0 && (
          <section className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Zap size={15} className="text-indigo-400" />
              <h2 className="text-zinc-200 font-semibold text-sm uppercase tracking-wide">
                Emerging Signals
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {synthesis.emerging_signals.map((sig, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium ${confidenceClasses[sig.confidence]}`}
                >
                  {sig.signal}
                  <span className="opacity-60">{sig.confidence}</span>
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Notable Quotes */}
        {synthesis.notable_quotes.length > 0 && (
          <section className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Quote size={15} className="text-zinc-400" />
              <h2 className="text-zinc-200 font-semibold text-sm uppercase tracking-wide">
                Notable Quotes
              </h2>
            </div>
            <div className="space-y-3">
              {synthesis.notable_quotes.map((q, i) => (
                <blockquote
                  key={i}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4 border-l-2 border-l-zinc-600"
                >
                  <p className="text-zinc-200 text-sm italic mb-2">&ldquo;{q.quote}&rdquo;</p>
                  <footer className="flex items-center justify-between">
                    <cite className="text-zinc-500 text-xs not-italic">{q.attribution}</cite>
                    <a
                      href={q.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      <ExternalLink size={10} />
                      Source
                    </a>
                  </footer>
                </blockquote>
              ))}
            </div>
          </section>
        )}

        {/* Sources table */}
        {synthesis.sources.length > 0 && (
          <section>
            <h2 className="text-zinc-500 text-xs uppercase tracking-wide font-medium mb-3">
              Sources ({synthesis.sources.length})
            </h2>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide font-medium">
                      Title
                    </th>
                    <th className="text-left px-4 py-3 text-xs text-zinc-500 uppercase tracking-wide font-medium hidden sm:table-cell">
                      Score
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {synthesis.sources.map((src, i) => (
                    <tr key={i} className="hover:bg-zinc-800/20 transition-colors">
                      <td className="px-4 py-3">
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-zinc-300 hover:text-indigo-300 transition-colors"
                        >
                          <ExternalLink size={11} className="shrink-0 text-zinc-600" />
                          <span className="truncate">{src.title}</span>
                        </a>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span
                          className={`text-xs font-medium ${
                            src.score >= 8
                              ? 'text-emerald-400'
                              : src.score >= 6
                              ? 'text-yellow-400'
                              : 'text-zinc-500'
                          }`}
                        >
                          {src.score.toFixed(1)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
