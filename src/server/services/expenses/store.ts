import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '../../db/client';
import { expenses } from '../../db/schema';
import { EXPENSE_CATEGORIES, PAYEE_TYPES } from './categories';
import type { ExpenseRow } from './summary';

const categoryIds = EXPENSE_CATEGORIES.map((c) => c.id) as [string, ...string[]];
const payeeIds = PAYEE_TYPES.map((p) => p.id) as [string, ...string[]];

// Amounts arrive in rupees from the form and are stored as paise.
export const expenseInputSchema = z
  .object({
    spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date'),
    title: z.string().trim().min(1, 'What was it for?').max(160),
    category: z.enum(categoryIds),
    payeeName: z.string().trim().min(1, 'Who was paid?').max(160),
    payeeType: z.enum(payeeIds).default('vendor'),
    amountRupees: z.number().positive('Enter the amount').max(100_000_000),
    gstRupees: z.number().min(0).max(100_000_000).default(0),
    itcEligible: z.boolean().default(false),
    planned: z.boolean().default(true),
    recurring: z.boolean().default(false),
    method: z.string().trim().max(60).default(''),
    note: z.string().trim().max(500).default(''),
  })
  .superRefine((value, ctx) => {
    if (value.gstRupees > value.amountRupees) ctx.addIssue({ code: 'custom', path: ['gstRupees'], message: 'GST cannot be more than the amount' });
  });
export type ExpenseInput = z.infer<typeof expenseInputSchema>;

const toPaise = (rupees: number) => Math.round(rupees * 100);
const values = (input: ExpenseInput) => ({
  spentAt: new Date(`${input.spentOn}T00:00:00+05:30`),
  title: input.title,
  category: input.category,
  payeeName: input.payeeName,
  payeeType: input.payeeType,
  amountMinor: toPaise(input.amountRupees),
  gstMinor: toPaise(input.gstRupees),
  itcEligible: input.itcEligible && input.gstRupees > 0,
  planned: input.planned,
  recurring: input.recurring,
  method: input.method,
  note: input.note,
});

export async function listExpenses(workspaceId: string): Promise<ExpenseRow[]> {
  const rows = await db.select().from(expenses).where(eq(expenses.workspaceId, workspaceId)).orderBy(desc(expenses.spentAt));
  return rows.map((r) => ({
    id: r.id, spentAt: r.spentAt, title: r.title, category: r.category, payeeName: r.payeeName, payeeType: r.payeeType,
    amountMinor: r.amountMinor, gstMinor: r.gstMinor, itcEligible: r.itcEligible, planned: r.planned, recurring: r.recurring, method: r.method, note: r.note,
  }));
}

export async function createExpense(workspaceId: string, input: ExpenseInput) {
  const id = `expense-${randomUUID()}`;
  await db.insert(expenses).values({ id, workspaceId, ...values(input) });
  return id;
}

export async function updateExpense(workspaceId: string, id: string, input: ExpenseInput) {
  const result = await db.update(expenses).set(values(input)).where(and(eq(expenses.id, id), eq(expenses.workspaceId, workspaceId))).returning({ id: expenses.id });
  if (result.length === 0) throw new Error('Expense not found');
}

export async function deleteExpense(workspaceId: string, id: string) {
  const result = await db.delete(expenses).where(and(eq(expenses.id, id), eq(expenses.workspaceId, workspaceId))).returning({ id: expenses.id });
  if (result.length === 0) throw new Error('Expense not found');
}
