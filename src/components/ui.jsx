/**
 * The CHS design system components this app uses (Button, IconButton, Tag,
 * Badge, Alert, Switch, StripeRule, Logo), rebuilt from the vendored
 * Staff-Schedule_v2 bundle as plain CSS-class components — same look and
 * props, but hover/press come from CSS (only on devices that can hover),
 * so a tapped button on a phone doesn't stay stuck in its hover colour.
 * Styles live in index.css under "Design system components".
 */

export function Button({ children, variant = 'primary', size = 'md', block = false, iconLeft, className = '', type = 'button', ...rest }) {
  return (
    <button type={type} className={`btn btn-${variant} btn-${size}${block ? ' btn-block' : ''} ${className}`} {...rest}>
      {iconLeft}{children}
    </button>
  )
}

export function IconButton({ children, label, size = 'md', className = '', ...rest }) {
  return (
    <button type="button" className={`icon-btn icon-btn-${size} ${className}`} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  )
}

export function Tag({ children, selected = false, onClick, className = '' }) {
  return (
    <button type="button" className={`tag${selected ? ' tag-selected' : ''} ${className}`} aria-pressed={selected} onClick={onClick}>
      {children}
    </button>
  )
}

export function Badge({ children, tone = 'purple', className = '' }) {
  return <span className={`badge badge-${tone} ${className}`}>{children}</span>
}

export function Alert({ tone = 'info', title, icon, children, action, className = '' }) {
  return (
    <div className={`alert alert-${tone} ${className}`} role={tone === 'critical' ? 'alert' : undefined}>
      {icon && <span className="alert-icon">{icon}</span>}
      <div className="alert-body">
        {title && <div className="alert-title">{title}</div>}
        {children && <div className="alert-text">{children}</div>}
      </div>
      {action && <div className="alert-action">{action}</div>}
    </div>
  )
}

export function Switch({ checked, onChange, label, className = '' }) {
  return (
    <label className={`switch ${className}`}>
      <input type="checkbox" role="switch" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="switch-track"><span className="switch-knob" /></span>
      {label && <span className="switch-label">{label}</span>}
    </label>
  )
}

/** The three-stripe device: connect patients, lives and health. */
export function StripeRule({ thickness = 4 }) {
  return (
    <div className="stripe-rule" style={{ height: thickness }} aria-hidden="true">
      <span /><span /><span />
    </div>
  )
}

/** Uses the supplied artwork only — never re-typeset or recolour the logo. */
export function Logo({ variant = 'full-colour', width = 150 }) {
  const src = variant === 'mark' ? '/brand/logo-mark.png' : '/brand/logo-full-colour.png'
  return <img src={src} alt="Connected Healthcare Systems" width={width} style={{ width, height: 'auto', display: 'block' }} />
}

export function Spinner({ size = 24, light = false }) {
  return <span className={`spinner${light ? ' spinner-light' : ''}`} style={{ width: size, height: size }} aria-label="Loading" />
}

export function Loading() {
  return <div className="loading-block"><Spinner /></div>
}
