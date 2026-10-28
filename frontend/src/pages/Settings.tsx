import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { SyncIndicator } from '../components/SyncIndicator'
import { Button, Page, inputClass } from '../components/ui'
import { API_URL, clearAuth } from '../lib/api'
import { downloadJson, exportAll, importBackup } from '../lib/backup'
import { db } from '../lib/db'
import { navigate } from '../lib/router'
import {
  getVoicePreference,
  setVoicePreference,
  speakKorean,
  useKoreanVoice,
  useKoreanVoices,
  voiceGender,
} from '../lib/speech'
import { syncNow, useSyncState } from '../lib/sync'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export default function Settings() {
  const sync = useSyncState()
  const pending = useLiveQuery(() => db.outbox.count(), []) ?? 0
  const voice = useKoreanVoice()
  const voices = useKoreanVoices()
  const [voicePref, setVoicePref] = useState(getVoicePreference)
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function doExport() {
    const data = await exportAll()
    const date = new Date().toISOString().slice(0, 10)
    downloadJson(data, `korean-flashcards-${date}.json`)
  }

  async function doImport(file: File) {
    setMessage(null)
    try {
      const n = await importBackup(JSON.parse(await file.text()))
      setMessage(`Imported ${n} record${n === 1 ? '' : 's'}.`)
      void syncNow()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Import failed.')
    }
  }

  async function logout() {
    const warn = pending
      ? `${pending} change(s) haven't synced yet and will be lost. Log out anyway?`
      : 'Log out? Local data on this device will be cleared (it stays on the server).'
    if (!confirm(warn)) return
    await db.transaction('rw', [db.decks, db.cards, db.card_states, db.reviews, db.outbox, db.meta], async () => {
      await Promise.all([db.decks, db.cards, db.card_states, db.reviews, db.outbox, db.meta].map((t) => t.clear()))
    })
    clearAuth()
    navigate('/', { replace: true })
  }

  return (
    <Page title="Settings" back="/">
      <div className="flex flex-col gap-4">
        <Section title="Sync">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-slate-600 dark:text-slate-400">
              {sync.lastSyncedAt ? `Last synced ${new Date(sync.lastSyncedAt).toLocaleTimeString()}` : 'Not synced yet'}
              {pending > 0 && ` · ${pending} change${pending === 1 ? '' : 's'} waiting`}
              {sync.error && <div className="text-rose-600 dark:text-rose-400">{sync.error}</div>}
            </div>
            <SyncIndicator />
          </div>
          <Button className="mt-3 w-full" onClick={() => void syncNow()}>
            Sync now
          </Button>
        </Section>

        <Section title="Backup">
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
            Export everything (decks, cards, progress, review history) as JSON. Importing merges a backup into your
            data; newer versions of each record win and nothing is deleted.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={doExport}>Export JSON</Button>
            <Button onClick={() => fileRef.current?.click()}>Import JSON</Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void doImport(f)
              e.target.value = ''
            }}
          />
          {message && <p className="mt-3 text-sm">{message}</p>}
        </Section>

        <Section title="Pronunciation voice">
          {voices.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              No Korean voice on this device, so the speaker button is hidden. On iPhone, add one under Settings →
              Accessibility → Spoken Content → Voices → Korean.
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
                Automatic picks a female voice when this device has one. This choice is saved on this device only.
              </p>
              <div className="flex gap-2">
                <select
                  className={inputClass}
                  aria-label="Korean voice"
                  value={voicePref && voices.some((v) => v.voiceURI === voicePref) ? voicePref : ''}
                  onChange={(e) => {
                    const uri = e.target.value || null
                    setVoicePreference(uri)
                    setVoicePref(uri)
                  }}
                >
                  <option value="">Automatic{voice && !voicePref ? ` (${voice.name})` : ''}</option>
                  {voices.map((v) => {
                    const g = voiceGender(v)
                    return (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name}
                        {g === 'unknown' ? '' : ` · ${g}`}
                      </option>
                    )
                  })}
                </select>
                <Button onClick={() => speakKorean('안녕하세요', voice)} disabled={!voice}>
                  Test
                </Button>
              </div>
            </>
          )}
        </Section>

        <Section title="About">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-500">Server</dt>
            <dd className="truncate">{API_URL}</dd>
          </dl>
        </Section>

        <Button variant="danger" onClick={logout}>
          Log out
        </Button>
      </div>
    </Page>
  )
}
