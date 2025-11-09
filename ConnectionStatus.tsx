// components/ConnectionStatus.tsx
import React, { useState, useEffect } from 'react'
import { useDataSource } from '../hooks/useDataSource'
import DataAdapter from '../services/dataAdapter'

export const ConnectionStatus: React.FC = () => {
  const { useSupabase, loading, dataSource } = useDataSource()
  const [connectionInfo, setConnectionInfo] = useState<any>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (!loading) {
      checkConnection()
    }
  }, [loading, useSupabase])

  const checkConnection = async () => {
    if (loading) return
    
    setChecking(true)
    try {
      const adapter = new DataAdapter(useSupabase)
      const status = await adapter.getConnectionStatus()
      setConnectionInfo(status)
    } catch (error) {
      console.error('Error checking connection:', error)
      setConnectionInfo({ status: 'error', error: error.message })
    } finally {
      setChecking(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
        <div className="flex items-center">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-yellow-600 mr-2"></div>
          <span className="text-yellow-800">Detectando fuente de datos...</span>
        </div>
      </div>
    )
  }

  const getStatusColor = () => {
    if (useSupabase) return 'bg-green-50 border-green-200'
    if (connectionInfo?.status === 'local') return 'bg-blue-50 border-blue-200'
    return 'bg-red-50 border-red-200'
  }

  const getStatusIcon = () => {
    if (checking) return '🔄'
    if (useSupabase) return '🌐'
    if (connectionInfo?.status === 'local') return '💾'
    return '❌'
  }

  const getStatusText = () => {
    if (checking) return 'Verificando conexión...'
    if (useSupabase) return 'Conectado a Supabase (Nube)'
    if (connectionInfo?.status === 'local') return 'Sistema Local Activo'
    return 'Sin conexión'
  }

  return (
    <div className={`${getStatusColor()} border rounded-lg p-4 mb-4`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <span className="text-2xl mr-3">{getStatusIcon()}</span>
          <div>
            <h3 className="font-semibold text-gray-800">
              {getStatusText()}
            </h3>
            <p className="text-sm text-gray-600">
              {useSupabase ? (
                <>
                  Base de datos: PostgreSQL | 
                  APIs: Edge Functions | 
                  Respaldo: Automático
                </>
              ) : (
                <>
                  Base de datos: Local (Dexie) | 
                  Servidores: Locales | 
                  Puerto: 3000-3004
                </>
              )}
            </p>
          </div>
        </div>

        <button
          onClick={checkConnection}
          disabled={checking}
          className="bg-white border border-gray-300 rounded-md px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {checking ? 'Verificando...' : 'Verificar'}
        </button>
      </div>

      {/* Detalles adicionales */}
      {connectionInfo && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            {useSupabase ? (
              <>
                <div>
                  <strong>🔗 URL Supabase:</strong><br />
                  <code className="text-xs bg-white px-1 rounded">
                    {import.meta.env.VITE_SUPABASE_URL}
                  </code>
                </div>
                <div>
                  <strong>⚡ Edge Functions:</strong><br />
                  <span className="text-green-600">✅ API</span> | 
                  <span className="text-green-600">✅ AFIP</span> | 
                  <span className="text-green-600">✅ Email</span>
                </div>
              </>
            ) : (
              <>
                <div>
                  <strong>🏠 Servidores Locales:</strong><br />
                  <code className="text-xs bg-white px-1 rounded">
                    localhost:3000-3004
                  </code>
                </div>
                <div>
                  <strong>⚠️ Limitaciones:</strong><br />
                  <span className="text-orange-600">Solo en esta PC</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}