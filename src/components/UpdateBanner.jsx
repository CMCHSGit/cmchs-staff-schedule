import { RefreshCw } from 'lucide-react'
import { useAppUpdates } from '../utils/appUpdates'
import { Button } from './ui'

/**
 * "A new version is ready" — shown only when a newer version has been
 * downloaded but this page has been used, so reloading by itself could lose
 * something half-entered. Untouched pages just switch over on their own.
 */
export default function UpdateBanner() {
  const { updateReady, applyUpdate } = useAppUpdates()
  if (!updateReady) return null
  return (
    <div className="update-banner" role="status">
      <RefreshCw size={18} aria-hidden="true" />
      <span>A new version is ready.</span>
      <Button size="sm" onClick={applyUpdate}>Update</Button>
    </div>
  )
}
