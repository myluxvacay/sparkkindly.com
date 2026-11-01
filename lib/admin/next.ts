import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { ADMIN_COOKIE } from './guard';
import { csrfToken, getAdmin, pendingEmail } from './sessions';

// Next glue for admin pages. Every admin page calls requireAdmin() itself (a test checks this), because a layout
// check alone does not guard a page.

export async function sessionToken(): Promise<string> {
  return (await cookies()).get(ADMIN_COOKIE)?.value ?? '';
}

export async function currentAdmin(): Promise<{ email: string; csrf: string } | null> {
  const token = await sessionToken();
  const admin = await getAdmin(getDb(), token, process.env, new Date());
  return admin ? { email: admin.email, csrf: csrfToken(token) } : null;
}

export async function requireAdmin(): Promise<{ email: string; csrf: string }> {
  const admin = await currentAdmin();
  if (!admin) redirect('/admin/sign-in/');
  return admin;
}

// For the code page: the session that used its link but has not given its code yet.
export async function requirePending(): Promise<{ email: string; csrf: string }> {
  const token = await sessionToken();
  const email = await pendingEmail(getDb(), token, new Date());
  if (!email) redirect('/admin/sign-in/');
  return { email, csrf: csrfToken(token) };
}
