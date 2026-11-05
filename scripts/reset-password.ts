// Run only on the CRM server by an administrator. The password is read directly
// from the terminal (without echoing it) and is never written to a command line,
// log, database export, or chat.
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { eq } from 'drizzle-orm';
import { db, pool } from '../src/server/db/client';
import { users } from '../src/server/db/schema';
import { hashPassword } from '../src/server/auth/password';

function validPassword(value: string) {
  return value.length >= 14 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
}

async function askSecret(prompt: string) {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Run this command in an interactive SSH terminal.');
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise<string>((resolve, reject) => {
    let value = '';
    const done = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
    };
    const onData = (key: string) => {
      if (key === '\u0003') {
        done();
        reject(new Error('Cancelled'));
      } else if (key === '\r' || key === '\n') {
        done();
        resolve(value);
      } else if (key === '\u007f' || key === '\b') {
        value = value.slice(0, -1);
      } else if (key >= ' ') {
        value += key;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const provided = process.argv[2]?.trim().toLowerCase();
  const line = createInterface({ input: stdin, output: stdout });
  const email = provided || (await line.question('Owner email: ')).trim().toLowerCase();
  line.close();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Use a valid email address.');

  const password = await askSecret('New password (14+ chars, upper/lower/number/symbol): ');
  const confirm = await askSecret('Repeat new password: ');
  if (password !== confirm) throw new Error('The passwords do not match. Nothing was changed.');
  if (!validPassword(password)) throw new Error('Use at least 14 characters with an uppercase letter, lowercase letter, number and symbol.');

  const [account] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!account) throw new Error('No CRM user exists with that email address.');
  await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, account.id));
  console.log(`Password updated for ${email}. You can now sign in.`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Password reset failed.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
