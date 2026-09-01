import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router-dom'

import Upload from './pages/Upload'
import Dashboard from './pages/Dashboard'
import SessionDetail from './pages/SessionDetail'
import ExportPage from './pages/Export'
import { health as fetchHealth } from './lib/api'

/* The report currently on screen, and the capture id it belongs to. */
export const ReportContext = createContext({ report: null, setReport: () => {} })
export const useReport = () => useContext(ReportContext)

function useTheme() {
  const [theme, setTheme] = useState(
    () => localStorage.getItem('sms-theme') || 'system',
  )

  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      root.classList.toggle('dark', dark)
    }
    apply()
    try {
      localStorage.setItem('sms-theme', theme)
    } catch {
      /* private browsing; the choice simply will not persist */
    }
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  return [theme, setTheme]
}

function Header({ health }) {
  const [theme, setTheme] = useTheme()
  const { pathname } = useLocation()

  return (
    <header className="border-b border-line bg-surface sticky top-0 z-20">
      <div className="max-w-[1240px] mx-auto px-6 h-14 flex items-center gap-5">
        <Link to="/" className="flex items-baseline gap-2.5 no-underline text-ink shrink-0">
          <span className="font-display font-semibold text-[17px] tracking-tight">
            SecureMailScope
          </span>
          <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-ink-3 hidden sm:inline">
            PS 26159
          </span>
        </Link>

        <nav className="flex gap-1 text-[13px] ml-2">
          <NavLink to="/" active={pathname === '/'}>
            New analysis
          </NavLink>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <span
            className="font-mono text-[10px] tracking-[0.08em] uppercase px-2 py-1 rounded bg-surface-2 border border-line text-ink-3"
            title={
              health?.status === 'UP'
                ? 'API and analysis engine both responding'
                : health?.reachable
                  ? health.error || 'The API is up but cannot run the analysis engine'
                  : 'The API is not answering on /api'
            }
          >
            {health ? (health.status === 'UP' ? 'ready' : health.reachable ? 'degraded' : 'offline') : '…'}
          </span>
          <button
            type="button"
            onClick={() =>
              setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')
            }
            className="font-mono text-[10px] tracking-[0.08em] uppercase px-2 py-1 rounded border border-line bg-surface-2 text-ink-2 hover:text-ink"
            title="Switch between light, dark and system themes"
          >
            {theme}
          </button>
        </div>
      </div>
    </header>
  )
}

function NavLink({ to, active, children }) {
  return (
    <Link
      to={to}
      className={`px-2.5 py-1 rounded no-underline ${
        active ? 'text-ink font-medium bg-surface-2' : 'text-ink-2 hover:text-ink'
      }`}
    >
      {children}
    </Link>
  )
}

export default function App() {
  const [report, setReport] = useState(null)
  const [health, setHealth] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchHealth().then((h) => {
      if (!cancelled) setHealth(h)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const ctx = useMemo(() => ({ report, setReport, health }), [report, health])

  return (
    <ReportContext.Provider value={ctx}>
      <div className="min-h-full flex flex-col">
        <Header health={health} />
        <main className="flex-1 max-w-[1240px] w-full mx-auto px-6 py-7">
          <Routes>
            <Route path="/" element={<Upload />} />
            <Route path="/report/:id" element={<Dashboard />} />
            <Route path="/report/:id/sessions/:stream" element={<SessionDetail />} />
            <Route path="/report/:id/export" element={<ExportPage />} />
            <Route
              path="*"
              element={
                <div className="text-center py-24">
                  <div className="font-display text-xl font-semibold mb-2">
                    Nothing here
                  </div>
                  <Link to="/" className="text-accent">
                    Back to a new analysis
                  </Link>
                </div>
              }
            />
          </Routes>
        </main>
        <footer className="border-t border-line py-4">
          <div className="max-w-[1240px] mx-auto px-6 font-mono text-[10.5px] text-ink-3 leading-relaxed">
            Passive analysis only — no packet is ever transmitted and no server is contacted.
            Grades are scoped to the sessions present in the capture.
          </div>
        </footer>
      </div>
    </ReportContext.Provider>
  )
}
