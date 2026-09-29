import { useEffect } from 'react'
import { X } from 'lucide-react'
import { IconButton } from './ui'

/**
 * Slide-in panel — from the right on desktop, full screen on a phone. Locks
 * the page behind it; the scrim or Escape closes it. Shared by the
 * whereabouts, comment and leave panels so they behave identically.
 */
export default function Drawer({ label, onClose, children }) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [onClose])

  return (
    <div className="drawer" data-no-ptr>
      <div className="drawer-scrim" onClick={onClose} />
      <div className="drawer-panel" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  )
}

export function DrawerHead({ overline, title, children, onClose }) {
  return (
    <div className="drawer-head">
      <div className="drawer-head-text">
        <span className="overline">{overline}</span>
        <span className="drawer-name">{title}</span>
        {children && <span className="text-sm">{children}</span>}
      </div>
      <IconButton label="Close" onClick={onClose}><X size={20} /></IconButton>
    </div>
  )
}
