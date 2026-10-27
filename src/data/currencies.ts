import type { Currency, CurrencyRates } from './types';

export const CURRENCIES: Currency[] = ['INR', 'USD', 'EUR', 'GBP'];

export const CURRENCY_LABELS: Record<Currency, string> = {
  INR: 'Indian rupee',
  USD: 'US dollar',
  EUR: 'Euro',
  GBP: 'British pound',
};

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

export const CURRENCY_LOCALES: Record<Currency, string> = {
  INR: 'en-IN',
  USD: 'en-US',
  EUR: 'de-DE',
  GBP: 'en-GB',
};

// Static sample rates: each value is the amount of INR equal to one unit.
export const SAMPLE_RATES: CurrencyRates = {
  INR: 1,
  USD: 83,
  EUR: 90,
  GBP: 105,
};

export function convertMinor(
  amountMinor: number,
  from: Currency,
  to: Currency,
  rates: CurrencyRates = SAMPLE_RATES,
): number {
  return Math.round((amountMinor * rates[from]) / rates[to]);
}

export function formatMoney(amountMinor: number, currency: Currency): string {
  return new Intl.NumberFormat(CURRENCY_LOCALES[currency], {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

export function formatMoneyCompact(amountMinor: number, currency: Currency): string {
  return new Intl.NumberFormat(CURRENCY_LOCALES[currency], {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(amountMinor / 100);
}

export function lineItemTotalMinor(quantity: number, unitPriceMinor: number): number {
  return Math.round(quantity * unitPriceMinor);
}

export function lineItemsTotalMinor(items: { quantity: number; unitPriceMinor: number }[]): number {
  return items.reduce((total, item) => total + lineItemTotalMinor(item.quantity, item.unitPriceMinor), 0);
}
