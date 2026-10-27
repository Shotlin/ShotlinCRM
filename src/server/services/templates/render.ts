const allowedVariables = ['name', 'company', 'followUpDate'] as const;
export type TemplateVariable = (typeof allowedVariables)[number];

export function extractTemplateVariables(body: string): string[] {
  return [...body.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((match) => match[1]);
}

export function validateTemplate(body: string) {
  const unknown = extractTemplateVariables(body).filter(
    (name) => !allowedVariables.includes(name as TemplateVariable),
  );
  if (unknown.length) throw new Error(`Unknown template variables: ${[...new Set(unknown)].join(', ')}`);
}

export function renderTemplate(
  body: string,
  values: Partial<Record<TemplateVariable, string | undefined>>,
): string {
  validateTemplate(body);
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name: string) => values[name as TemplateVariable] ?? '');
}
