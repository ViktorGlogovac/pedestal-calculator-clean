import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'

const AuthContext = createContext(null)
const GUEST_STORAGE_KEY = 'pc-guest-session'

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isGuest, setIsGuest] = useState(() => localStorage.getItem(GUEST_STORAGE_KEY) === 'true')

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false)
      return undefined
    }

    let mounted = true

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return
      if (error) {
        setSession(null)
        setUser(null)
      } else {
        setSession(data.session ?? null)
        setUser(data.session?.user ?? null)
      }
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null)
      setUser(nextSession?.user ?? null)
      setLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const value = useMemo(
    () => ({
      session,
      user,
      isGuest,
      loading,
      isConfigured: isSupabaseConfigured,
      async signIn(email, password) {
        if (!supabase) {
          return { error: new Error('Supabase environment variables are missing.') }
        }
        const result = await supabase.auth.signInWithPassword({ email, password })
        if (!result.error) {
          localStorage.removeItem(GUEST_STORAGE_KEY)
          setIsGuest(false)
        }
        return result
      },
      async signUp(email, password) {
        if (!supabase) {
          return { error: new Error('Supabase environment variables are missing.') }
        }
        return supabase.auth.signUp({ email, password })
      },
      continueAsGuest() {
        localStorage.setItem(GUEST_STORAGE_KEY, 'true')
        setIsGuest(true)
      },
      async signOut() {
        localStorage.removeItem(GUEST_STORAGE_KEY)
        setIsGuest(false)
        if (!supabase) return { error: null }
        return supabase.auth.signOut()
      },
    }),
    [isGuest, loading, session, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
