import React from 'react'
import { NavLink } from 'react-router-dom'
import PropTypes from 'prop-types'

export const AppSidebarNav = ({ items }) => {
  return (
    <nav
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '8px 0',
      }}
    >
      {items &&
        items.map((item, index) => (
          <NavLink
            key={index}
            to={item.to}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 16px',
              color: isActive ? '#fff' : 'rgba(255,255,255,0.75)',
              background: isActive ? 'rgba(255,255,255,0.12)' : 'transparent',
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 500,
              transition: 'background 0.12s, color 0.12s',
              borderRadius: 6,
              margin: '2px 8px',
            })}
          >
            <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}>{item.icon}</span>
            <span>{item.name}</span>
          </NavLink>
        ))}
    </nav>
  )
}

AppSidebarNav.propTypes = {
  items: PropTypes.arrayOf(PropTypes.any).isRequired,
}
