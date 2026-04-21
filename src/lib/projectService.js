import { supabase } from './supabaseClient'

export const listProjects = async (userId) => {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, updated_at, created_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  return { data: data ?? [], error }
}

export const getProject = async (projectId, userId) => {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, state, updated_at, created_at')
    .eq('id', projectId)
    .eq('user_id', userId)
    .single()

  return { data, error }
}

export const saveProject = async ({ projectId, userId, name, state }) => {
  if (projectId) {
    const { data, error } = await supabase
      .from('projects')
      .update({ name, state })
      .eq('id', projectId)
      .eq('user_id', userId)
      .select('id, name, updated_at, created_at')
      .single()

    return { data, error }
  }

  const { data, error } = await supabase
    .from('projects')
    .insert({ user_id: userId, name, state })
    .select('id, name, updated_at, created_at')
    .single()

  return { data, error }
}

export const deleteProject = async (projectId, userId) => {
  const { error } = await supabase.from('projects').delete().eq('id', projectId).eq('user_id', userId)
  return { error }
}

