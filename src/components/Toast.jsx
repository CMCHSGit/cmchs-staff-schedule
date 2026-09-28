import { useCallback, useEffect, useRef, useState } from 'react'

export default function Toast({ message }) {
  if (!message) return null
  return <div className="toast" role="status">{message}</div>
}

/** [message, show] — each show() replaces the last and clears after a few seconds. */
export function useToast() {
  const [message, setMessage] = useState(null)
  const timer = useRef()
  const show = useCallback(msg => {
    clearTimeout(timer.current)
    setMessage(msg)
    timer.current = setTimeout(() => setMessage(null), 2800)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  return [message, show]
}
