import React from 'react'
import { useLanguage } from '../../../context/LanguageContext'

function HeightPopup({
  top,
  left,
  unitSystem,
  tempHeight,
  setTempHeight,
  onConfirm,
  onDelete,
  onCancel,
}) {
  const { t } = useLanguage()
  return (
    <div
      style={{
        position: 'absolute',
        top,
        left,
        zIndex: 1000,
        width: '320px',
        padding: '20px',
        backgroundColor: '#ffffff',
        boxShadow: '0px 8px 16px rgba(0,0,0,0.1)',
        borderRadius: '10px',
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        display: 'flex',
        flexDirection: 'column',
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
        <span style={{ fontSize: '18px', fontWeight: 'bold' }}>{t('calculator.setPointHeight')}</span>
        <button
          onClick={onCancel}
          style={{
            border: 'none',
            backgroundColor: 'transparent',
            cursor: 'pointer',
            color: '#333',
            fontSize: '18px',
          }}
        >
          ×
        </button>
      </div>
      <div
        style={{
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <label style={{ flex: 1, fontSize: '16px', color: '#333' }}>{t('calculator.height')}:</label>
        <input
          type="text"
          value={tempHeight}
          onChange={(e) => setTempHeight(e.target.value)}
          style={{
            padding: '8px',
            fontSize: '16px',
            borderRadius: '4px',
            border: '1px solid #ccc',
            flex: 2,
            marginRight: '10px',
          }}
        />
        <span style={{ flex: 1, fontSize: '16px', color: '#666' }}>
          {unitSystem === 'imperial' ? 'in' : 'cm'}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-around' }}>
        <button
          onClick={onConfirm}
          style={{
            backgroundColor: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            padding: '10px 15px',
            cursor: 'pointer',
            fontSize: '16px',
          }}
        >
          {t('calculator.confirm')}
        </button>
        <button
          onClick={onDelete}
          style={{
            backgroundColor: '#FF5722',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            padding: '10px 15px',
            cursor: 'pointer',
            fontSize: '16px',
          }}
        >
          {t('common.delete')}
        </button>
        <button
          onClick={onCancel}
          style={{
            backgroundColor: '#f44336',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            padding: '10px 15px',
            cursor: 'pointer',
            fontSize: '16px',
          }}
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}

export default HeightPopup
