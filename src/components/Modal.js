import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import PropTypes from 'prop-types'

const Modal = ({ visible, onClose, size, alignment, scrollable, className, children }) => {
  useEffect(() => {
    if (!visible) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [visible])

  useEffect(() => {
    if (!visible) return
    const handler = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [visible, onClose])

  if (!visible) return null

  const overlayStyle = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 1050,
    display: 'flex',
    alignItems: alignment === 'center' ? 'center' : 'flex-start',
    justifyContent: 'center',
    padding: alignment === 'center' ? '16px' : '48px 16px',
    overflowY: 'auto',
  }

  const dialogStyle = {
    background: 'var(--pc-surface, #fff)',
    borderRadius: 14,
    border: '1px solid var(--pc-line, #e5e5e5)',
    boxShadow: 'var(--pc-shadow-2, 0 12px 28px rgba(0,0,0,0.2))',
    width: '100%',
    maxWidth: size === 'xl' ? 1100 : size === 'lg' ? 800 : 500,
    maxHeight: scrollable ? '90vh' : 'none',
    display: 'flex',
    flexDirection: 'column',
    overflow: scrollable ? 'hidden' : 'visible',
    color: 'var(--pc-ink, #111)',
    fontFamily: 'var(--pc-font-sans, sans-serif)',
    fontSize: 13,
  }

  return createPortal(
    <div style={overlayStyle} onClick={onClose}>
      <div
        style={dialogStyle}
        className={className || ''}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

export const ModalHeader = ({ children, closeButton, onClose }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '14px 20px',
      borderBottom: '1px solid var(--pc-line, #e5e5e5)',
      background: 'var(--pc-surface-2, #fafaf9)',
      flexShrink: 0,
    }}
  >
    <div style={{ minWidth: 0, flex: 1 }}>{children}</div>
    {closeButton && (
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{
          background: 'transparent',
          border: 0,
          cursor: 'pointer',
          fontSize: 20,
          lineHeight: 1,
          color: 'var(--pc-ink-3, #666)',
          padding: '0 0 0 12px',
          flexShrink: 0,
        }}
      >
        ×
      </button>
    )}
  </div>
)

export const ModalBody = ({ children, style }) => (
  <div
    style={{
      padding: '0',
      overflowY: 'auto',
      flex: 1,
      ...style,
    }}
  >
    {children}
  </div>
)

export const ModalFooter = ({ children, style }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '12px 20px',
      borderTop: '1px solid var(--pc-line, #e5e5e5)',
      background: 'var(--pc-surface-2, #fafaf9)',
      flexShrink: 0,
      ...style,
    }}
  >
    {children}
  </div>
)

Modal.propTypes = {
  visible: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  size: PropTypes.string,
  alignment: PropTypes.string,
  scrollable: PropTypes.bool,
  className: PropTypes.string,
  children: PropTypes.node,
}

ModalHeader.propTypes = {
  children: PropTypes.node,
  closeButton: PropTypes.bool,
  onClose: PropTypes.func,
}

ModalBody.propTypes = {
  children: PropTypes.node,
  style: PropTypes.object,
}

ModalFooter.propTypes = {
  children: PropTypes.node,
  style: PropTypes.object,
}

export default Modal
