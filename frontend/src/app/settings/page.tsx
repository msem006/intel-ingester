'use client';

import { useState, useEffect, FormEvent } from 'react';
import { Save, Key, Mail, CalendarDays, CheckCircle } from 'lucide-react';
import { Nav } from '@/components/Nav';
import { Spinner } from '@/components/Spinner';
import { useSettings, useUpdateSettings } from '@/lib/hooks';
import { useRequireAuth } from '@/lib/api';
import type { SettingsUpdate } from '@/lib/types';

export default function SettingsPage() {
  useRequireAuth();
  const { data: settings, isLoading, error } = useSettings();
  const updateSettings = useUpdateSettings();

  const [form, setForm] = useState<SettingsUpdate>({
    ses_from_email: '',
    ses_to_email: '',
    default_window_days: 7,
  });
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (settings) {
      setForm({
        ses_from_email: settings.ses_from_email,
        ses_to_email: settings.ses_to_email,
        default_window_days: settings.default_window_days,
      });
    }
  }, [settings]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setApiKey(localStorage.getItem('intel_api_key') || '');
    }
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    setSaved(false);
    try {
      await updateSettings.mutateAsync(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save settings');
    }
  }

  function handleSaveApiKey() {
    if (typeof window !== 'undefined') {
      localStorage.setItem('intel_api_key', apiKey);
      setApiKeySaved(true);
      setTimeout(() => setApiKeySaved(false), 3000);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      <Nav />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-xl font-bold text-zinc-100 mb-6">Settings</h1>

        {/* API key section — always visible, localStorage only, no API call needed */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-1">
            <Key size={14} className="text-zinc-400" />
            <h2 className="text-zinc-200 font-semibold text-sm">API Key</h2>
          </div>
          <p className="text-zinc-500 text-xs mb-4">
            Stored in browser localStorage only — not sent to the server as a setting.
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter API key"
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder:text-zinc-600 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-mono"
            />
            <button
              onClick={handleSaveApiKey}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors"
            >
              {apiKeySaved ? (
                <>
                  <CheckCircle size={13} className="text-emerald-400" />
                  Saved
                </>
              ) : (
                <>
                  <Save size={13} />
                  Save
                </>
              )}
            </button>
          </div>
        </div>

        {/* App settings form — requires valid API key */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-zinc-200 font-semibold text-sm mb-4">Application Settings</h2>
          {isLoading && <div className="flex justify-center py-6"><Spinner size={20} /></div>}
          {error && <div className="text-red-400 text-sm py-2">{error.message}</div>}
          {!isLoading && !error && <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="flex items-center gap-1.5 text-xs text-zinc-500 mb-1.5 uppercase tracking-wide">
                <Mail size={11} />
                From Email (SES)
              </label>
              <input
                type="email"
                value={form.ses_from_email ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, ses_from_email: e.target.value }))}
                placeholder="intel@example.com"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder:text-zinc-600 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-xs text-zinc-500 mb-1.5 uppercase tracking-wide">
                <Mail size={11} />
                To Email (SES)
              </label>
              <input
                type="email"
                value={form.ses_to_email ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, ses_to_email: e.target.value }))}
                placeholder="user@example.com"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 placeholder:text-zinc-600 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-xs text-zinc-500 mb-1.5 uppercase tracking-wide">
                <CalendarDays size={11} />
                Default Window (days)
              </label>
              <input
                type="number"
                min={1}
                value={form.default_window_days ?? 7}
                onChange={(e) =>
                  setForm((f) => ({ ...f, default_window_days: Number(e.target.value) }))
                }
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            {formError && (
              <div className="bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2 text-red-400 text-sm">
                {formError}
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={updateSettings.isPending}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {updateSettings.isPending ? (
                  <Spinner size={13} />
                ) : saved ? (
                  <CheckCircle size={13} className="text-emerald-300" />
                ) : (
                  <Save size={13} />
                )}
                {saved ? 'Saved!' : 'Save Settings'}
              </button>
            </div>
          </form>}
        </div>
      </main>
    </div>
  );
}
