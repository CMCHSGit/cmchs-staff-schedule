import { useCallback, useEffect, useState } from 'react'

/**
 * Light/dark mode. Follows the device setting until someone taps the
 * header toggle, then remembers their choice on this device. index.html
 * applies the same logic before first paint, so there's no white flash.
 * <html data-theme> always holds the effective theme — CSS only needs to
 * look at that, not at prefers-color-scheme as well.
 */
const KEY = 'css_theme'
const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches

function stored() {
  try { return localStorage.getItem(KEY) } catch { return null }
}

function apply(theme) {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#161618' : '#ffffff')
}

export function useTheme() {
  const [theme, setTheme] = useState(() => stored() || (systemDark() ? 'dark' : 'light'))

  useEffect(() => { apply(theme) }, [theme])

  // Keep following the device while nobody has picked a theme by hand.
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const onChange = e => { if (!stored()) setTheme(e.matches ? 'dark' : 'light') }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const toggle = useCallback(() => {
    setTheme(t => {
      const next = t === 'dark' ? 'light' : 'dark'
      try { localStorage.setItem(KEY, next) } catch { /* private mode — still switches for now */ }
      return next
    })
  }, [])

  return [theme, toggle]
}
