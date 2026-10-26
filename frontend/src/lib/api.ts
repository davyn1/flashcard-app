import { useSyncExternalStore } from 'react'

export const API_URL = String(import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/+$/, '')

export class AuthError extends Error {}
export class NetworkError extends Error {}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

// ---------------------------------------------------------------------------
// Auth state (token persisted in localStorage so the phone stays logged in)
// ---------------------------------------------------------------------------

interface AuthState {
  token: string | null
  expiresAt: number | null
  /** The server rejected the token (expired/rotated). Studying continues; sync waits for the password. */
  needsReauth: boolean
}

const STORAGE_KEY = 'fc_auth'
let state: AuthState = load()
const listeners = new Set<() => void>()

function load(): AuthState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { needsReauth: false, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return { token: null, expiresAt: null, needsReauth: false }
}

function save(next: AuthState) {
  state = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable: keep in memory */
  }
  for (const fn of listeners) fn()
}

export function getAuth(): AuthState {
  return state
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => state,
  )
}

export function markNeedsReauth() {
  if (!state.needsReauth) save({ ...state, needsReauth: true })
}

export function clearAuth() {
  save({ token: null, expiresAt: null, needsReauth: false })
}

/** A token exists, isn't known to be expired, and the server hasn't rejected it. */
export function canSync(): boolean {
  return !!state.token && !state.needsReauth && (!state.expiresAt || state.expiresAt > Date.now())
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function request<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (auth && state.token) headers.set('Authorization', `Bearer ${state.token}`)
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers })
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : 'Network error')
  }
  if (res.status === 401) {
    if (auth) markNeedsReauth()
    throw new AuthError('Not authenticated')
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, detail || `HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

export async function login(password: string): Promise<void> {
  try {
    const res = await request<{ token: string; expires_at: number }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ password }) },
      false,
    )
    save({ token: res.token, expiresAt: res.expires_at, needsReauth: false })
  } catch (e) {
    if (e instanceof AuthError) throw new AuthError('Incorrect password')
    throw e
  }
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path)
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) })
}
