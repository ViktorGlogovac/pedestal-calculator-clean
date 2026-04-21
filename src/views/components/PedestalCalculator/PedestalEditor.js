import React from 'react'
import PropTypes from 'prop-types'
import heightImage from '../../../assets/images/pedestals/HEIGHT.png'

const PedestalEditor = ({
  pedestal,
  unitSystem,
  pedestalTempHeight,
  setPedestalTempHeight,
  onSave,
  onDelete,
  onCancel,
  modalPosition, // { x: number, y: number } for absolute positioning
}) => {
  if (!pedestal) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: modalPosition.y,
        left: modalPosition.x,
        zIndex: 1000,
        width: '360px',
        padding: '20px',
        backgroundColor: 'var(--pc-surface)',
        color: 'var(--pc-ink)',
        border: '1px solid var(--pc-line)',
        boxShadow: 'var(--pc-shadow-2)',
        borderRadius: 'var(--pc-radius-lg)',
        fontFamily: 'var(--pc-font-sans)',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
        }}
      >
        <span style={{ fontSize: '16px', fontWeight: '650' }}>Set Pedestal Height</span>
        <button
          onClick={onCancel}
          style={{
            border: 'none',
            backgroundColor: 'transparent',
            cursor: 'pointer',
            color: 'var(--pc-ink-3)',
            fontSize: '18px',
          }}
        >
          ×
        </button>
      </div>

      {/* Height explanation with image */}
      <div style={{ marginBottom: '16px', textAlign: 'center' }}>
        <img
          src={heightImage}
          alt="Pedestal Height Measurement"
          style={{
            maxWidth: '100%',
            height: 'auto',
            marginBottom: '8px',
          }}
        />
        <p
          style={{
            fontSize: '13px',
            color: 'var(--pc-ink-3)',
            margin: '8px 0 0 0',
            lineHeight: '1.4',
          }}
        >
          Enter the height of the pedestal only, not including the tile thickness.
        </p>
      </div>

      <div
        style={{
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <label style={{ flex: 1, fontSize: '14px', color: 'var(--pc-ink-2)', fontWeight: 600 }}>
          Height
        </label>
        <input
          type="text"
          value={pedestalTempHeight}
          onChange={(e) => setPedestalTempHeight(e.target.value)}
          style={{
            padding: '8px',
            fontSize: '16px',
            borderRadius: 'var(--pc-radius)',
            border: '1px solid var(--pc-line-2)',
            flex: 2,
            marginRight: '10px',
            background: 'var(--pc-surface)',
            color: 'var(--pc-ink)',
          }}
        />
        <span style={{ flex: 1, fontSize: '14px', color: 'var(--pc-ink-3)' }}>
          {unitSystem === 'imperial' ? 'in' : 'cm'}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          gap: '8px',
          justifyContent: 'space-between',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <button
          onClick={onSave}
          className="pc-btn primary"
          style={{
            flex: 1,
            justifyContent: 'center',
          }}
        >
          Confirm
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            className="pc-btn"
            style={{
              flex: 1,
              justifyContent: 'center',
              color: 'var(--pc-danger)',
            }}
          >
            Reset
          </button>
        )}
        <button
          onClick={onCancel}
          className="pc-btn"
          style={{
            flex: 1,
            justifyContent: 'center',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export default PedestalEditor

PedestalEditor.propTypes = {
  pedestal: PropTypes.shape({
    x: PropTypes.number,
    y: PropTypes.number,
    height: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    multi: PropTypes.bool,
  }),
  unitSystem: PropTypes.oneOf(['metric', 'imperial']).isRequired,
  pedestalTempHeight: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  setPedestalTempHeight: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  onDelete: PropTypes.func,
  onCancel: PropTypes.func.isRequired,
  modalPosition: PropTypes.shape({
    x: PropTypes.number.isRequired,
    y: PropTypes.number.isRequired,
  }).isRequired,
}
