const whole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const fine = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const inr = (minor: number) => `₹${minor % 100 === 0 ? whole.format(minor / 100) : fine.format(minor / 100)}`;
export const day = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
export const monthName = (key: string) =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${key}-01T00:00:00Z`));
