import { useRef, useState } from 'react'

const THRESHOLD = 70 // px pulled before release triggers a refresh
const MAX_PULL  = 100 // visual cap so it can't be dragged open indefinitely

/**
 * Custom drag-down-to-refresh gesture, not the browser/OS's native one —
 * that only exists on Android's installed-PWA mode, not iOS's standalone
 * mode at all, so relying on it would make this an Android-only feature.
 * Built on plain touch events instead so it behaves the same on both.
 */
export default function PullToRefresh({ onRefresh, children }) {
  const containerRef = useRef(null)
  const startY = useRef(0)
  const [pull, setPull] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  function handleTouchStart(e) {
    if (refreshing) return
    if (containerRef.current.scrollTop > 0) return
    startY.current = e.touches[0].clientY
    setDragging(true)
  }

  function handleTouchMove(e) {
    if (!dragging || refreshing) return
    const delta = e.touches[0].clientY - startY.current
    if (delta <= 0) {
      setDragging(false)
      setPull(0)
      return
    }
    setPull(Math.min(MAX_PULL, delta * 0.5))
    e.preventDefault()
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
      ref={containerRef}
      className="app-content"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className="ptr-indicator"
        style={{ height: pull, transition: dragging ? 'none' : 'height 0.2s' }}
      >
        {refreshing ? (
          <div className="spinner" />
        ) : pull > 0 && (
          <svg
            className="ptr-arrow"
            style={{ transform: `rotate(${Math.min(1, pull / THRESHOLD) * 180}deg)`, opacity: Math.min(1, pull / 30) }}
            viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
          >
            <path d="M12 4v14M6 12l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      {children}
    </div>
  )
}
