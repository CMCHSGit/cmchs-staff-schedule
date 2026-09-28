import { useRef, useState } from 'react'
import { ArrowDown } from 'lucide-react'
import { Spinner } from './ui'

const THRESHOLD = 70 // px pulled before release triggers a refresh
const MAX_PULL  = 100 // visual cap so it can't be dragged open indefinitely

// The page itself (window) is what scrolls, not this container — so "at the
// top" has to be checked on the window, or dragging down to scroll back up a
// long page would count as a pull and refresh it.
const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0

/**
 * Custom drag-down-to-refresh gesture, not the browser/OS's native one —
 * that only exists on Android's installed-PWA mode, not iOS's standalone
 * mode at all, so relying on it would make this an Android-only feature.
 * Built on plain touch events instead so it behaves the same on both.
 * Touches inside anything marked data-no-ptr (the edit panel, sideways-
 * scrolling rows) are ignored.
 */
export default function PullToRefresh({ onRefresh, children }) {
  const startY = useRef(0)
  const [pull, setPull] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  function handleTouchStart(e) {
    if (refreshing || !atTop() || e.target.closest?.('[data-no-ptr]')) return
    startY.current = e.touches[0].clientY
    setDragging(true)
  }

  function handleTouchMove(e) {
    if (!dragging || refreshing) return
    const delta = e.touches[0].clientY - startY.current
    if (delta <= 0 || !atTop()) {
      setDragging(false)
      setPull(0)
      return
    }
    setPull(Math.min(MAX_PULL, delta * 0.5))
  }

  async function handleTouchEnd() {
    if (!dragging) return
    setDragging(false)
    if (pull >= THRESHOLD) {
      setRefreshing(true)
      setPull(THRESHOLD)
      try {
        await onRefresh()
      } finally {
        setRefreshing(false)
        setPull(0)
      }
    } else {
      setPull(0)
    }
  }

  return (
    <div
      className="app-content"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="ptr-indicator" style={{ height: pull, transition: dragging ? 'none' : 'height 0.2s' }}>
        {refreshing ? (
          <Spinner size={22} />
        ) : pull > 0 && (
          <ArrowDown
            size={20}
            aria-hidden="true"
            style={{ transform: `rotate(${Math.min(1, pull / THRESHOLD) * 180}deg)`, opacity: Math.min(1, pull / 30) }}
          />
        )}
      </div>
      {children}
    </div>
  )
}
