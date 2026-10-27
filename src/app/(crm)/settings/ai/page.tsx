'use client';

import { Link } from '@/lib/router';
import { PageHeader } from '@/components/layout/PageHeader';
import { AiSettings } from './AiSettings';

export default function AiSettingsPage() {
  return (
    <div className="page settings-page">
      <PageHeader
        eyebrow="Settings / AI assistant"
        title="AI provider"
        description="Connect Claude, OpenAI, or OpenRouter. The dashboard stays useful even before a provider is connected."
        actions={<Link to="/ai" className="btn btn-secondary">Open AI assistant</Link>}
      />
      <AiSettings />
    </div>
  );
}
