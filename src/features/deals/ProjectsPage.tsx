'use client';

import { CalendarClock, FolderKanban, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Link } from '@/lib/router';
import { day, inr } from '../gst/format';

type Project = {
  id: string;
  title: string;
  status: string;
  client: string;
  startsOn: string | null;
  dueOn: string | null;
  milestonesTotal: number;
  milestonesAccepted: number;
  totalMinor: number;
  invoicedMinor: number;
};

export const PROJECT_STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: 'Active', tone: 'green' },
  on_hold: { label: 'On hold', tone: 'amber' },
  completed: { label: 'Completed', tone: 'blue' },
  cancelled: { label: 'Cancelled', tone: 'red' },
};

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/projects/overview', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load projects.');
        return ((await response.json()) as { projects: Project[] }).projects;
      })
      .then(setProjects)
      .catch((problem: Error) => setError(problem.message));
  }, []);

  return (
    <div className="bk-page">
      <PageHeader eyebrow="Delivery" title="Projects" description="Every project starts from a signed agreement. Track the brief, timeline, milestones and the invoice for each one." />
      {error ? <p className="bk-error" role="alert">{error}</p> : null}
      {!projects ? (
        !error ? <p className="bk-loading"><LoaderCircle className="spin" size={18} aria-hidden="true" /> Loading…</p> : null
      ) : projects.length === 0 ? (
        <section className="bk-card">
          <p className="bk-empty">No projects yet. Open an agreement and press “Create project”.</p>
          <Link to="/agreements" className="btn btn-primary">Go to agreements</Link>
        </section>
      ) : (
        <div className="bk-projects">
          {projects.map((project) => {
            const percent = project.milestonesTotal ? Math.round((project.milestonesAccepted / project.milestonesTotal) * 100) : 0;
            return (
              <Link key={project.id} to={`/projects/${project.id}`} className="bk-project">
                <div className="bk-project-top">
                  <span className="bk-project-icon"><FolderKanban size={18} aria-hidden="true" /></span>
                  <span className={`bk-chip bk-tone-${PROJECT_STATUS[project.status]?.tone ?? 'violet'}`}>{PROJECT_STATUS[project.status]?.label ?? project.status}</span>
                </div>
                <h3>{project.title}</h3>
                <p className="bk-sub">{project.client}</p>
                <div className="bk-bar"><span style={{ width: `${Math.max(percent, 3)}%`, background: '#5b3df5' }} /></div>
                <p className="bk-sub">{project.milestonesAccepted} of {project.milestonesTotal} milestones accepted · {inr(project.invoicedMinor)} of {inr(project.totalMinor)} invoiced</p>
                {project.dueOn ? <p className="bk-sub"><CalendarClock size={13} aria-hidden="true" /> Due {day(project.dueOn)}</p> : null}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
