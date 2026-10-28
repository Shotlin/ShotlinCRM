// Where a signature goes on the PDF. Positions are fractions of the page (0 to 1) measured from the top left,
// so they stay right whatever size the page is shown at. Safe to import in the browser.
export type SignField = {
  id: string;
  role: 'client' | 'developer';
  page: number; // 1-based
  x: number;
  y: number;
  w: number;
  h: number;
};

export const FIELD_LABEL: Record<SignField['role'], string> = {
  client: 'Client signs here',
  developer: 'Shotlin signs here',
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

// Keeps a box fully inside its page and not absurdly small.
export function fitField(field: SignField): SignField {
  const w = clamp(field.w, 0.08, 0.9);
  const h = clamp(field.h, 0.025, 0.4);
  return { ...field, w, h, x: clamp(field.x, 0, 1 - w), y: clamp(field.y, 0, 1 - h), page: Math.max(1, Math.floor(field.page)) };
}
