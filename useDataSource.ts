// hooks/useDataSource.ts
import { useState, useEffect } from 'react'

// Detectar si debe usar Supabase o sistema local
export function useDataSource() {
  const [useSupabase, setUseSupabase] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Verificar variables de entorno
    const supabaseEnabled = import.meta.env.VITE_USE_SUPABASE === 'true'
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
    
    // Si tiene las credenciales de Supabase y está habilitado, usar Supabase
    if (supabaseEnabled && supabaseUrl && supabaseKey) {
      console.log('🌟 Usando Supabase como fuente de datos')
      setUseSupabase(true)
    } else {
      console.log('💾 Usando sistema local como fuente de datos')
      setUseSupabase(false)
    }
    
    setLoading(false)
  }, [])

  return {
    useSupabase,
    loading,
    dataSource: useSupabase ? 'supabase' : 'local'
  }
}