'use client';

import { KeyRound, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AiSettingsView } from '@/data/ai';
import { useToast } from '@/components/ui/Toast';

const defaultModels: Record<AiSettingsView['provider'], string> = {
  anthropic: 'claude-sonnet-4-5',
  openai: 'gpt-5-mini',
  openrouter: 'anthropic/claude-sonnet-4.5',
};

const providerLabels: Record<AiSettingsView['provider'], string> = {
  anthropic: 'Claude · Anthropic official API',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
};

async function readError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? fallback;
}

export function AiSettings() {
  const [settings, setSettings] = useState<AiSettingsView | null>(null);
  const [provider, setProvider] = useState<AiSettingsView['provider']>('anthropic');
  const [model, setModel] = useState(defaultModels.anthropic);
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [autoDraftEnabled, setAutoDraftEnabled] = useState(true);
  const [redactIdentifiers, setRedactIdentifiers] = useState(true);
  const [firstResponseMinutes, setFirstResponseMinutes] = useState(60);
  const [monthlyTokenBudget, setMonthlyTokenBudget] = useState(1_000_000);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const { notify } = useToast();

  const applySettings = useCallback((payload: AiSettingsView) => {
    setSettings(payload);
    setProvider(payload.provider);
    setModel(payload.model);
    setEnabled(payload.enabled);
    setAutoDraftEnabled(payload.autoDraftEnabled);
    setRedactIdentifiers(payload.redactIdentifiers);
    setFirstResponseMinutes(payload.firstResponseMinutes);
    setMonthlyTokenBudget(payload.monthlyTokenBudget);
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/ai/settings', { cache: 'no-store' });
      if (!response.ok) throw new Error(await readError(response, 'AI settings could not be loaded'));
      applySettings((await response.json()) as AiSettingsView);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'AI settings could not be loaded');
    } finally {
      setLoading(false);
    }
  }, [applySettings, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeProvider = (next: AiSettingsView['provider']) => {
    setProvider(next);
    setModel(defaultModels[next]);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusyAction('save');
    try {
      const response = await fetch('/api/ai/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model,
          apiKey: apiKey.trim() || undefined,
          enabled,
          autoDraftEnabled,
          redactIdentifiers,
          firstResponseMinutes,
          monthlyTokenBudget,
        }),
      });
      if (!response.ok) throw new Error(await readError(response, 'AI settings could not be saved'));
      applySettings((await response.json()) as AiSettingsView);
      setApiKey('');
      notify('AI provider settings saved');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'AI settings could not be saved');
    } finally {
      setBusyAction(null);
    }
  };

  const test = async () => {
    setBusyAction('test');
    try {
      const response = await fetch('/api/ai/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model,
          apiKey: apiKey.trim() || undefined,
        }),
      });
      if (!response.ok) throw new Error(await readError(response, 'Provider test failed'));
      notify('Provider connection verified');
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Provider test failed');
    } finally {
      setBusyAction(null);
    }
  };

  const backfill = async () => {
    if (
      !window.confirm(
        'Analyze all existing messages? This can use a meaningful amount of your provider budget.',
      )
    ) {
      return;
    }
    setBusyAction('backfill');
    try {
      const response = await fetch('/api/ai/settings/backfill', { method: 'POST' });
      if (!response.ok) throw new Error(await readError(response, 'History could not be queued'));
      const result = (await response.json()) as {
        queued: number;
        skipped: number;
        failed: number;
        budgetSkipped: number;
        total: number;
      };
      notify(
        `${result.queued} messages queued, ${result.skipped} already analyzed${
          result.budgetSkipped ? `, ${result.budgetSkipped} deferred by budget` : ''
        }${result.failed ? `, ${result.failed} could not queue` : ''}`,
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : 'History could not be queued');
    } finally {
      setBusyAction(null);
    }
  };

  if (loading) {
    return (
      <div className="route-loading" role="status">
        <span className="route-loading-mark" aria-hidden="true" />
        Loading AI settings
      </div>
    );
  }

  return (
    <div className="ai-settings">
      <section className="card settings-panel">
        <div className="settings-panel-head">
          <div className="settings-icon"><KeyRound size={18} /></div>
          <div>
            <h2>Model provider</h2>
            <p>Your API key is encrypted on the server and never returned to this browser.</p>
          </div>
          <span className={`connection-status ${settings?.configured ? 'connected' : ''}`}>
            {settings?.configured ? 'Key stored' : 'Not configured'}
          </span>
        </div>
        <form className="ai-settings-form" onSubmit={save}>
          <label className="field">
            <span>Provider</span>
            <select value={provider} onChange={(event) => changeProvider(event.target.value as AiSettingsView['provider'])}>
              {(Object.keys(providerLabels) as AiSettingsView['provider'][]).map((value) => (
                <option key={value} value={value}>{providerLabels[value]}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Model</span>
            <input value={model} onChange={(event) => setModel(event.target.value)} maxLength={120} required />
          </label>
          <label className="field">
            <span>API key</span>
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={settings?.hasApiKey ? 'Leave blank to keep the stored key' : 'Paste your provider API key'}
              minLength={apiKey ? 10 : undefined}
              maxLength={500}
            />
          </label>
          <label className="field">
            <span>First response target (minutes)</span>
            <input
              type="number"
              min={5}
              max={10080}
              value={firstResponseMinutes}
              onChange={(event) => setFirstResponseMinutes(Number(event.target.value))}
            />
          </label>
          <label className="field">
            <span>Monthly token budget</span>
            <input
              type="number"
              min={10000}
              max={100000000}
              step={10000}
              value={monthlyTokenBudget}
              onChange={(event) => setMonthlyTokenBudget(Number(event.target.value))}
            />
          </label>
          <div className="ai-setting-toggles">
            <label><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Enable AI analysis and drafts</label>
            <label><input type="checkbox" checked={autoDraftEnabled} onChange={(event) => setAutoDraftEnabled(event.target.checked)} /> Draft replies automatically for new inbound messages</label>
            <label><input type="checkbox" checked={redactIdentifiers} onChange={(event) => setRedactIdentifiers(event.target.checked)} /> Redact phone numbers and email addresses before provider calls</label>
          </div>
          <div className="setting-warning">
            <ShieldCheck size={16} />
            <p>
              Analysis sends conversation and CRM evidence to your chosen provider. Nothing is sent
              automatically to clients, and drafts always require manual review.
            </p>
          </div>
          <div className="ai-settings-actions">
            <button type="submit" className="btn btn-primary" disabled={busyAction === 'save'}>
              {busyAction === 'save' ? 'Saving…' : 'Save provider'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void test()} disabled={busyAction === 'test'}>
              {busyAction === 'test' ? 'Testing…' : 'Test connection'}
            </button>
            <span className="ai-usage">
              {settings?.usageThisMonth.toLocaleString('en-IN') ?? 0} tokens used this month
            </span>
          </div>
          {settings?.lastTestError ? <p className="setting-error">{settings.lastTestError}</p> : null}
        </form>
      </section>

      <section className="card settings-panel">
        <div className="settings-panel-head">
          <div className="settings-icon"><Sparkles size={18} /></div>
          <div>
            <h2>Existing conversation history</h2>
            <p>Backfill analyzes saved messages in the worker. New messages are queued automatically.</p>
          </div>
        </div>
        <div className="ai-backfill-body">
          <p>
            Run this once after configuring a provider. Already analyzed messages are skipped.
            Backfill never creates automatic drafts.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void backfill()}
            disabled={!settings?.configured || !settings.enabled || busyAction === 'backfill'}
          >
            <RefreshCw size={14} /> {busyAction === 'backfill' ? 'Queueing…' : 'Analyze all messages'}
          </button>
        </div>
      </section>
    </div>
  );
}
