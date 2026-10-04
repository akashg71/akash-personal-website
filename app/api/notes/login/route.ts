import { NextResponse } from 'next/server'
import { checkPassword, createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from '@/lib/notes'

// Plain HTML form POST → 303 redirect back to /notes. No client JS involved.
export async function POST(request: Request) {
  const form = await request.formData()
  const password = String(form.get('password') ?? '')

  if (!checkPassword(password)) {
    // Not a real rate limit (serverless, no shared state) — just makes online
    // guessing slower. The actual defence is a long random NOTES_PASSWORD.
    await new Promise(r => setTimeout(r, 500))
    return NextResponse.redirect(new URL('/notes?error=1', request.url), 303)
  }

  const res = NextResponse.redirect(new URL('/notes', request.url), 303)
  res.cookies.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  })
  return res
}
