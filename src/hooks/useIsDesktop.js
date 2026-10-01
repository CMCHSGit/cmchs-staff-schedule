import { useEffect, useState } from 'react'

/** Same 760px breakpoint the CSS uses for the desktop layout (header tabs instead of the bottom bar). */
const QUERY = '(min-width: 760px)'

/** True on desktop-width screens; follows the window as it's resized. */
export default function useIsDesktop() {
  const [desktop, setDesktop] = useState(() => window.matchMedia?.(QUERY).matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY)
    if (!mq) return
    const onChange = e => setDesktop(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return desktop
}
