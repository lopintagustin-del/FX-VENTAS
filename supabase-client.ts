// supabase-client.ts
import { createClient } from '@supabase/supabase-js'

// Configuración de Supabase usando variables de entorno
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://ymwdkasccwwrodspekcnu.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inltd2RrYXNjY3d3cm9kc3BrY251Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI2NDA2MDgsImV4cCI6MjA3ODIxNjYwOH0.-hQZZT6PPqrxvA5oSKWAqJayqlTg-KU9USLgug67H8k'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// URLs de las Edge Functions
export const FUNCTIONS_BASE_URL = `${supabaseUrl}/functions/v1`

export const FUNCTION_URLS = {
  api: `${FUNCTIONS_BASE_URL}/api`,
  afip: `${FUNCTIONS_BASE_URL}/afip-service`,
  email: `${FUNCTIONS_BASE_URL}/email-service`
}

// Interfaces TypeScript
export interface Product {
  id: string
  code: string
  name: string
  brand?: string
  family?: string
  supplier_code?: string
  barcode?: string
  cost_price: number
  price_list_1: number
  price_list_2: number
  price_list_3: number
  current_stock: number
  minimum_stock: number
  tax_rate: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Customer {
  id: string
  code: string
  name: string
  email?: string
  phone?: string
  address?: string
  tax_id?: string
  tax_condition: string
  credit_limit: number
  current_account_balance: number
  price_list: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Sale {
  id: string
  document_number: string
  document_type: string
  customer_code?: string
  seller_code?: string
  sale_date: string
  subtotal: number
  tax_amount: number
  discount_amount: number
  total_amount: number
  payment_method: string
  status: string
  notes?: string
  created_at: string
  updated_at: string
  sale_items?: SaleItem[]
}

export interface SaleItem {
  id: string
  sale_id: string
  product_code: string
  product_name: string
  quantity: number
  unit_price: number
  discount_percentage: number
  subtotal: number
  created_at: string
  updated_at: string
}

export interface Supplier {
  id: string
  code: string
  name: string
  contact_name?: string
  phone?: string
  email?: string
  address?: string
  tax_id?: string
  created_at: string
  updated_at: string
}

export interface Seller {
  id: string
  code: string
  name: string
  email?: string
  phone?: string
  commission_percentage: number
  is_active: boolean
  created_at: string
  updated_at: string
}

// Servicios de API
export class ApiService {
  private static async fetchWithError(url: string, options?: RequestInit) {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers
      },
      ...options
    })
    
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || `Error ${response.status}`)
    }
    
    return response.json()
  }

  // Productos
  static async getProducts(params?: { limit?: number; offset?: number; search?: string }): Promise<Product[]> {
    const searchParams = new URLSearchParams()
    if (params?.limit) searchParams.set('limit', params.limit.toString())
    if (params?.offset) searchParams.set('offset', params.offset.toString())
    if (params?.search) searchParams.set('search', params.search)
    
    const url = `${FUNCTION_URLS.api}/products${searchParams.toString() ? '?' + searchParams.toString() : ''}`
    return this.fetchWithError(url)
  }

  static async getProduct(id: string): Promise<Product> {
    return this.fetchWithError(`${FUNCTION_URLS.api}/products/${id}`)
  }

  static async createProduct(product: Omit<Product, 'id' | 'created_at' | 'updated_at'>): Promise<Product> {
    return this.fetchWithError(`${FUNCTION_URLS.api}/products`, {
      method: 'POST',
      body: JSON.stringify(product)
    })
  }

  static async updateProduct(id: string, product: Partial<Product>): Promise<Product> {
    return this.fetchWithError(`${FUNCTION_URLS.api}/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(product)
    })
  }

  static async deleteProduct(id: string): Promise<{ message: string }> {
    return this.fetchWithError(`${FUNCTION_URLS.api}/products/${id}`, {
      method: 'DELETE'
    })
  }

  // Clientes
  static async getCustomers(params?: { limit?: number; offset?: number; search?: string }): Promise<Customer[]> {
    const searchParams = new URLSearchParams()
    if (params?.limit) searchParams.set('limit', params.limit.toString())
    if (params?.offset) searchParams.set('offset', params.offset.toString())
    if (params?.search) searchParams.set('search', params.search)
    
    const url = `${FUNCTION_URLS.api}/customers${searchParams.toString() ? '?' + searchParams.toString() : ''}`
    return this.fetchWithError(url)
  }

  static async createCustomer(customer: Omit<Customer, 'id' | 'created_at' | 'updated_at'>): Promise<Customer> {
    return this.fetchWithError(`${FUNCTION_URLS.api}/customers`, {
      method: 'POST',
      body: JSON.stringify(customer)
    })
  }

  // Ventas
  static async getSales(params?: { limit?: number; offset?: number; startDate?: string; endDate?: string }): Promise<Sale[]> {
    const searchParams = new URLSearchParams()
    if (params?.limit) searchParams.set('limit', params.limit.toString())
    if (params?.offset) searchParams.set('offset', params.offset.toString())
    if (params?.startDate) searchParams.set('startDate', params.startDate)
    if (params?.endDate) searchParams.set('endDate', params.endDate)
    
    const url = `${FUNCTION_URLS.api}/sales${searchParams.toString() ? '?' + searchParams.toString() : ''}`
    return this.fetchWithError(url)
  }

  static async createSale(sale: Omit<Sale, 'id' | 'created_at' | 'updated_at'> & { items: Omit<SaleItem, 'id' | 'sale_id' | 'created_at' | 'updated_at'>[] }): Promise<Sale> {
    return this.fetchWithError(`${FUNCTION_URLS.api}/sales`, {
      method: 'POST',
      body: JSON.stringify(sale)
    })
  }

  // Proveedores
  static async getSuppliers(): Promise<Supplier[]> {
    return this.fetchWithError(`${FUNCTION_URLS.api}/suppliers`)
  }

  // Vendedores  
  static async getSellers(): Promise<Seller[]> {
    return this.fetchWithError(`${FUNCTION_URLS.api}/sellers`)
  }
}

// Servicio AFIP
export class AfipService {
  static async getLastNumber(documentType: string, salePoint: number): Promise<{ lastNumber: number; nextNumber: number }> {
    const response = await fetch(FUNCTION_URLS.afip, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'getLastNumber',
        documentType,
        salePoint
      })
    })
    
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error)
    }
    
    return response.json()
  }

  static async generateInvoice(invoiceData: any): Promise<{ success: boolean; cae: string; caeExpiration: string; documentNumber: string }> {
    const response = await fetch(FUNCTION_URLS.afip, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'generateInvoice',
        ...invoiceData
      })
    })
    
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error)
    }
    
    return response.json()
  }

  static async getServerStatus(): Promise<{ serverStatus: string; lastCheck: string }> {
    const response = await fetch(FUNCTION_URLS.afip, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'getServerStatus'
      })
    })
    
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error)
    }
    
    return response.json()
  }
}

// Servicio Email
export class EmailService {
  static async sendDocument(emailData: {
    to: string
    subject?: string
    documentType: string
    documentNumber: string
    customerName: string
    pdfBase64?: string
    companyName?: string
  }): Promise<{ success: boolean; messageId: string }> {
    const response = await fetch(FUNCTION_URLS.email, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'sendDocument',
        ...emailData
      })
    })
    
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error)
    }
    
    return response.json()
  }

  static async sendNotification(notificationData: {
    to: string
    subject: string
    message: string
    type?: 'info' | 'success' | 'warning' | 'error'
  }): Promise<{ success: boolean; messageId: string }> {
    const response = await fetch(FUNCTION_URLS.email, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'sendNotification',
        ...notificationData
      })
    })
    
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error)
    }
    
    return response.json()
  }

  static async testConnection(emailConfig: { user: string; appPassword: string }): Promise<{ success: boolean }> {
    const response = await fetch(FUNCTION_URLS.email, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'testConnection',
        emailConfig
      })
    })
    
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error)
    }
    
    return response.json()
  }
}