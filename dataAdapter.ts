// services/dataAdapter.ts
import { ApiService, AfipService, EmailService } from '../supabase-client'
import { useDataSource } from '../hooks/useDataSource'

// Adapter para unificar datos locales y Supabase
class DataAdapter {
  private useSupabase: boolean = false

  constructor(useSupabase: boolean) {
    this.useSupabase = useSupabase
  }

  // Productos
  async getProducts(params?: { search?: string; limit?: number }) {
    if (this.useSupabase) {
      return await ApiService.getProducts(params)
    } else {
      // Sistema local - usar Dexie o el método actual
      // Por ahora devolvemos datos mock
      return []
    }
  }

  async createProduct(product: any) {
    if (this.useSupabase) {
      return await ApiService.createProduct(product)
    } else {
      // Sistema local
      console.log('Creando producto en sistema local:', product)
      return product
    }
  }

  // Clientes
  async getCustomers(params?: { search?: string; limit?: number }) {
    if (this.useSupabase) {
      return await ApiService.getCustomers(params)
    } else {
      // Sistema local
      return []
    }
  }

  async createCustomer(customer: any) {
    if (this.useSupabase) {
      return await ApiService.createCustomer(customer)
    } else {
      // Sistema local
      console.log('Creando cliente en sistema local:', customer)
      return customer
    }
  }

  // Ventas
  async getSales(params?: { startDate?: string; endDate?: string }) {
    if (this.useSupabase) {
      return await ApiService.getSales(params)
    } else {
      // Sistema local
      return []
    }
  }

  async createSale(sale: any) {
    if (this.useSupabase) {
      return await ApiService.createSale(sale)
    } else {
      // Sistema local
      console.log('Creando venta en sistema local:', sale)
      return sale
    }
  }

  // AFIP
  async getLastAfipNumber(documentType: string, salePoint: number) {
    if (this.useSupabase) {
      return await AfipService.getLastNumber(documentType, salePoint)
    } else {
      // Servidor AFIP local (puerto 3001)
      try {
        const response = await fetch('http://localhost:3001/api/afip/last-number', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentType, salePoint })
        })
        return await response.json()
      } catch (error) {
        console.error('Error conectando con AFIP local:', error)
        throw error
      }
    }
  }

  async generateAfipInvoice(invoiceData: any) {
    if (this.useSupabase) {
      return await AfipService.generateInvoice(invoiceData)
    } else {
      // Servidor AFIP local
      try {
        const response = await fetch('http://localhost:3001/api/afip/generate-invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(invoiceData)
        })
        return await response.json()
      } catch (error) {
        console.error('Error generando factura AFIP local:', error)
        throw error
      }
    }
  }

  // Email
  async sendEmail(emailData: any) {
    if (this.useSupabase) {
      return await EmailService.sendDocument(emailData)
    } else {
      // Servidor Email local (puerto 3004)
      try {
        const response = await fetch('http://localhost:3004/api/email/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(emailData)
        })
        return await response.json()
      } catch (error) {
        console.error('Error enviando email local:', error)
        throw error
      }
    }
  }

  // Estado de conexión
  async getConnectionStatus() {
    if (this.useSupabase) {
      return {
        status: 'connected',
        source: 'supabase',
        url: import.meta.env.VITE_SUPABASE_URL
      }
    } else {
      return {
        status: 'local',
        source: 'local',
        servers: {
          afip: 'http://localhost:3001',
          email: 'http://localhost:3004',
          sync: 'http://localhost:3000'
        }
      }
    }
  }
}

export default DataAdapter