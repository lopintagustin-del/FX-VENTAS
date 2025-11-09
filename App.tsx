import React, { useState, useCallback, useEffect, useRef } from 'react';
import Dexie, { Table } from 'dexie';
import { GoogleGenAI, FunctionDeclaration, Type } from '@google/genai';
import { HardwareProtection } from './components/HardwareProtection';
import { saveAfipConfig, loadAfipConfig } from './afip-storage';

import Header from './components/Header';
// Sidebar removed (unused)
import VentasView from './views/VentasView';
import ArticulosView, { initialProducts } from './views/ArticulosView';
import ClientesView, { Customer } from './views/ClientesView';
import ComprasView from './views/ComprasView';
import ProveedoresView from './views/ProveedoresView';
import VendedoresView, { initialVendedores } from './views/VendedoresView';
import ReportesView from './views/ReportesView';
import AdministracionView, { AfipConfig, EmailConfig, CustomTheme, Proveedor } from './views/AdministracionView';
import ChequesView, { mockCheques } from './views/ChequesView';
import CajaView from './views/CajaView';
import ControlCajaView from './views/ControlCajaView';
import ServerManagerView from './views/ServerManagerView';
import { Product } from './components/ProductModal';
import InformesView from './views/InformesView2';
import DashboardView from './views/DashboardView';
import LoginScreen from './components/LoginScreen';
import Toast from './components/Toast';
import { StockFacilLogo, SparklesIcon, XMarkIcon, PaperAirplaneIcon } from './components/Icons';
import { PromocionesView, Promocion } from './views/PromocionesView';
// Import PDF positioning utilities to force inclusion
import { getPositioningConstants, POSITIONING_X_OFFSET, POSITIONING_Y_OFFSET, calculateLetterPosition, LETTER_POSITIONING_OFFSET } from './src/pdf-positioning';

// Importar componentes Supabase
import { ConnectionStatus } from './components/ConnectionStatus';
import { useDataSource } from './hooks/useDataSource';
import DataAdapter from './services/dataAdapter';

// Mock data
const mockProveedores: Proveedor[] = [
  { cod: 'P001', razonSocial: 'Proveedor Mayorista S.A.', cuit: '30-12345678-9', telefono: '011-4567-8900', email: 'ventas@mayorista.com', direccion: 'Av. Corrientes 1234', localidad: 'CABA', provincia: 'Buenos Aires', cp: '1043', contacto: 'Juan Pérez' },
  { cod: 'P002', razonSocial: 'Distribuidora Central', cuit: '30-87654321-0', telefono: '011-5678-9012', email: 'pedidos@distribuidora.com', direccion: 'San Martín 567', localidad: 'CABA', provincia: 'Buenos Aires', cp: '1004', contacto: 'María González' },
  { cod: 'P003', razonSocial: 'Importadora Global', cuit: '30-11223344-5', telefono: '011-6789-0123', email: 'info@global.com', direccion: 'Belgrano 890', localidad: 'CABA', provincia: 'Buenos Aires', cp: '1092', contacto: 'Carlos Rodríguez' },
  { cod: 'P004', razonSocial: 'Comercial del Sur', cuit: '30-55667788-9', telefono: '011-7890-1234', email: 'contacto@delsur.com', direccion: 'Rivadavia 345', localidad: 'CABA', provincia: 'Buenos Aires', cp: '1002', contacto: 'Ana Martínez' }
];

// Centralized type definitions
export interface SaleItem {
  cod: string;
  desc: string;
  quantity: number;
  price: number;
  discount: number;
}

export interface PurchaseItem {
    cod: string;
    desc: string;
    quantity: number;
    cost: number;
}

export type DocumentType = 'invoice' | 'quote' | 'delivery-note' | 'credit-note' | 'debit-note' | 'invoice-voided';

export interface SaleDocument {
    id: number;
    type: DocumentType;
    customer: Customer;
    vendedor: Vendedor;
    items: SaleItem[];
    subtotal: number;
    totalDiscount: number;
    total: number;
    date: string;
    paymentMethod?: string; // efectivo, debito, credito, mercadopago, modo
    // AFIP electronic invoicing fields
    cae?: string;
    caeVencimiento?: string;
    numeroComprobante?: string;
    associatedInvoiceId?: number;
    // If this invoice comes from a delivery note, link it here to avoid double stock deduction
    fromDeliveryNoteId?: number;
    // Idempotency flag to avoid reprocessing stock/caja for the same document
    stockProcessed?: boolean;
}

export interface PurchaseDocument {
    id: number;
    proveedor: Proveedor;
    items: PurchaseItem[];
    total: number;
    date: string;
    paymentMethod: 'efectivo' | 'transferencia' | 'cheque';
    chequeDetails?: {
        banco: string;
        fechaEmision: string; // YYYY-MM-DD
        fechaCobro?: string; // YYYY-MM-DD
        emisor: string;
        numeroCheque: string;
        cruzado: boolean;
    };
}

export interface VendedorPermissions {
  canAccessDashboard: boolean;
  canAccessVentas: boolean;
  canAccessArticulos: boolean;
  canAccessClientes: boolean;
  canAccessCompras: boolean;
  canAccessProveedores: boolean;
  canAccessVendedores: boolean;
  canAccessReportes: boolean;
  canAccessCaja: boolean;
  canAccessAdministracion: boolean;
  canChangePrice: boolean; // Not yet implemented in UI, but permission is ready
  canApplyDiscount: boolean;
}

export interface Vendedor {
    cod: string;
    clave: string;
    nombre: string;
    comision: number;
    telefono: string;
    email: string;
    permissions: VendedorPermissions;
}

export interface Cheque {
  id: number;
  numero: string;
  banco: string;
  fechaEmision: string; // Storing as 'YYYY-MM-DD' for simplicity
  fechaCobro: string;   // Storing as 'YYYY-MM-DD' for simplicity
  importe: number;
  cliente: string; // For simplicity, just the customer name
  estado: 'En Cartera' | 'Depositado' | 'Rechazado' | 'Cobrado';
}

export interface CajaMovimiento {
  id: number;
  fecha: string; // ISO string for date and time
  concepto: string;
    tipo: 'Apertura' | 'Ingreso Venta' | 'Ingreso Manual' | 'Egreso Manual' | 'Egreso Compra' | 'Cierre';
  importe: number; // Positive for income, negative for expense
  usuario: string;
}

export interface CajaEstado {
  abierta: boolean;
  fechaApertura: string | null; // ISO string
  saldoInicial: number;
  movimientos: CajaMovimiento[];
}

export interface CompanyInfo {
    nombre: string;
    cuit?: string;
    direccion: string;
    telefono: string;
    email: string;
    ingresosBrutos: string;
    inicioActividades: string;
}

export interface TicketElement {
    id: string;
    type: 'text' | 'line' | 'image' | 'qr' | 'barcode' | 'table';
    content?: string;
    fontSize?: number;
    align?: 'left' | 'center' | 'right';
    bold?: boolean;
    marginTop?: number;
    marginBottom?: number;
    visible?: boolean;
}

export interface TicketTemplate {
    name: string;
    elements: TicketElement[];
    enabled?: boolean; // Si está en true, usa este diseño personalizado. Si false/undefined, usa el por defecto
}

export interface KioskConfig {
    enabled: boolean;
    ticketWidth: '80mm' | '58mm' | '48mm';
    autoPrint: boolean;
    templates?: {
        facturaA?: TicketTemplate;
        facturaB?: TicketTemplate;
        remito?: TicketTemplate;
    };
}

export interface AutoBackupConfig {
    enabled: boolean;
    backupOnExit: boolean;
    intervalMinutes: number; // 0 = deshabilitado, 60 = cada 1 hora, etc.
    lastBackupTime?: number; // timestamp
}

export interface ControlCajaConfig {
    enabled: boolean;
    // Email automation for Control de Caja
    emailEnabled?: boolean; // Master toggle
    recipientEmail?: string; // Default destination
    sendOnVendorChange?: boolean; // Send when the active vendor changes
    sendOnCajaClose?: boolean; // Send on caja close
    // Scheduled emails
    scheduledEmailEnabled?: boolean; // Enable scheduled emails
    scheduledEmailTimes?: string[]; // Array of times in HH:mm format (e.g., ["12:00", "18:00"])
}

export interface ServerManagerConfig {
    enabled: boolean;
}

export interface NetworkConfig {
    serverMode: 'local' | 'client';
    serverUrl: string; // URL del servidor (ej: ws://192.168.1.100:3000)
    autoSyncMode?: 'instant' | 'delay10' | 'delay30'; // modo de conexión automática
}

export interface SystemConfig {
    persistSaleOnViewChange: boolean; // Mantener venta al cambiar de vista
    loginBackgroundImage: string; // Imagen de fondo de la pantalla de login
    dashboardBackgroundImage: string; // Imagen de fondo del dashboard interno
}

export interface Marca {
    id: string;
    nombre: string;
}

export interface Familia {
    id: string;
    nombre: string;
}

export type ViewType = 'dashboard' | 'ventas' | 'articulos' | 'clientes' | 'compras' | 'proveedores' | 'vendedores' | 'reportes' | 'administracion' | 'cheques' | 'caja' | 'informes' | 'controlcaja' | 'servers' | 'promociones';

export type Theme = 'light' | 'dark-contrast' | 'ocean' | 'desert' | string;
export type AiProvider = 'gemini' | 'openai' | 'openrouter' | 'huggingface';

const viewPermissionMap: Record<ViewType, keyof VendedorPermissions | null> = {
    dashboard: 'canAccessDashboard',
    ventas: 'canAccessVentas',
    articulos: 'canAccessArticulos',
    clientes: 'canAccessClientes',
    compras: 'canAccessCompras',
    proveedores: 'canAccessProveedores',
    vendedores: 'canAccessVendedores',
    reportes: 'canAccessReportes',
    administracion: 'canAccessAdministracion',
    cheques: null, // Cheques view accessible to anyone who can access the main sections
    caja: 'canAccessCaja',
    controlcaja: 'canAccessCaja',
    informes: 'canAccessReportes', // Governed by the main reports permission
    servers: null,
    promociones: 'canAccessArticulos', // Governed by the articulos permission
};


// --- Database Definition (Dexie.js) ---
const db = new Dexie('PuntoDeVentasDB') as Dexie & {
    products: Table<Product, string>;
    clients: Table<Customer, string>;
    proveedores: Table<Proveedor, string>;
    vendedores: Table<Vendedor, string>;
    marcas: Table<Marca, string>;
    familias: Table<Familia, string>;
    saleDocuments: Table<SaleDocument, number>;
    purchaseDocuments: Table<PurchaseDocument, number>;
    cheques: Table<Cheque, number>;
    promociones: Table<Promocion, string>;
    appState: Table<{ key: string; value: any }, string>;
    activations: Table<any, number>;
};

db.version(1).stores({
    products: 'cod, desc, marca, proveedor',
    clients: 'cod, razonSocial, docNro',
    proveedores: 'cod, razonSocial, cuit',
    vendedores: 'cod, nombre',
    marcas: 'id, nombre',
    familias: 'id, nombre',
    saleDocuments: '++id, date, type, customer.cod',
    purchaseDocuments: '++id, date, proveedor.cod',
    cheques: 'id, numero, fechaCobro, estado',
    promociones: 'id, codigo, detalle',
    appState: 'key',
    activations: '++id, hardwareId, status'
});

db.version(2).stores({}).upgrade(tx => {
    return tx.table('vendedores').toCollection().modify(vendedor => {
        if (!vendedor.permissions) {
            const isAdmin = vendedor.cod === '0';
            vendedor.permissions = {
                canAccessDashboard: true, canAccessVentas: isAdmin, canAccessArticulos: isAdmin, canAccessClientes: isAdmin,
                canAccessCompras: isAdmin, canAccessProveedores: isAdmin, canAccessVendedores: isAdmin,
                canAccessReportes: isAdmin, canAccessCaja: isAdmin, canAccessAdministracion: isAdmin,
                canChangePrice: isAdmin, canApplyDiscount: isAdmin,
            };
        }
    });
});

db.version(3).upgrade(tx => {
    const initialVendedoresMap = new Map(initialVendedores.map(v => [v.cod, v]));
    return tx.table('vendedores').toCollection().modify(vendedor => {
        const template = initialVendedoresMap.get(vendedor.cod);
        if (template) {
            vendedor.permissions = { ...template.permissions };
        }
    });
});

db.version(4).upgrade(tx => {
    return tx.table('vendedores').toCollection().modify(vendedor => {
        if (vendedor.permissions && typeof vendedor.permissions.canAccessDashboard === 'undefined') {
            vendedor.permissions.canAccessDashboard = true; // Grant dashboard access to all existing users
        }
    });
});

db.version(5).upgrade(tx => {
    return tx.table('vendedores').toCollection().modify(vendedor => {
        if (typeof vendedor.clave === 'undefined') {
            vendedor.clave = vendedor.cod; // Set default password to be the same as the code
        }
    });
});


const initialAfipConfig: AfipConfig = {
    cuit: '',
    puntoVenta: '',
    url: '',
    condicionIVA: 'Responsable Inscripto',
    ambiente: 'produccion',
    certificado: '',
    printerModel: 'none',
};

const initialEmailConfig: EmailConfig = {
    user: '',
    appPassword: '',
    configured: false,
};

const initialCompanyInfo: CompanyInfo = {
    nombre: '',
    direccion: '',
    telefono: '',
    email: '',
    ingresosBrutos: '',
    inicioActividades: '',
};

const initialKioskConfig: KioskConfig = {
    enabled: false,
    ticketWidth: '80mm',
    autoPrint: false,
    templates: {}
};

const initialAutoBackupConfig: AutoBackupConfig = {
    enabled: false,
    backupOnExit: true,
    intervalMinutes: 0, // 0 = deshabilitado
    lastBackupTime: undefined
};

const initialControlCajaConfig: ControlCajaConfig = {
    enabled: false,
    emailEnabled: false,
    recipientEmail: '',
    sendOnVendorChange: false,
    sendOnCajaClose: false,
};

const initialServerManagerConfig: ServerManagerConfig = {
    enabled: false
};

const initialNetworkConfig: NetworkConfig = {
    serverMode: 'local',
    serverUrl: 'ws://localhost:3000',
    autoSyncMode: 'delay10'
};

const initialSystemConfig: SystemConfig = {
    persistSaleOnViewChange: true, // Por defecto activado para mejor UX
    loginBackgroundImage: '/assets/dashboard-bg-1.svg', // Imagen por defecto de la pantalla de login
    dashboardBackgroundImage: '/assets/dashboard-bg-1.svg' // Imagen por defecto del dashboard interno
};

// --- DB Initialization and Migration ---
async function initializeDatabase() {
    const [productCount, documentCount] = await Promise.all([
        db.products.count(),
        db.saleDocuments.count()
    ]);
    
    // Si no hay productos O no hay documentos, cargar datos de prueba
    if (productCount === 0 || documentCount === 0) {
        await seedWithMockData();
    }
}

async function seedWithMockData() {
    await db.transaction('rw', db.tables, async () => {
        // Solo agregar productos si no existen
        const existingProductCount = await db.products.count();
        if (existingProductCount === 0) {
            await db.products.bulkPut(initialProducts);
        }
        
        // Solo agregar clientes si no existen
        const existingClientCount = await db.clients.count();
        if (existingClientCount === 0) {
            const mockClientsWithAddress: Customer[] = [
                { cod: 'CF', razonSocial: 'Consumidor Final', contacto: '', telefono: '', celular: '', docTipo: 'DNI', docNro: '99999999', condicionIVA: 'Consumidor Final', email: '', direccion: '' },
                { cod: 'C001', razonSocial: 'Cliente Ejemplo S.A.', contacto: 'Juan Perez', telefono: '1122334455', celular: '1122334455', docTipo: 'CUIT', docNro: '30-70123456-7', condicionIVA: 'Responsable Inscripto', email: 'juan.perez@ejemplo.com', direccion: 'Av. Siempre Viva 123' },
                { cod: 'C002', razonSocial: 'Juan Pérez', contacto: 'Juan Pérez', telefono: '2233445566', celular: '2233445566', docTipo: 'DNI', docNro: '25123456', condicionIVA: 'Consumidor Final', email: 'juan.perez.personal@email.com', direccion: 'Calle Falsa 456' },
            ];
            await db.clients.bulkPut(mockClientsWithAddress);
        }
        
        // Solo agregar otros datos si no existen
        const existingProveedorCount = await db.proveedores.count();
        if (existingProveedorCount === 0) {
            await db.proveedores.bulkPut(mockProveedores);
        }
        
        const existingVendedorCount = await db.vendedores.count();
        if (existingVendedorCount === 0) {
            await db.vendedores.bulkPut(initialVendedores);
        }
        
        const existingChequeCount = await db.cheques.count();
        if (existingChequeCount === 0) {
            await db.cheques.bulkPut(mockCheques);
        }
        
        // Agregar documentos de venta de prueba solo si no existen
        const existingDocumentCount = await db.saleDocuments.count();
        if (existingDocumentCount === 0) {
            const mockClientsWithAddress: Customer[] = [
                { cod: 'CF', razonSocial: 'Consumidor Final', contacto: '', telefono: '', celular: '', docTipo: 'DNI', docNro: '99999999', condicionIVA: 'Consumidor Final', email: '', direccion: '' },
                { cod: 'C001', razonSocial: 'Cliente Ejemplo S.A.', contacto: 'Juan Perez', telefono: '1122334455', celular: '1122334455', docTipo: 'CUIT', docNro: '30-70123456-7', condicionIVA: 'Responsable Inscripto', email: 'juan.perez@ejemplo.com', direccion: 'Av. Siempre Viva 123' },
                { cod: 'C002', razonSocial: 'Juan Pérez', contacto: 'Juan Pérez', telefono: '2233445566', celular: '2233445566', docTipo: 'DNI', docNro: '25123456', condicionIVA: 'Consumidor Final', email: 'juan.perez.personal@email.com', direccion: 'Calle Falsa 456' },
            ];
            const mockSaleDocuments: SaleDocument[] = [
                {
                    id: 1,
                    type: 'invoice',
                    customer: mockClientsWithAddress[1], // Cliente Ejemplo S.A.
                    vendedor: initialVendedores[0], // admin
                    items: [
                        { cod: 'P001', desc: 'Producto A', quantity: 2, price: 100.00, discount: 0 },
                        { cod: 'P002', desc: 'Producto B', quantity: 1, price: 50.00, discount: 10 }
                    ],
                    subtotal: 250.00,
                    totalDiscount: 5.00,
                    total: 245.00,
                    date: '20/10/2025'
                },
                {
                    id: 2,
                    type: 'quote',
                    customer: mockClientsWithAddress[2], // Juan Pérez
                    vendedor: initialVendedores[1], // vendedor
                    items: [
                        { cod: 'P003', desc: 'Producto C', quantity: 3, price: 75.00, discount: 0 }
                    ],
                    subtotal: 225.00,
                    totalDiscount: 0,
                    total: 225.00,
                    date: '19/10/2025'
                },
                {
                    id: 3,
                    type: 'delivery-note',
                    customer: mockClientsWithAddress[0], // Consumidor Final
                    vendedor: initialVendedores[0], // admin
                    items: [
                        { cod: 'P001', desc: 'Producto A', quantity: 1, price: 100.00, discount: 0 }
                    ],
                    subtotal: 100.00,
                    totalDiscount: 0,
                    total: 100.00,
                    date: '18/10/2025'
                }
            ];
            
            await db.saleDocuments.bulkPut(mockSaleDocuments);
        }
        
        // Configuraciones del sistema
    const appStateKeys = ['backgroundImage', 'afipConfig', 'emailConfig', 'companyInfo', 'kioskConfig', 'caja', 'lastView', 'companyLogo', 'dolarBlue', 'geminiApiKey', 'openaiApiKey', 'openrouterApiKey', 'openrouterModel', 'huggingfaceApiKey', 'huggingfaceModel', 'huggingfaceUseV1', 'huggingfaceBillTo', 'aiProvider', 'theme', 'customThemes', 'aiFullAccess', 'systemConfig'];
        
        for (const key of appStateKeys) {
            const existing = await db.appState.get(key);
            if (!existing) {
                switch (key) {
                    case 'backgroundImage':
                        await db.appState.put({ key, value: 'https://picsum.photos/seed/nature/1600/900' });
                        break;
                    case 'afipConfig':
                        await db.appState.put({ key, value: initialAfipConfig });
                        break;
                    case 'emailConfig':
                        await db.appState.put({ key, value: initialEmailConfig });
                        break;
                    case 'companyInfo':
                        await db.appState.put({ key, value: initialCompanyInfo });
                        break;
                    case 'kioskConfig':
                        await db.appState.put({ key, value: initialKioskConfig });
                        break;
                    case 'caja':
                        await db.appState.put({ key, value: { abierta: false, fechaApertura: null, saldoInicial: 0, movimientos: [] } as CajaEstado });
                        break;
                    case 'lastView':
                        await db.appState.put({ key, value: { view: 'dashboard', reportType: null } });
                        break;
                    case 'companyLogo':
                        await db.appState.put({ key, value: null });
                        break;
                    case 'dolarBlue':
                        await db.appState.put({ key, value: 1250.00 });
                        break;
                    case 'geminiApiKey':
                    case 'openaiApiKey':
                    case 'openrouterApiKey':
                    case 'huggingfaceApiKey':
                        await db.appState.put({ key, value: '' });
                        break;
                    case 'openrouterModel':
                        await db.appState.put({ key, value: 'meta-llama/llama-3.1-8b-instruct:free' });
                        break;
                    case 'huggingfaceModel':
                        await db.appState.put({ key, value: 'mistralai/Mistral-7B-Instruct-v0.2' });
                        break;
                    case 'aiProvider':
                        await db.appState.put({ key, value: 'gemini' });
                        break;
                    case 'huggingfaceUseV1':
                        await db.appState.put({ key, value: false });
                        break;
                    case 'huggingfaceBillTo':
                        await db.appState.put({ key, value: '' });
                        break;
                    case 'theme':
                        await db.appState.put({ key, value: 'light' });
                        break;
                    case 'customThemes':
                        await db.appState.put({ key, value: [] });
                        break;
                }
            }
        }
    });
}

// --- AI Assistant Component ---
interface AIAssistantProps {
    documents: SaleDocument[];
    purchases: PurchaseDocument[];
    cheques: Cheque[];
    products: Product[];
    clients: Customer[];
    proveedores: Proveedor[];
    vendedores: Vendedor[];
    currentUser: Vendedor;
    geminiApiKey: string;
    openaiApiKey: string;
    openrouterApiKey: string;
    openrouterModel: string;
    huggingfaceApiKey: string;
    huggingfaceModel: string;
    huggingfaceUseV1: boolean;
    huggingfaceBillTo: string;
    aiProvider: AiProvider;
    aiFullAccess: boolean;
    addDocument: (doc: Omit<SaleDocument, 'id' | 'date'>) => Promise<SaleDocument>;
    onBulkUpdateProducts: (products: Product[]) => void;
    onAddPurchase: (doc: Omit<PurchaseDocument, 'id' | 'date'>) => Promise<void>;
    onSaveCheque: (data: Omit<Cheque, 'id'>) => Promise<void>;
    onVoidInvoice: (doc: SaleDocument) => Promise<void>;
}

interface ChatMessage {
    sender: 'user' | 'ai';
    text: string;
}

const AIAssistant: React.FC<AIAssistantProps> = ({ documents, purchases, cheques, products, clients, proveedores, vendedores, currentUser, geminiApiKey, openaiApiKey, openrouterApiKey, openrouterModel, huggingfaceApiKey, huggingfaceModel, huggingfaceUseV1, huggingfaceBillTo, aiProvider, aiFullAccess, addDocument, onBulkUpdateProducts, onAddPurchase, onSaveCheque, onVoidInvoice }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    
    const activeApiKey = aiProvider === 'openrouter' ? openrouterApiKey : (aiProvider === 'gemini' ? geminiApiKey : (aiProvider === 'openai' ? openaiApiKey : huggingfaceApiKey));

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        if (isOpen && messages.length === 0) {
            if (activeApiKey) {
                setMessages([{ sender: 'ai', text: '¡Hola! Soy FX-AI. ¿En qué puedo ayudarte hoy? Puedes pedirme que cree presupuestos, remitos o que te dé información sobre ventas, productos y clientes.' }]);
            } else {
                const providerName = aiProvider === 'gemini' ? 'Gemini' : aiProvider === 'openai' ? 'OpenAI' : aiProvider === 'openrouter' ? 'OpenRouter' : 'Hugging Face';
                setMessages([{ sender: 'ai', text: `¡Hola! Para activarme, por favor ingresa tu Clave de API de ${providerName} en la sección 'Administración'.` }]);
            }
        }
        scrollToBottom();
    }, [messages, isOpen, activeApiKey, aiProvider]);

    // --- Gemini Function Calling Definitions ---
    const createQuoteFunction: FunctionDeclaration = {
        name: 'createQuote',
        description: "Crea un nuevo presupuesto (presupuesto de venta). Esta función crea el documento directamente, no es una simulación. Utilízala cuando el usuario pida cotizar, presupuestar o preparar un presupuesto para un cliente con artículos específicos. No uses parámetros que no estén definidos en el esquema.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                customerCode: { type: Type.STRING, description: "El código único del cliente para quien es el presupuesto. El modelo debe inferir este código a partir del nombre o la razón social proporcionada por el usuario y la lista de clientes disponibles." },
                items: {
                    type: Type.ARRAY,
                    description: "Una lista de artículos para incluir en el presupuesto.",
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            productCode: { type: Type.STRING, description: "El código único del producto." },
                            quantity: { type: Type.NUMBER, description: "La cantidad del producto a incluir." }
                        },
                        required: ["productCode", "quantity"]
                    }
                }
            },
            required: ["customerCode", "items"]
        }
    };
    
    const createDeliveryNoteFunction: FunctionDeclaration = {
        name: 'createDeliveryNote',
        description: "Crea una nueva nota de entrega (remito). Esta función crea el documento directamente, no es una simulación. Utilízala cuando el usuario pida crear un remito, una nota de entrega o un albarán para un cliente. No uses parámetros que no estén definidos en el esquema.",
         parameters: {
            type: Type.OBJECT,
            properties: {
                customerCode: { type: Type.STRING, description: "El código único del cliente. El modelo debe inferir este código a partir del nombre o la razón social proporcionada por el usuario y la lista de clientes disponibles." },
                items: {
                    type: Type.ARRAY,
                    description: "Una lista de artículos para incluir en el remito.",
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            productCode: { type: Type.STRING, description: "El código único del producto." },
                            quantity: { type: Type.NUMBER, description: "La cantidad del producto a incluir." }
                        },
                         required: ["productCode", "quantity"]
                    }
                }
            },
            required: ["customerCode", "items"]
        }
    };

    const updateProductPricesFunction: FunctionDeclaration = {
        name: 'updateProductPrices',
        description: "Modifica los precios de los artículos. Puede establecer un valor fijo, aumentar por un porcentaje o un monto fijo. Se puede aplicar a todos los productos, a productos de una marca específica, o a productos individuales por su código.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                priceList: {
                    type: Type.STRING,
                    description: "La lista de precios a modificar. Valores válidos: 'lista1', 'lista2', 'lista3', 'lista4', 'costo'."
                },
                updateType: {
                    type: Type.STRING,
                    description: "El tipo de actualización a realizar. Valores válidos: 'set' (establecer valor fijo), 'increase_percent' (aumentar por porcentaje), 'increase_amount' (aumentar por monto fijo)."
                },
                value: {
                    type: Type.NUMBER,
                    description: "El valor a utilizar para la actualización (el nuevo precio, el porcentaje de aumento, o el monto a sumar)."
                },
                filters: {
                    type: Type.OBJECT,
                    description: "Filtros opcionales para aplicar la actualización solo a un subconjunto de productos.",
                    properties: {
                        productCodes: {
                            type: Type.ARRAY,
                            description: "Una lista de códigos de producto específicos a los que se aplicará la actualización.",
                            items: { type: Type.STRING }
                        },
                        brand: {
                            type: Type.STRING,
                            description: "La marca o rubro de los productos a los que se aplicará la actualización."
                        }
                    }
                }
            },
            required: ["priceList", "updateType", "value"]
        }
    };

    // Full-access tools (gated)
    const createInvoiceFunction: FunctionDeclaration = {
        name: 'createInvoice',
        description: 'Crea una nueva Factura (comprobante de venta) con los ítems especificados.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                customerCode: { type: Type.STRING, description: 'Código del cliente' },
                items: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            productCode: { type: Type.STRING },
                            quantity: { type: Type.NUMBER }
                        },
                        required: ['productCode', 'quantity']
                    }
                }
            },
            required: ['customerCode', 'items']
        }
    };

    const createPurchaseFunction: FunctionDeclaration = {
        name: 'createPurchase',
        description: 'Registra una nueva compra con proveedor, ítems y método de pago (actualiza stock y caja).',
        parameters: {
            type: Type.OBJECT,
            properties: {
                proveedorCode: { type: Type.STRING, description: 'Código del proveedor' },
                items: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            productCode: { type: Type.STRING },
                            quantity: { type: Type.NUMBER },
                            cost: { type: Type.NUMBER }
                        },
                        required: ['productCode', 'quantity', 'cost']
                    }
                },
                paymentMethod: { type: Type.STRING, description: "'efectivo' | 'transferencia' | 'cheque'" },
                chequeDetails: {
                    type: Type.OBJECT,
                    properties: {
                        banco: { type: Type.STRING },
                        fechaEmision: { type: Type.STRING },
                        fechaCobro: { type: Type.STRING },
                        emisor: { type: Type.STRING },
                        numeroCheque: { type: Type.STRING },
                        cruzado: { type: Type.BOOLEAN }
                    }
                }
            },
            required: ['proveedorCode', 'items', 'paymentMethod']
        }
    };

    const createChequeFunction: FunctionDeclaration = {
        name: 'createCheque',
        description: 'Crea un registro de cheque en la cartera.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                numero: { type: Type.STRING },
                banco: { type: Type.STRING },
                fechaEmision: { type: Type.STRING },
                fechaCobro: { type: Type.STRING },
                importe: { type: Type.NUMBER },
                cliente: { type: Type.STRING }
            },
            required: ['numero', 'banco', 'fechaEmision', 'fechaCobro', 'importe', 'cliente']
        }
    };

    const updateStockFunction: FunctionDeclaration = {
        name: 'updateStock',
        description: 'Actualiza stock de productos por cantidad fija (set) o ajustando (+/-).',
        parameters: {
            type: Type.OBJECT,
            properties: {
                mode: { type: Type.STRING, description: "'set' | 'increase' | 'decrease'" },
                value: { type: Type.NUMBER, description: 'Valor para set o cantidad a ajustar' },
                productCodes: { type: Type.ARRAY, items: { type: Type.STRING } },
                brand: { type: Type.STRING }
            },
            required: ['mode', 'value']
        }
    };

    const voidInvoiceFunction: FunctionDeclaration = {
        name: 'voidInvoice',
        description: 'Anula una factura existente y revierte stock/caja.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                invoiceId: { type: Type.NUMBER }
            },
            required: ['invoiceId']
        }
    };

    const getDataFunction: FunctionDeclaration = {
        name: 'getData',
        description: 'Obtiene datos resumidos de ventas, compras, cheques o productos con filtros básicos.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                entity: { type: Type.STRING, description: "'ventas'|'compras'|'cheques'|'productos'" },
                limit: { type: Type.NUMBER },
                since: { type: Type.STRING, description: 'Fecha desde (YYYY-MM-DD)' },
                brand: { type: Type.STRING },
                text: { type: Type.STRING, description: 'Filtro por texto en descripción o razón social' },
                vendedorCode: { type: Type.STRING, description: 'Filtra ventas por código de vendedor (solo entity="ventas")' },
                vendedorName: { type: Type.STRING, description: 'Filtra ventas por nombre de vendedor (solo entity="ventas")' }
            },
            required: ['entity']
        }
    };

    const handleFunctionCall = async (functionName: string, args: any): Promise<ChatMessage> => {
        if (functionName === 'createQuote' || functionName === 'createDeliveryNote') {
            const docType: DocumentType = functionName === 'createQuote' ? 'quote' : 'delivery-note';
            const { customerCode, items: itemArgs } = args;

            const customer = clients.find(c => c.cod.toLowerCase() === customerCode.toLowerCase());
            if (!customer) {
                return { sender: 'ai', text: `No pude encontrar al cliente con el código "${customerCode}". Por favor, verifica el código.` };
            }
            
            const saleItems: SaleItem[] = [];
            for (const item of itemArgs) {
                const product = products.find(p => p.cod.toLowerCase() === item.productCode.toLowerCase());
                if (!product) {
                    return { sender: 'ai', text: `No pude encontrar el producto con el código "${item.productCode}". Por favor, verifica el código e inténtalo de nuevo.` };
                }
                saleItems.push({
                    cod: product.cod,
                    desc: product.desc,
                    quantity: item.quantity,
                    price: (product.lista1 ?? product.precioVenta),
                    discount: 0,
                });
            }
            
            if (saleItems.length === 0) {
                return { sender: 'ai', text: "No se especificaron artículos válidos para crear el documento." };
            }

            const subtotal = saleItems.reduce((acc, item) => acc + item.quantity * item.price, 0);
            
            try {
                const newDoc = await addDocument({
                    type: docType,
                    customer,
                    vendedor: currentUser,
                    items: saleItems,
                    subtotal,
                    totalDiscount: 0,
                    total: subtotal,
                });
                const docTypeName = docType === 'quote' ? 'Presupuesto' : 'Remito';
                return { sender: 'ai', text: `¡Listo! He creado el ${docTypeName} N° ${String(newDoc.id).padStart(8, '0')} para ${customer.razonSocial}. Ya puedes consultarlo en la sección "Consulta Ventas".`};
            } catch (error) {
                console.error("Error creating document from AI:", error);
                return { sender: 'ai', text: "Ocurrió un error al intentar guardar el documento en la base de datos." };
            }
    } else if (functionName === 'updateProductPrices') {
            const { priceList, updateType, value, filters } = args;

            const validPriceLists: (keyof Product)[] = ['costo', 'lista1', 'lista2', 'lista3', 'lista4', 'ganancia'];
            if (!validPriceLists.includes(priceList)) {
                return { sender: 'ai', text: `La lista de precios '${priceList}' no es válida. Las opciones son: ${validPriceLists.join(', ')}.` };
            }

            let targetProducts = [...products];
            if (filters) {
                if (filters.brand) {
                    targetProducts = targetProducts.filter(p => p.marca?.toLowerCase() === filters.brand.toLowerCase());
                }
                if (filters.productCodes && Array.isArray(filters.productCodes) && filters.productCodes.length > 0) {
                    const codeSet = new Set(filters.productCodes.map((c: string) => c.toLowerCase()));
                    targetProducts = targetProducts.filter(p => codeSet.has(p.cod.toLowerCase()));
                }
            }

            if (targetProducts.length === 0) {
                return { sender: 'ai', text: 'No encontré productos que coincidan con los filtros especificados.' };
            }

            const updatedProducts = targetProducts.map(p => {
                const newProduct = { ...p };
                const currentPrice = (newProduct[priceList as keyof Product] as number) || 0;
                let newPrice = currentPrice;

                switch (updateType) {
                    case 'set': newPrice = value; break;
                    case 'increase_percent': newPrice = currentPrice * (1 + value / 100); break;
                    case 'increase_amount': newPrice = currentPrice + value; break;
                }

                (newProduct as any)[priceList] = Math.round(newPrice * 100) / 100;

             if ((priceList === 'costo' || priceList === 'ganancia') && newProduct.lista1Calculada) {
                 const updatedCost = priceList === 'costo' ? newPrice : (newProduct.costo || 0);
                 const updatedGanancia = priceList === 'ganancia' ? newPrice : Number(newProduct.ganancia || 0);
                     const recalculatedPrice = updatedCost * (1 + updatedGanancia / 100);
                     newProduct.lista1 = Math.round(recalculatedPrice * 100) / 100;
                }

                return newProduct;
            });
            
            onBulkUpdateProducts(updatedProducts);
            
            return { sender: 'ai', text: `¡Hecho! He actualizado los precios de ${updatedProducts.length} productos según tus instrucciones.` };
        } else if (functionName === 'createInvoice' && aiFullAccess) {
            const { customerCode, items: itemArgs } = args;
            const customer = clients.find(c => c.cod.toLowerCase() === String(customerCode).toLowerCase());
            if (!customer) return { sender: 'ai', text: `No encontré el cliente ${customerCode}.` };
            const saleItems: SaleItem[] = [];
            for (const item of itemArgs) {
                const p = products.find(pp => pp.cod.toLowerCase() === String(item.productCode).toLowerCase());
                if (!p) return { sender: 'ai', text: `Producto ${item.productCode} no encontrado.` };
                saleItems.push({ cod: p.cod, desc: p.desc, quantity: item.quantity, price: (p.lista1 ?? p.precioVenta), discount: 0 });
            }
            const subtotal = saleItems.reduce((a, it) => a + it.quantity * it.price, 0);
            const newDoc = await addDocument({ type: 'invoice', customer, vendedor: currentUser, items: saleItems, subtotal, totalDiscount: 0, total: subtotal });
            return { sender: 'ai', text: `Factura creada (ID ${newDoc.id}) por $${newDoc.total.toFixed(2)} para ${customer.razonSocial}.` };
        } else if (functionName === 'createPurchase' && aiFullAccess) {
            const { proveedorCode, items: pItems, paymentMethod, chequeDetails } = args;
            const prov = proveedores.find(p => p.cod.toLowerCase() === String(proveedorCode).toLowerCase());
            if (!prov) return { sender: 'ai', text: `Proveedor ${proveedorCode} no encontrado.` };
            const purchaseItems: PurchaseItem[] = [];
            for (const it of pItems) {
                const prod = products.find(x => x.cod.toLowerCase() === String(it.productCode).toLowerCase());
                if (!prod) return { sender: 'ai', text: `Producto ${it.productCode} no encontrado.` };
                purchaseItems.push({ cod: prod.cod, desc: prod.desc, quantity: Number(it.quantity), cost: Number(it.cost) });
            }
            const total = purchaseItems.reduce((a, it) => a + it.quantity * it.cost, 0);
            await onAddPurchase({ proveedor: prov, items: purchaseItems, total, paymentMethod, chequeDetails });
            return { sender: 'ai', text: `Compra registrada a ${prov.razonSocial} por $${total.toFixed(2)} (${paymentMethod}).` };
        } else if (functionName === 'createCheque' && aiFullAccess) {
            const payload = { ...args, estado: 'En Cartera' } as Omit<Cheque, 'id'>;
            await onSaveCheque(payload);
            return { sender: 'ai', text: `Cheque ${payload.numero} de ${payload.banco} por $${payload.importe.toFixed(2)} guardado en cartera.` };
        } else if (functionName === 'updateStock' && aiFullAccess) {
            const { mode, value, productCodes, brand } = args;
            let target = [...products];
            if (brand) target = target.filter(p => p.marca?.toLowerCase() === String(brand).toLowerCase());
            if (productCodes?.length) {
                const codeSet = new Set(productCodes.map((c: string) => c.toLowerCase()));
                target = target.filter(p => codeSet.has(p.cod.toLowerCase()));
            }
            if (target.length === 0) return { sender: 'ai', text: 'No encontré productos para actualizar stock.' };
            const updated = target.map(p => {
                const np = { ...p } as Product;
                const v = Number(value) || 0;
                if (mode === 'set') np.stock = v; else if (mode === 'increase') np.stock = (np.stock || 0) + v; else if (mode === 'decrease') np.stock = (np.stock || 0) - v;
                return np;
            });
            onBulkUpdateProducts(updated);
            return { sender: 'ai', text: `Stock actualizado para ${updated.length} productos.` };
        } else if (functionName === 'voidInvoice' && aiFullAccess) {
            const { invoiceId } = args;
            const doc = documents.find(d => d.id === Number(invoiceId));
            if (!doc) return { sender: 'ai', text: `No encontré la factura ${invoiceId}.` };
            await onVoidInvoice(doc);
            return { sender: 'ai', text: `Factura ${invoiceId} anulada.` };
        } else if (functionName === 'getData' && aiFullAccess) {
            const { entity, limit = 20, since, brand, text, vendedorCode, vendedorName } = args;
            const sinceDate = since ? new Date(since) : null;
            const fmt = (d?: string) => d || '';
            if (entity === 'ventas') {
                let arr = [...documents];
                if (sinceDate) arr = arr.filter(d => {
                    const [dd, mm, yy] = (d.date || '').split('/').map(Number); const dt = new Date(yy, (mm || 1) - 1, dd || 1); return dt >= sinceDate!;
                });
                if (vendedorCode) {
                    const code = String(vendedorCode).toLowerCase();
                    arr = arr.filter(d => d.vendedor && d.vendedor.cod && d.vendedor.cod.toLowerCase() === code);
                }
                if (vendedorName) {
                    const name = String(vendedorName).toLowerCase();
                    arr = arr.filter(d => d.vendedor && d.vendedor.nombre && d.vendedor.nombre.toLowerCase().includes(name));
                }
                const lines = arr.slice(-limit).reverse().map(d => `#${d.id} ${d.type} ${d.customer.razonSocial} $${d.total.toFixed(2)} ${fmt(d.date)}`);
                const total = arr.reduce((a, d) => a + (d.total || 0), 0);
                const summary = arr.length ? `\nTotal ventas: $${total.toFixed(2)} en ${arr.length} comprobantes.` : '';
                return { sender: 'ai', text: (lines.join('\n') + summary) || 'Sin resultados.' };
            } else if (entity === 'compras') {
                let arr = [...purchases];
                if (sinceDate) arr = arr.filter(d => {
                    const [dd, mm, yy] = (d.date || '').split('/').map(Number); const dt = new Date(yy, (mm || 1) - 1, dd || 1); return dt >= sinceDate!;
                });
                const lines = arr.slice(-limit).reverse().map(d => `${d.proveedor.razonSocial} $${d.total.toFixed(2)} ${fmt(d.date)}`);
                return { sender: 'ai', text: lines.join('\n') || 'Sin resultados.' };
            } else if (entity === 'cheques') {
                const lines = cheques.slice(-limit).reverse().map(c => `#${c.id} ${c.numero} ${c.banco} $${c.importe.toFixed(2)} ${c.estado} emision:${c.fechaEmision} cobro:${c.fechaCobro}`);
                return { sender: 'ai', text: lines.join('\n') || 'Sin resultados.' };
            } else if (entity === 'productos') {
                let arr = [...products];
                if (brand) arr = arr.filter(p => p.marca?.toLowerCase() === String(brand).toLowerCase());
                if (text) arr = arr.filter(p => p.desc.toLowerCase().includes(String(text).toLowerCase()) || p.cod.toLowerCase().includes(String(text).toLowerCase()));
                const lines = arr.slice(0, limit).map(p => `${p.cod} ${p.desc} stock:${p.stock ?? 0} $${(p.lista1 ?? p.precioVenta).toFixed(2)}`);
                return { sender: 'ai', text: lines.join('\n') || 'Sin resultados.' };
            }
            return { sender: 'ai', text: 'Entidad no soportada.' };
        } else {
            return { sender: 'ai', text: `Error: Función desconocida "${functionName}".` };
        }
    };


    const handleSend = async () => {
        if (!input.trim() || isLoading || !activeApiKey) return;

        const userMessage: ChatMessage = { sender: 'user', text: input };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

            const contextData = {
            availableProducts: products.map(p => ({ cod: p.cod, desc: p.desc, stock: p.stock, price: (p.lista1 ?? p.precioVenta) })),
            availableCustomers: clients.map(c => ({ cod: c.cod, razonSocial: c.razonSocial })),
            availableSellers: vendedores.map(v => ({ cod: v.cod, nombre: v.nombre })),
            recentSales: documents.slice(-20).map(d => ({ id: d.id, type: d.type, customer: d.customer.razonSocial, vendedor: { cod: d.vendedor?.cod, nombre: d.vendedor?.nombre }, total: d.total, date: d.date, items: d.items.map(item => ({ productCode: item.cod, description: item.desc, quantity: item.quantity, price: item.price }))}))
        };
    let systemInstruction = `Eres un asistente experto llamado FX-AI para un software de Punto de Venta. Tu rol es triple: responder preguntas, crear documentos y modificar datos.

**1. Para Responder Preguntas:**
    - Analiza el objeto JSON 'Contexto de datos' que se te proporciona en cada prompt (contiene productos, clientes, vendedores y ventas recientes con sus artículos y vendedor).
   - Basa tus respuestas ÚNICAMENTE en esta información. Puedes hacer cálculos como sumar totales de ventas, contar productos, encontrar el stock de un artículo específico o listar los artículos dentro de un comprobante.
   - Si no encuentras la información en el contexto, indica que no tienes acceso a esos datos.

**2. Para Crear Documentos:**
   - Si el usuario pide explícitamente crear un presupuesto (cotización) o un remito (nota de entrega), DEBES usar las funciones 'createQuote' o 'createDeliveryNote'.
   - Infiere los códigos ('customerCode', 'productCode') a partir de los nombres que te dé el usuario y los datos del contexto. Si la información es ambigua, pide aclaraciones.

**3. Para Modificar Datos:**
   - Si el usuario pide modificar precios de artículos (ej: "aumenta la lista 2 un 10%", "pon el costo de 'AN113' en 100"), DEBES usar la función 'updateProductPrices'.
   - Interpreta la lista de precios ('lista1', 'lista2', 'costo', etc.), el tipo de modificación ('set', 'increase_percent', 'increase_amount') y el valor a partir de la solicitud del usuario.
   - Si el usuario menciona una marca o códigos de producto específicos, úsalos como filtros. Si no se especifica, la acción se aplicará a TODOS los productos.

**Reglas Generales:**
   - NO escribas JSON como respuesta de texto si una función está disponible. Llama a la función directamente.
   - Responde siempre en español, de forma concisa y amigable.`;
        if (aiFullAccess) {
            systemInstruction += `\n\n**Acceso total habilitado:**\n` +
            `- Para consultas de datos (ventas, compras, cheques, productos), usa la función 'getData'.\n` +
            `- Para ventas por vendedor, filtra con 'vendedorCode' o 'vendedorName'. Puedes combinar con 'since' (YYYY-MM-DD) y 'limit'.`;
        }
        const prompt = `Contexto de datos: ${JSON.stringify(contextData)}. \n\nTarea del usuario: "${input}"`;

        try {
            let aiMessage: ChatMessage;

            if (aiProvider === 'openai') {
                const mapGeminiTypeToOpenAI = (schema: any): any => {
                    if (!schema) return schema;
                    const newSchema = { ...schema };
                    if (newSchema.type) newSchema.type = newSchema.type.toLowerCase();
                    if (newSchema.items) newSchema.items = mapGeminiTypeToOpenAI(newSchema.items);
                    if (newSchema.properties) {
                        for (const key in newSchema.properties) {
                            newSchema.properties[key] = mapGeminiTypeToOpenAI(newSchema.properties[key]);
                        }
                    }
                    return newSchema;
                };

                const baseOpenAiTools = [createQuoteFunction, createDeliveryNoteFunction, updateProductPricesFunction];
                const fullAccessTools = [createInvoiceFunction, createPurchaseFunction, createChequeFunction, updateStockFunction, voidInvoiceFunction, getDataFunction];
                const openAiTools = (aiFullAccess ? [...baseOpenAiTools, ...fullAccessTools] : baseOpenAiTools).map(func => ({
                    type: 'function',
                    function: {
                        name: func.name,
                        description: func.description,
                        parameters: mapGeminiTypeToOpenAI(func.parameters)
                    }
                }));

                const response = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${openaiApiKey}`
                    },
                    body: JSON.stringify({
                        model: 'gpt-4o-mini',
                        messages: [{ role: 'system', content: systemInstruction }, { role: 'user', content: prompt }],
                        tools: openAiTools,
                        tool_choice: 'auto'
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error.message || 'Error en la API de OpenAI');
                }

                const data = await response.json();
                const message = data.choices[0].message;

                if (message.tool_calls && message.tool_calls.length > 0) {
                    const toolCall = message.tool_calls[0].function;
                    const args = JSON.parse(toolCall.arguments);
                    aiMessage = await handleFunctionCall(toolCall.name as string, args);
                } else {
                    aiMessage = { sender: 'ai', text: message.content };
                }

            } else if (aiProvider === 'openrouter') {
                // OpenRouter API - acceso a múltiples modelos con una sola API key
                const model = openrouterModel || 'meta-llama/llama-3.1-8b-instruct:free';
                
                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${openrouterApiKey}`,
                        'HTTP-Referer': window.location.origin,
                        'X-Title': 'StockFacil POS'
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [
                            { role: 'system', content: systemInstruction },
                            { role: 'user', content: prompt }
                        ],
                        tools: aiFullAccess ? [
                            { type: 'function', function: { name: createInvoiceFunction.name, description: createInvoiceFunction.description, parameters: { ...createInvoiceFunction.parameters, type: 'object' } }},
                            { type: 'function', function: { name: createPurchaseFunction.name, description: createPurchaseFunction.description, parameters: { ...createPurchaseFunction.parameters, type: 'object' } }},
                            { type: 'function', function: { name: createChequeFunction.name, description: createChequeFunction.description, parameters: { ...createChequeFunction.parameters, type: 'object' } }},
                            { type: 'function', function: { name: updateStockFunction.name, description: updateStockFunction.description, parameters: { ...updateStockFunction.parameters, type: 'object' } }},
                            { type: 'function', function: { name: voidInvoiceFunction.name, description: voidInvoiceFunction.description, parameters: { ...voidInvoiceFunction.parameters, type: 'object' } }},
                            { type: 'function', function: { name: getDataFunction.name, description: getDataFunction.description, parameters: { ...getDataFunction.parameters, type: 'object' } }}
                        ] : undefined
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error?.message || 'Error con OpenRouter API. Verifica tu API key.');
                }

                const data = await response.json();
                const message = data.choices?.[0]?.message;
                if (message?.tool_calls?.length) {
                    const call = message.tool_calls[0].function;
                    const args = JSON.parse(call.arguments);
                    aiMessage = await handleFunctionCall(call.name, args);
                } else {
                    aiMessage = { sender: 'ai', text: message?.content || 'Sin respuesta del modelo.' };
                }

            } else if (aiProvider === 'huggingface') {
                // Hugging Face Inference: two modes
                const model = huggingfaceModel || 'mistralai/Mistral-7B-Instruct-v0.2';
                if (huggingfaceUseV1) {
                    // OpenAI-compatible /v1 endpoint (chat)
                    const response = await fetch('https://api-inference.huggingface.co/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${huggingfaceApiKey}`,
                            ...(huggingfaceBillTo ? { 'X-HF-Bill-To': huggingfaceBillTo } : {})
                        },
                        body: JSON.stringify({
                            model,
                            messages: [
                                { role: 'system', content: systemInstruction },
                                { role: 'user', content: prompt }
                            ]
                        })
                    });

                    if (!response.ok) {
                        let errText = await response.text();
                        try { const j = JSON.parse(errText); errText = j.error?.message || j.error || errText; } catch {}
                        throw new Error(errText || 'Error con Hugging Face /v1 Chat API.');
                    }
                    const data = await response.json();
                    const text = data.choices?.[0]?.message?.content || '';
                    aiMessage = { sender: 'ai', text: text || 'Sin respuesta del modelo.' };
                } else {
                    // Serverless Inference API (text-generation)
                    const finalPrompt = `${systemInstruction}\n\n${prompt}`;
                    const response = await fetch(`https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${huggingfaceApiKey}`
                        },
                        body: JSON.stringify({
                            inputs: finalPrompt,
                            parameters: {
                                max_new_tokens: 512,
                                temperature: 0.3,
                                return_full_text: false
                            },
                            options: { wait_for_model: true }
                        })
                    });
    
                    if (!response.ok) {
                        let errText = await response.text();
                        try { const j = JSON.parse(errText); errText = j.error || errText; } catch {}
                        throw new Error(errText || 'Error con Hugging Face Inference API.');
                    }
    
                    const data = await response.json();
                    const text = Array.isArray(data) ? (data[0]?.generated_text ?? data[0]?.summary_text ?? '') : (data.generated_text ?? data[0]?.generated_text ?? '');
                    const cleaned = typeof text === 'string' && text.trim() ? text : 'Sin respuesta del modelo.';
                    aiMessage = { sender: 'ai', text: cleaned };
                }
            } else { // Gemini Provider
                const ai = new GoogleGenAI({ apiKey: geminiApiKey });
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: prompt,
                    config: { 
                        systemInstruction,
                        tools: [{ functionDeclarations: aiFullAccess ? [
                            createQuoteFunction, createDeliveryNoteFunction, updateProductPricesFunction,
                            createInvoiceFunction, createPurchaseFunction, createChequeFunction,
                            updateStockFunction, voidInvoiceFunction, getDataFunction
                        ] : [createQuoteFunction, createDeliveryNoteFunction, updateProductPricesFunction] }]
                    },
                });
                
                if (response.functionCalls && response.functionCalls.length > 0) {
                    const call = response.functionCalls[0];
                    if (call?.name) {
                        aiMessage = await handleFunctionCall(call.name as string, call.args);
                    } else {
                        aiMessage = { sender: 'ai', text: 'No se recibió una función válida desde la respuesta del modelo.' };
                    }
                } else {
                     const textResponse = (response as any).text as string | undefined;
                     aiMessage = { sender: 'ai', text: textResponse || 'No recibí texto de respuesta del modelo.' };
                }
            }
            
            setMessages(prev => [...prev, aiMessage]);

        } catch (error) {
            console.error("Error calling AI API:", error);
            let specificError = "Error desconocido. Revisa la consola para más detalles.";
            if (error instanceof Error) {
                specificError = error.message;
            }

            let userFriendlyMessage = `Error de la API de ${aiProvider}: ${specificError}. Por favor, verifica tu clave de API y la configuración de tu cuenta.`;

            // Customize messages for OpenRouter errors
            if (aiProvider === 'openrouter') {
                if (specificError.includes('fetch') || specificError.includes('OpenRouter')) {
                    userFriendlyMessage = `Error con OpenRouter API.

Verifica:
1. Tu API key es correcta (obtén una en https://openrouter.ai/keys)
2. Tienes créditos disponibles en tu cuenta
3. El modelo "${openrouterModel}" está disponible`;
                } else if (specificError.includes('Authorization') || specificError.includes('401')) {
                    userFriendlyMessage = `API key de OpenRouter inválida. Obtén una en https://openrouter.ai/keys`;
                } else if (specificError.includes('quota') || specificError.includes('credits')) {
                    userFriendlyMessage = `Sin créditos en OpenRouter. Recarga tu cuenta en https://openrouter.ai/credits`;
                }
            }
            
            // Customize messages for common OpenAI errors based on the specific error string from their API
            if (aiProvider === 'openai') {
                if (specificError.includes('Incorrect API key')) {
                    userFriendlyMessage = 'La clave de API de OpenAI que ingresaste es incorrecta. Por favor, corrígela en la sección de Administración y vuelve a intentarlo.';
                } else if (specificError.includes('quota') || specificError.includes('billing')) {
                    userFriendlyMessage = 'Parece que hay un problema con tu cuenta de OpenAI (límite de cuota o facturación). Por favor, revisa el estado de tu cuenta en la plataforma de OpenAI.';
                }
            }
            if (aiProvider === 'huggingface') {
                const lower = specificError.toLowerCase();
                if (specificError.includes('401') || lower.includes('authorization')) {
                    userFriendlyMessage = 'API key de Hugging Face inválida o faltante. Cárgala en Administración > Asistente IA.';
                } else if (lower.includes('insufficient permissions') && lower.includes('inference providers')) {
                    userFriendlyMessage = `Tu token de Hugging Face no tiene permisos para usar Inference Providers.

Opciones:
- Agrega un método de pago y habilita "Inference Providers" en tu cuenta de Hugging Face (Settings > Billing y luego Settings > Tokens).
- Cambia a un modelo soportado por el Inference API serverless (ej.: "HuggingFaceH4/zephyr-7b-beta").
- O crea/usa un Inference Endpoint propio y apúntalo desde la app (no configurado aún).`;
                } else if (lower.includes('model')) {
                    userFriendlyMessage = `Modelo de Hugging Face no disponible. Verifica el nombre del modelo configurado.`;
                }
            }
            
            const errorMessage: ChatMessage = { sender: 'ai', text: userFriendlyMessage };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <>
            <div className="fixed bottom-6 right-6 z-40">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="bg-blue-600 text-white rounded-full p-4 shadow-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-transform transform hover:scale-110"
                    aria-label="Abrir Asistente IA"
                >
                    {isOpen ? <XMarkIcon className="h-7 w-7" /> : <SparklesIcon className="h-7 w-7" />}
                </button>
            </div>
            
            {isOpen && (
                <div className="fixed bottom-24 right-6 z-[200] w-full max-w-sm h-[60vh] bg-[rgb(var(--color-bg-primary))] rounded-xl shadow-2xl flex flex-col border border-[rgb(var(--color-border-primary))] animate-fade-in-up">
                    <header className="p-4 bg-[rgb(var(--color-bg-tertiary))] rounded-t-xl border-b border-[rgb(var(--color-border-primary))]">
                        <h3 className="font-bold text-[rgb(var(--color-text-primary))] text-lg">Asistente IA</h3>
                    </header>
                    
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {messages.map((msg, index) => (
                            <div key={index} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl ${msg.sender === 'user' ? 'bg-[rgb(var(--color-accent))] text-[rgb(var(--color-text-on-accent))] rounded-br-none' : 'bg-[rgb(var(--color-bg-secondary))] text-[rgb(var(--color-text-primary))] rounded-bl-none'}`}>
                                    <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                                </div>
                            </div>
                        ))}
                        {isLoading && (
                            <div className="flex justify-start">
                                <div className="max-w-xs lg:max-w-md px-4 py-2 rounded-2xl bg-[rgb(var(--color-bg-secondary))] text-[rgb(var(--color-text-primary))] rounded-bl-none">
                                    <p className="text-sm italic">Procesando...</p>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    <footer className="p-4 border-t border-[rgb(var(--color-border-primary))] bg-[rgb(var(--color-bg-primary))] rounded-b-xl">
                        <div className="flex items-center space-x-2">
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                                placeholder={!activeApiKey ? "API Key no configurada..." : "Pregúntame algo..."}
                                className="flex-1 px-3 py-2 border border-[rgb(var(--color-border-primary))] rounded-full focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-accent))] disabled:bg-[rgb(var(--color-bg-input-disabled))] text-black"
                                disabled={isLoading || !activeApiKey}
                            />
                            <button onClick={handleSend} disabled={isLoading || !input.trim() || !activeApiKey} className="bg-[rgb(var(--color-accent))] text-[rgb(var(--color-text-on-accent))] rounded-full p-2 disabled:bg-[rgb(var(--color-accent-disabled))]">
                                <PaperAirplaneIcon className="h-5 w-5" />
                            </button>
                        </div>
                    </footer>
                </div>
            )}
            <style>{`
                @keyframes fade-in-up {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .animate-fade-in-up { animation: fade-in-up 0.3s ease-out forwards; }
            `}</style>
        </>
    );
};


const LoadingSpinner: React.FC = () => (
    <div className="absolute inset-0 bg-slate-100/80 flex flex-col justify-center items-center z-50">
        <svg className="animate-spin -ml-1 mr-3 h-10 w-10 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p className="mt-2 text-lg font-semibold text-slate-700">Cargando datos...</p>
    </div>
);

export type SyncStatus = 'conectado' | 'desconectado' | 'conectando';

interface ToastState {
  id: number;
  message: string;
  type: 'success' | 'info' | 'error';
  isPersistent?: boolean;
}

const viewTitles: Record<ViewType, string> = {
    dashboard: 'Dashboard',
    ventas: 'Ventas',
    articulos: 'Artículos',
    clientes: 'Clientes',
    compras: 'Compras',
    proveedores: 'Proveedores',
    vendedores: 'Vendedores',
    reportes: 'Consulta de Comprobantes',
    administracion: 'Administración',
    cheques: 'Gestión de Cheques',
    caja: 'Gestión de Caja',
    informes: 'Reportes',
    controlcaja: 'Control de Caja (Clásico)',
    servers: 'Gestor de Servidores',
    promociones: 'Promociones',
};


const App: React.FC = () => {
  // Asegurar que el código de PDF se incluya en el build
  // Constantes de posicionamiento de PDF inlineadas para evitar tree-shaking
  const LETTER_POSITIONING_OFFSET_INLINE = 7.5;
  const calculateLetterPositionInline = (yPos: number, boxX: number) => ({
    x: boxX + LETTER_POSITIONING_OFFSET_INLINE,
    y: yPos + LETTER_POSITIONING_OFFSET_INLINE
  });
  
  // Usar las funciones inlineadas
  calculateLetterPositionInline(0, 0);
  console.log('Letter positioning offset inline:', LETTER_POSITIONING_OFFSET_INLINE);
  
  calculateLetterPosition(0, 0); // Llamada dummy para incluir la función
  console.log('Letter positioning offset:', LETTER_POSITIONING_OFFSET); // Usar la constante
  
  // Usar las constantes del módulo separado
  const positioningConstants = getPositioningConstants();
  console.log('PDF positioning from module:', positioningConstants.offset, POSITIONING_X_OFFSET, POSITIONING_Y_OFFSET);
  const [activeView, setActiveView] = useState<ViewType | null>(null);
  const [reportType, setReportType] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const [backgroundImage, setBackgroundImage] = useState<string>('');
  const [theme, setTheme] = useState<Theme>('stockfacil');
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>([]);
  const [companyLogo, setCompanyLogo] = useState<string | null>(null);
  const [dashboardImage, setDashboardImage] = useState<string | null>(null);
  const [documents, setDocuments] = useState<SaleDocument[]>([]);
    const [purchaseDocuments, setPurchaseDocuments] = useState<PurchaseDocument[]>([]);
    void purchaseDocuments; // prevent unused variable error
  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<Customer[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [promociones, setPromociones] = useState<Promocion[]>([]);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [familias, setFamilias] = useState<Familia[]>([]);
  const [afipConfig, setAfipConfig] = useState<AfipConfig>(initialAfipConfig);
  const [emailConfig, setEmailConfig] = useState<EmailConfig>(initialEmailConfig);
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo>(initialCompanyInfo);
  const [kioskConfig, setKioskConfig] = useState<KioskConfig>(initialKioskConfig);
  const [autoBackupConfig, setAutoBackupConfig] = useState<AutoBackupConfig>(initialAutoBackupConfig);
  const [controlCajaConfig, setControlCajaConfig] = useState<ControlCajaConfig>(initialControlCajaConfig);
    // Track vendor session start time
    const lastVendorSwitchTimeRef = useRef<number | null>(null);
  const [serverManagerConfig, setServerManagerConfig] = useState<ServerManagerConfig>(initialServerManagerConfig);
  const [networkConfig, setNetworkConfig] = useState<NetworkConfig>(initialNetworkConfig);
  const [systemConfig, setSystemConfig] = useState<SystemConfig>(initialSystemConfig);
  const [cheques, setCheques] = useState<Cheque[]>([]);
  const [caja, setCaja] = useState<CajaEstado>({ abierta: false, fechaApertura: null, saldoInicial: 0, movimientos: [] });
    const [currentDate, setCurrentDate] = useState('');
    const [currentTime, setCurrentTime] = useState('');
    void currentDate; void currentTime; // prevent unused variable error
  const [dolarBlue, setDolarBlue] = useState<number>(1250.00);
  const [currentUser, setCurrentUser] = useState<Vendedor | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('desconectado');
    const [syncEnabled, setSyncEnabled] = useState<boolean>(true);
    const [syncInitialized, setSyncInitialized] = useState<boolean>(false);
    // Gate to control when auto-connection is allowed (for delayed startup)
    const [canStartSync, setCanStartSync] = useState<boolean>(false);
    // Countdown seconds remaining before auto-connect (UI/UX)
    const [syncCountdownSeconds, setSyncCountdownSeconds] = useState<number>(0);
  const [toasts, setToasts] = useState<ToastState[]>([]);
  
  // SISTEMA DE PROTECCIÓN POR HARDWARE
  const [isRegistered, setIsRegistered] = useState(false);
  const [hardwareId, setHardwareId] = useState<string>('');
  const [activationInfo, setActivationInfo] = useState<any>(null);
  
  const [geminiApiKey, setGeminiApiKey] = useState<string>('');
  const [openaiApiKey, setOpenaiApiKey] = useState<string>('');
  const [openrouterApiKey, setOpenrouterApiKey] = useState<string>('');
  const [openrouterModel, setOpenrouterModel] = useState<string>('meta-llama/llama-3.1-8b-instruct:free');
    const [huggingfaceApiKey, setHuggingfaceApiKey] = useState<string>('');
    const [huggingfaceModel, setHuggingfaceModel] = useState<string>('mistralai/Mistral-7B-Instruct-v0.2');
       const [aiProvider, setAiProvider] = useState<AiProvider>('gemini');
    const [huggingfaceUseV1, setHuggingfaceUseV1] = useState<boolean>(false);
    const [huggingfaceBillTo, setHuggingfaceBillTo] = useState<string>('');
    const [aiFullAccess, setAiFullAccess] = useState<boolean>(false);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
    // Timer to enable sync after a delay on startup based on autoSyncMode
    const autoConnectTimeoutRef = useRef<number | null>(null);
        // Target timestamp (ms) when auto-connect will fire
        const [autoConnectTargetTime, setAutoConnectTargetTime] = useState<number | null>(null);

    // Tick countdown every second while target time is set and gate not enabled yet
    useEffect(() => {
        if (!syncEnabled || canStartSync || !autoConnectTargetTime) {
            setSyncCountdownSeconds(0);
            return;
        }
        const update = () => {
            const remainingMs = Math.max(0, autoConnectTargetTime - Date.now());
            const secs = Math.ceil(remainingMs / 1000);
            setSyncCountdownSeconds(secs);
        };
        update();
        const intervalId = window.setInterval(update, 1000);
        return () => window.clearInterval(intervalId);
    }, [syncEnabled, canStartSync, autoConnectTargetTime]);
  const reconnectAttemptsRef = useRef<number>(0);
  // Set temporal en memoria - se sincroniza con DB
  const processedDocumentsRef = useRef<Set<number>>(new Set());
    // Evitar creación duplicada de documentos por doble click/HMR (ventana de 2s)
    const lastAddedDocRef = useRef<{ key: string; time: number; doc: SaleDocument } | null>(null);
  // ID único del cliente para evitar procesar sus propios mensajes
  const clientIdRef = useRef<string>(Math.random().toString(36).substring(7));
    // Ventana corta para ignorar eco de PRODUCT_SAVE desde el servidor
    const recentProductUpdatesRef = useRef<Map<string, number>>(new Map());


    // --- Toast Notification System ---
    const addToast = (message: string, type: ToastState['type'], isPersistent: boolean = false) => {
        const id = Date.now();
        // Remove any existing persistent toast before adding a new one
        if (isPersistent) {
            setToasts(prev => prev.filter(t => !t.isPersistent));
        }
        setToasts(prev => [...prev, { id, message, type, isPersistent }]);
        
        if (!isPersistent) {
            setTimeout(() => {
                removeToast(id);
            }, 4000);
        }
    };

    const removeToast = (id: number) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    };

    const removePersistentToasts = () => {
        setToasts(prev => prev.filter(t => !t.isPersistent));
    };

    // --- NEW: Function to send specific actions to the server ---
    const sendUpdate = useCallback((action: { type: string; payload: any }) => {
        if (!syncEnabled) {
            return; // No enviar actualizaciones si la sincronización está deshabilitada
        }
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            // Incluir el ID del cliente que originó el cambio
            wsRef.current.send(JSON.stringify({ ...action, clientId: clientIdRef.current }));
        } else {
            console.warn("WebSocket no conectado. La acción no se pudo sincronizar.", action);
            addToast('No se pudo sincronizar el último cambio: sin conexión.', 'error');
        }
    }, [syncEnabled]);

    // --- Robust WebSocket with Exponential Backoff Reconnection ---
    useEffect(() => {
        if (!syncEnabled) {
            // Si la sincronización está deshabilitada, cerrar conexión existente
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
                setSyncStatus('desconectado');
                removePersistentToasts();
                addToast('Sincronización deshabilitada.', 'info');
            }
            return;
        }

        if (!canStartSync) {
            // Aún no habilitado para iniciar (por delay de auto-conexión): asegurar cerrado pero sin mostrar toast
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
                setSyncStatus('desconectado');
                removePersistentToasts();
            }
            return;
        }

        const connectWebSocket = () => {
            if (wsRef.current) return;

            const wsUrl = networkConfig.serverUrl || 'ws://localhost:3000';
            console.log(`Conectando a servidor en: ${wsUrl}`);
            
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;
            setSyncStatus('conectando');

            ws.onopen = () => {
                console.log('Conectado al servidor de sincronización.');
                setSyncStatus('conectado');
                reconnectAttemptsRef.current = 0;
                removePersistentToasts();
                addToast('Sincronización activa.', 'success');
                
                // El registro se hará cuando recibamos CLIENT_ID_ASSIGNED
                
                // Si estamos en modo SERVIDOR (local), enviar todos los datos al servidor Node.js
                if (networkConfig.serverMode === 'local') {
                    console.log('🔄 Modo servidor detectado: enviando todos los datos al servidor de sincronización...');
                    
                    // Enviar todos los productos
                    products.forEach(p => {
                        sendUpdate({ type: 'PRODUCT_SAVE', payload: p });
                    });
                    
                    // Enviar todos los clientes
                    clients.forEach(c => {
                        sendUpdate({ type: 'CLIENT_SAVE', payload: c });
                    });
                    
                    // Enviar proveedores
                    proveedores.forEach(p => {
                        sendUpdate({ type: 'PROVEEDOR_SAVE', payload: p });
                    });
                    
                    // Enviar vendedores
                    vendedores.forEach(v => {
                        sendUpdate({ type: 'VENDEDOR_SAVE', payload: v });
                    });
                    
                    // Enviar documentos de venta
                    documents.forEach(d => {
                        sendUpdate({ type: 'SALEDOCUMENT_ADD', payload: d });
                    });
                    
                    // Enviar documentos de compra
                    purchaseDocuments.forEach(d => {
                        sendUpdate({ type: 'PURCHASEDOCUMENT_ADD', payload: d });
                    });
                    
                    // Enviar cheques
                    cheques.forEach(c => {
                        sendUpdate({ type: 'CHEQUE_SAVE', payload: c });
                    });
                    
                    // Enviar estados importantes
                    sendUpdate({ type: 'APPSTATE_SAVE', payload: { key: 'caja', value: caja } });
                    sendUpdate({ type: 'APPSTATE_SAVE', payload: { key: 'dolarBlue', value: dolarBlue } });
                    sendUpdate({ type: 'PROMOCIONES_SET', payload: promociones });
                    
                    console.log('✅ Datos del servidor enviados al servidor de sincronización:', {
                        products: products.length,
                        clients: clients.length,
                        proveedores: proveedores.length,
                        vendedores: vendedores.length,
                        documents: documents.length
                    });
                }
                
                // Si estamos en modo cliente, descargar e importar el backup completo del servidor
                if (networkConfig.serverMode === 'client') {
                    console.log('🔄 Modo cliente detectado: descargando backup completo del servidor...');
                    const httpUrl = networkConfig.serverUrl.replace('ws://', 'http://').replace('wss://', 'https://');
                    console.log(`📡 URL de backup: ${httpUrl}/api/backup`);
                    
                    fetch(`${httpUrl}/api/backup`)
                        .then(res => {
                            console.log(`📡 Respuesta del servidor: ${res.status} ${res.statusText}`);
                            if (!res.ok) {
                                throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                            }
                            return res.json();
                        })
                        .then(async (backupData) => {
                            console.log('📦 Backup recibido (estructura):', Object.keys(backupData));
                            if (!backupData.data) {
                                throw new Error('El servidor no devolvió datos válidos');
                            }
                            
                            console.log('📦 Backup recibido del servidor:', {
                                products: backupData.data?.products?.length || 0,
                                clients: backupData.data?.clients?.length || 0,
                                saleDocuments: backupData.data?.saleDocuments?.length || 0
                            });
                            
                            // Verificar que hay datos para importar
                            const hasData = backupData.data.products?.length > 0 || 
                                          backupData.data.clients?.length > 0 ||
                                          backupData.data.saleDocuments?.length > 0;
                            
                            if (!hasData) {
                                console.warn('⚠️ El servidor no tiene datos para sincronizar');
                                addToast('⚠️ El servidor está vacío. No se sincronizará.', 'info');
                                return;
                            }
                            
                            // Importar el backup (limpiar todo y cargar desde servidor)
                            await db.transaction('rw', db.tables, async () => {
                                // Limpiar todas las tablas excepto appState (para preservar config de red)
                                await db.products.clear();
                                await db.clients.clear();
                                await db.proveedores.clear();
                                await db.vendedores.clear();
                                await db.saleDocuments.clear();
                                await db.purchaseDocuments.clear();
                                await db.cheques.clear();
                                await db.marcas.clear();
                                await db.familias.clear();
                                await db.promociones.clear();
                                
                                console.log('✅ Base de datos local limpiada');
                                
                                // Cargar datos del backup
                                if (backupData.data.products?.length > 0) {
                                    await db.products.bulkPut(backupData.data.products);
                                    setProducts(backupData.data.products);
                                    console.log(`✅ ${backupData.data.products.length} productos importados`);
                                } else {
                                    setProducts([]);
                                }
                                if (backupData.data.clients?.length > 0) {
                                    await db.clients.bulkPut(backupData.data.clients);
                                    setClients(backupData.data.clients);
                                    console.log(`✅ ${backupData.data.clients.length} clientes importados`);
                                } else {
                                    setClients([]);
                                }
                                if (backupData.data.proveedores?.length > 0) {
                                    await db.proveedores.bulkPut(backupData.data.proveedores);
                                    setProveedores(backupData.data.proveedores);
                                    console.log(`✅ ${backupData.data.proveedores.length} proveedores importados`);
                                } else {
                                    setProveedores([]);
                                }
                                if (backupData.data.vendedores?.length > 0) {
                                    await db.vendedores.bulkPut(backupData.data.vendedores);
                                    setVendedores(backupData.data.vendedores);
                                    console.log(`✅ ${backupData.data.vendedores.length} vendedores importados`);
                                } else {
                                    setVendedores([]);
                                }
                                if (backupData.data.saleDocuments?.length > 0) {
                                    await db.saleDocuments.bulkPut(backupData.data.saleDocuments);
                                    setDocuments(backupData.data.saleDocuments);
                                    console.log(`✅ ${backupData.data.saleDocuments.length} documentos de venta importados`);
                                } else {
                                    setDocuments([]);
                                }
                                if (backupData.data.purchaseDocuments?.length > 0) {
                                    await db.purchaseDocuments.bulkPut(backupData.data.purchaseDocuments);
                                    setPurchaseDocuments(backupData.data.purchaseDocuments);
                                    console.log(`✅ ${backupData.data.purchaseDocuments.length} documentos de compra importados`);
                                } else {
                                    setPurchaseDocuments([]);
                                }
                                if (backupData.data.cheques?.length > 0) {
                                    await db.cheques.bulkPut(backupData.data.cheques);
                                    setCheques(backupData.data.cheques);
                                    console.log(`✅ ${backupData.data.cheques.length} cheques importados`);
                                } else {
                                    setCheques([]);
                                }
                                if (backupData.data.marcas?.length > 0) {
                                    await db.marcas.bulkPut(backupData.data.marcas);
                                    setMarcas(backupData.data.marcas);
                                } else {
                                    setMarcas([]);
                                }
                                if (backupData.data.familias?.length > 0) {
                                    await db.familias.bulkPut(backupData.data.familias);
                                    setFamilias(backupData.data.familias);
                                } else {
                                    setFamilias([]);
                                }
                                if (backupData.data.promociones?.length > 0) {
                                    await db.promociones.bulkPut(backupData.data.promociones);
                                    setPromociones(backupData.data.promociones);
                                } else {
                                    setPromociones([]);
                                }
                                
                                // Cargar appState excepto networkConfig
                                if (backupData.data.appState?.length > 0) {
                                    for (const state of backupData.data.appState) {
                                        if (state.key === 'networkConfig') continue; // Preservar config de red
                                        await db.appState.put(state);
                                        
                                        // Actualizar estados en memoria
                                        if (state.key === 'caja') setCaja(state.value);
                                        if (state.key === 'dolarBlue') setDolarBlue(state.value);
                                        if (state.key === 'theme') setTheme(state.value);
                                        if (state.key === 'customThemes') setCustomThemes(state.value);
                                    }
                                }
                            });
                            
                            addToast('✅ Datos sincronizados completamente desde servidor', 'success');
                            console.log('✅ Importación completa desde servidor finalizada');
                        })
                        .catch(err => {
                            console.error('❌ Error descargando backup del servidor:', err);
                            addToast('⚠️ No se pudo descargar backup completo del servidor', 'error');
                        });
                }
            };

            ws.onmessage = async (event) => {
                try {
                    const action = JSON.parse(event.data.toString());
                    
                    // Recibir ID asignado por el servidor
                    if (action.type === 'CLIENT_ID_ASSIGNED') {
                        clientIdRef.current = action.clientId;
                        console.log('✅ ID de cliente asignado por servidor:', action.clientId);
                        
                        // Enviar información de este cliente al servidor
                        const pcName = localStorage.getItem('pcName') || `PC-${action.clientId.substring(0, 4).toUpperCase()}`;
                        if (!localStorage.getItem('pcName')) {
                            localStorage.setItem('pcName', pcName);
                        }
                        
                        sendUpdate({
                            type: 'CLIENT_REGISTER',
                            payload: {
                                name: pcName,
                                serverMode: networkConfig.serverMode
                            }
                        });
                        return;
                    }
                    
                    // Manejar sincronización inicial
                    if (action.type === 'INITIAL_SYNC') {
                        console.log('📥 Recibiendo sincronización inicial del servidor...');
                        const serverData = action.payload;
                        
                        console.log('📊 Datos recibidos del servidor:', {
                            products: serverData.products?.length || 0,
                            clients: serverData.clients?.length || 0,
                            proveedores: serverData.proveedores?.length || 0,
                            vendedores: serverData.vendedores?.length || 0,
                            saleDocuments: serverData.saleDocuments?.length || 0,
                            purchaseDocuments: serverData.purchaseDocuments?.length || 0,
                            cheques: serverData.cheques?.length || 0,
                            appState: serverData.appState?.length || 0,
                        });
                        
                        // EN MODO CLIENTE: REEMPLAZAR TODO con datos del servidor (él es la única fuente de verdad)
                        // EN MODO LOCAL/SERVIDOR: FUSIONAR para preservar datos locales
                        const isClientMode = networkConfig.serverMode === 'client';
                        
                        console.log(`🔧 Modo de sincronización: ${isClientMode ? 'CLIENTE (limpiar y cargar)' : 'SERVIDOR (fusionar)'}`);
                        
                        await db.transaction('rw', db.tables, async () => {
                            if (isClientMode) {
                                // MODO CLIENTE: Limpiar todo y usar solo datos del servidor
                                console.log('🔄 MODO CLIENTE: Limpiando base de datos local y cargando desde servidor...');
                                
                                await db.products.clear();
                                await db.clients.clear();
                                await db.proveedores.clear();
                                await db.vendedores.clear();
                                await db.saleDocuments.clear();
                                await db.purchaseDocuments.clear();
                                await db.cheques.clear();
                                // NO limpiar appState para preservar configuración de red
                                
                                console.log('✅ Base de datos local limpiada');
                                
                                // Cargar todo desde servidor
                                if (serverData.products?.length > 0) {
                                    console.log(`📦 Cargando ${serverData.products.length} productos desde servidor...`);
                                    await db.products.bulkPut(serverData.products);
                                    setProducts(serverData.products);
                                    console.log(`✅ ${serverData.products.length} productos cargados`);
                                } else {
                                    console.warn('⚠️ Servidor no envió productos');
                                    setProducts([]);
                                }
                                if (serverData.clients?.length > 0) {
                                    console.log(`👥 Cargando ${serverData.clients.length} clientes...`);
                                    await db.clients.bulkPut(serverData.clients);
                                    setClients(serverData.clients);
                                }
                                if (serverData.proveedores?.length > 0) {
                                    console.log(`🏪 Cargando ${serverData.proveedores.length} proveedores...`);
                                    await db.proveedores.bulkPut(serverData.proveedores);
                                    setProveedores(serverData.proveedores);
                                }
                                if (serverData.vendedores?.length > 0) {
                                    console.log(`👤 Cargando ${serverData.vendedores.length} vendedores...`);
                                    await db.vendedores.bulkPut(serverData.vendedores);
                                    setVendedores(serverData.vendedores);
                                }
                                if (serverData.saleDocuments?.length > 0) {
                                    console.log(`📄 Cargando ${serverData.saleDocuments.length} documentos de venta...`);
                                    await db.saleDocuments.bulkPut(serverData.saleDocuments);
                                    setDocuments(serverData.saleDocuments);
                                }
                                if (serverData.purchaseDocuments?.length > 0) {
                                    console.log(`📋 Cargando ${serverData.purchaseDocuments.length} documentos de compra...`);
                                    await db.purchaseDocuments.bulkPut(serverData.purchaseDocuments);
                                    setPurchaseDocuments(serverData.purchaseDocuments);
                                }
                                if (serverData.cheques?.length > 0) {
                                    console.log(`💰 Cargando ${serverData.cheques.length} cheques...`);
                                    await db.cheques.bulkPut(serverData.cheques);
                                    setCheques(serverData.cheques);
                                }
                                if (serverData.appState?.length > 0) {
                                    console.log(`⚙️ Cargando ${serverData.appState.length} configuraciones...`);
                                    for (const state of serverData.appState) {
                                        // Preservar solo la configuración de red y NO sobreescribir el syncEnabled local
                                        if (state.key === 'networkConfig' || state.key === 'syncEnabled') continue;
                                        await db.appState.put(state);

                                        // Aplicar estados relevantes al cliente
                                        if (state.key === 'caja') setCaja(state.value);
                                        if (state.key === 'dolarBlue') setDolarBlue(state.value);
                                        if (state.key === 'promociones') setPromociones(state.value || []);
                                        // AFIP: el servidor es la fuente de la verdad — aplicar configuración AFIP
                                        if (state.key === 'afipConfig') {
                                            try {
                                                // Solo sobrescribir si el servidor tiene configuración válida (no vacía)
                                                const serverAfipConfig = state.value;
                                                const hasValidConfig = serverAfipConfig && 
                                                    serverAfipConfig.cuit && 
                                                    serverAfipConfig.puntoVenta && 
                                                    serverAfipConfig.url;
                                                
                                                if (hasValidConfig) {
                                                    // Actualizar con configuración del servidor
                                                    setAfipConfig({ ...initialAfipConfig, ...serverAfipConfig });
                                                    // Guardar en Dexie local
                                                    await db.appState.put({ key: 'afipConfig', value: serverAfipConfig });
                                                    console.log('✅ AFIP configuration applied from server INITIAL_SYNC');
                                                } else {
                                                    // Mantener configuración local si existe
                                                    const localAfipConfig = await db.appState.get('afipConfig');
                                                    if (localAfipConfig?.value) {
                                                        setAfipConfig({ ...initialAfipConfig, ...localAfipConfig.value });
                                                        console.log('✅ AFIP configuration kept from local storage (server config empty)');
                                                    }
                                                }
                                            } catch (err) {
                                                console.warn('⚠️ Error aplicando afipConfig desde serverData:', err);
                                            }
                                        }
                                    }
                                }
                                
                                addToast('✅ Datos cargados desde servidor (modo cliente)', 'success');
                                console.log('✅ Modo cliente: Sincronización completa desde servidor');
                            } else {
                                // MODO SERVIDOR/LOCAL: FUSIONAR datos locales con servidor
                                console.log('🔄 MODO SERVIDOR: Fusionando datos locales con servidor...');
                                
                                // Productos - FUSIONAR con datos locales
                                if (serverData.products?.length > 0) {
                                    const localProducts = await db.products.toArray();
                                    const serverProductsMap = new Map(serverData.products.map((p: Product) => [p.cod, p]));
                                    const mergedProducts = [...serverData.products];
                                    
                                    for (const localProd of localProducts) {
                                        if (!serverProductsMap.has(localProd.cod)) {
                                            console.log(`➕ Producto solo local: ${localProd.cod} - enviando al servidor`);
                                            mergedProducts.push(localProd);
                                            sendUpdate({ type: 'PRODUCT_SAVE', payload: localProd });
                                        }
                                    }
                                    
                                    await db.products.bulkPut(mergedProducts);
                                    setProducts(mergedProducts);
                                }
                                
                                // Clientes - FUSIONAR
                                if (serverData.clients?.length > 0) {
                                    const localClients = await db.clients.toArray();
                                    const serverClientsMap = new Map(serverData.clients.map((c: Customer) => [c.cod, c]));
                                    const mergedClients = [...serverData.clients];
                                    
                                    for (const localClient of localClients) {
                                        if (!serverClientsMap.has(localClient.cod)) {
                                            console.log(`➕ Cliente solo local: ${localClient.cod} - enviando al servidor`);
                                            mergedClients.push(localClient);
                                            sendUpdate({ type: 'CLIENT_SAVE', payload: localClient });
                                        }
                                    }
                                    
                                    await db.clients.bulkPut(mergedClients);
                                    setClients(mergedClients);
                                }
                                
                                // Proveedores - FUSIONAR
                                if (serverData.proveedores?.length > 0) {
                                    const localProveedores = await db.proveedores.toArray();
                                    const serverProveedoresMap = new Map(serverData.proveedores.map((p: Proveedor) => [p.cod, p]));
                                    const mergedProveedores = [...serverData.proveedores];
                                    
                                    for (const localProv of localProveedores) {
                                        if (!serverProveedoresMap.has(localProv.cod)) {
                                            console.log(`➕ Proveedor solo local: ${localProv.cod} - enviando al servidor`);
                                            mergedProveedores.push(localProv);
                                            sendUpdate({ type: 'PROVEEDOR_SAVE', payload: localProv });
                                        }
                                    }
                                    
                                    await db.proveedores.bulkPut(mergedProveedores);
                                    setProveedores(mergedProveedores);
                                }
                                
                               
                                if (serverData.vendedores?.length > 0) {
                                    const localVendedores = await db.vendedores.toArray();
                                    const serverVendedoresMap = new Map(serverData.vendedores.map((v: Vendedor) => [v.cod, v]));
                                    const mergedVendedores = [...serverData.vendedores];
                                    
                                    for (const localVend of localVendedores) {
                                        if (!serverVendedoresMap.has(localVend.cod)) {
                                            console.log(`➕ Vendedor solo local: ${localVend.cod} - enviando al servidor`);
                                            mergedVendedores.push(localVend);
                                            sendUpdate({ type: 'VENDEDOR_SAVE', payload: localVend });
                                        }
                                    }
                                    
                                    await db.vendedores.bulkPut(mergedVendedores);
                                    setVendedores(mergedVendedores);
                                }
                                
                                // Documentos de venta - FUSIONAR
                                if (serverData.saleDocuments?.length > 0) {
                                    const localDocs = await db.saleDocuments.toArray();
                                    const serverDocsMap = new Map(serverData.saleDocuments.map((d: SaleDocument) => [d.id, d]));
                                    const mergedDocs = [...serverData.saleDocuments];
                                    
                                    for (const localDoc of localDocs) {
                                        if (!serverDocsMap.has(localDoc.id)) {
                                            console.log(`➕ Documento de venta solo local: #${localDoc.id} - enviando al servidor`);
                                            mergedDocs.push(localDoc);
                                            sendUpdate({ type: 'SALEDOCUMENT_ADD', payload: localDoc });
                                        }
                                    }
                                    
                                    await db.saleDocuments.bulkPut(mergedDocs);
                                    setDocuments(mergedDocs);
                                }
                                
                                // Documentos de compra - FUSIONAR
                                if (serverData.purchaseDocuments?.length > 0) {
                                    const localPurchases = await db.purchaseDocuments.toArray();
                                    const serverPurchasesMap = new Map(serverData.purchaseDocuments.map((d: PurchaseDocument) => [d.id, d]));
                                    const mergedPurchases = [...serverData.purchaseDocuments];
                                    
                                    for (const localPurch of localPurchases) {
                                        if (!serverPurchasesMap.has(localPurch.id)) {
                                            console.log(`➕ Documento de compra solo local: #${localPurch.id} - enviando al servidor`);
                                            mergedPurchases.push(localPurch);
                                            sendUpdate({ type: 'PURCHASEDOCUMENT_ADD', payload: localPurch });
                                        }
                                    }
                                    
                                    await db.purchaseDocuments.bulkPut(mergedPurchases);
                                    setPurchaseDocuments(mergedPurchases);
                                }
                                
                                // Cheques - FUSIONAR
                                if (serverData.cheques?.length > 0) {
                                    const localCheques = await db.cheques.toArray();
                                    const serverChequesMap = new Map(serverData.cheques.map((c: any) => [c.id, c]));
                                    const mergedCheques = [...serverData.cheques];
                                    
                                    for (const localCheque of localCheques) {
                                        if (!serverChequesMap.has(localCheque.id)) {
                                            console.log(`➕ Cheque solo local: #${localCheque.id} - enviando al servidor`);
                                            mergedCheques.push(localCheque);
                                            sendUpdate({ type: 'CHEQUE_SAVE', payload: localCheque });
                                        }
                                    }
                                    
                                    await db.cheques.bulkPut(mergedCheques);
                                    setCheques(mergedCheques);
                                }
                                
                                // AppState - PRIORIZAR SERVIDOR
                                if (serverData.appState?.length > 0) {
                                    for (const state of serverData.appState) {
                                        // No sobreescribir syncEnabled desde el servidor (respeta configuración local)
                                        if (state.key === 'syncEnabled') continue;
                                        await db.appState.put(state);
                                        
                                        if (state.key === 'caja') {
                                            console.log('💰 Sincronizando estado de caja desde servidor');
                                            setCaja(state.value);
                                        }
                                        if (state.key === 'dolarBlue') setDolarBlue(state.value);
                                        if (state.key === 'promociones') setPromociones(state.value || []);
                                    }
                                }
                                
                                addToast('✅ Datos sincronizados y fusionados con servidor', 'success');
                                console.log('✅ Modo servidor: Sincronización con fusión completada');
                            }
                        });
                        
                        return;
                    }
                    
                    // Ignorar mensajes que este cliente envió
                    if (action.clientId === clientIdRef.current) {
                        console.log('⏭️ Ignorando mensaje propio:', action.type);
                        return;
                    }
                    
                    console.log('Acción recibida del servidor:', action.type);

                    // --- NEW: Live state update logic ---
                    switch (action.type) {
                        case 'CONNECTED_CLIENTS_UPDATE':
                            // Actualizar lista de clientes conectados (se manejará en ServerManagerView)
                            window.dispatchEvent(new CustomEvent('connectedClientsUpdate', { detail: action.payload }));
                            break;
                        case 'PRODUCT_SAVE':
                            {
                              console.log(`📥 Recibido PRODUCT_SAVE del servidor para: ${action.payload.cod} - ${action.payload.desc}, stock=${action.payload.stock}`);
                              const now = Date.now();
                              const lastLocal = recentProductUpdatesRef.current.get(action.payload.cod);
                              if (lastLocal && now - lastLocal < 2500) {
                                console.warn('⏭️ Ignorando PRODUCT_SAVE del servidor por eco reciente:', action.payload.cod);
                                break;
                              }
                              console.log(`✅ Aplicando PRODUCT_SAVE del servidor para ${action.payload.cod}`);
                              await db.products.put(action.payload);
                              setProducts(prev => {
                                  const index = prev.findIndex(p => p.cod === action.payload.cod);
                                  if (index > -1) {
                                      const newProducts = [...prev];
                                      newProducts[index] = action.payload;
                                      console.log(`🔄 Producto actualizado en lista: ${action.payload.cod}`);
                                      return newProducts;
                                  }
                                  console.log(`➕ Producto agregado a lista: ${action.payload.cod}`);
                                  return [...prev, action.payload];
                              });
                            }
                            break;
                        case 'PRODUCT_DELETE':
                             await db.products.delete(action.payload.cod);
                             setProducts(prev => prev.filter(p => p.cod !== action.payload.cod));
                            break;
                        case 'PRODUCTS_SET':
                            await db.products.bulkPut(action.payload);
                            setProducts(action.payload);
                            break;
                        case 'CLIENT_SAVE':
                            await db.clients.put(action.payload);
                            setClients(prev => {
                                const index = prev.findIndex(c => c.cod === action.payload.cod);
                                if (index > -1) {
                                    const newClients = [...prev];
                                    newClients[index] = action.payload;
                                    return newClients;
                                }
                                return [...prev, action.payload];
                            });
                            break;
                        case 'CLIENT_DELETE':
                            await db.clients.delete(action.payload.cod);
                            setClients(prev => prev.filter(c => c.cod !== action.payload.cod));
                            break;
                        // --- PROVEEDORES ---
                        case 'PROVEEDOR_SAVE':
                            await db.proveedores.put(action.payload);
                            setProveedores(prev => {
                                const index = prev.findIndex(p => p.cod === action.payload.cod);
                                if (index > -1) {
                                    const newProveedores = [...prev];
                                    newProveedores[index] = action.payload;
                                    return newProveedores;
                                }
                                return [...prev, action.payload];
                            });
                            break;
                        case 'PROVEEDOR_DELETE':
                            await db.proveedores.delete(action.payload.cod);
                            setProveedores(prev => prev.filter(p => p.cod !== action.payload.cod));
                            break;
                        // --- VENDEDORES ---
                        case 'VENDEDOR_SAVE':
                            await db.vendedores.put(action.payload);
                            setVendedores(prev => {
                                const index = prev.findIndex(v => v.cod === action.payload.cod);
                                if (index > -1) {
                                    const newVendedores = [...prev];
                                    newVendedores[index] = action.payload;
                                    return newVendedores;
                                }
                                return [...prev, action.payload];
                            });
                            break;
                        case 'VENDEDOR_DELETE':
                            await db.vendedores.delete(action.payload.cod);
                            setVendedores(prev => prev.filter(v => v.cod !== action.payload.cod));
                            break;
                        // --- CHEQUES ---
                        case 'CHEQUE_SAVE':
                            await db.cheques.put(action.payload);
                            setCheques(prev => {
                                const index = prev.findIndex(c => c.id === action.payload.id);
                                if (index > -1) {
                                    const newCheques = [...prev];
                                    newCheques[index] = action.payload;
                                    return newCheques;
                                }
                                return [...prev, action.payload];
                            });
                            break;
                        case 'CHEQUE_DELETE':
                            await db.cheques.delete(action.payload.id);
                            setCheques(prev => prev.filter(c => c.id !== action.payload.id));
                            break;
                        // --- MARCAS ---
                        case 'MARCA_SAVE':
                            await db.marcas.put(action.payload);
                            setMarcas(prev => {
                                const index = prev.findIndex(m => m.id === action.payload.id);
                                if (index > -1) {
                                    const newMarcas = [...prev];
                                    newMarcas[index] = action.payload;
                                    return newMarcas;
                                }
                                return [...prev, action.payload];
                            });
                            break;
                        case 'MARCA_DELETE':
                            await db.marcas.delete(action.payload.id);
                            setMarcas(prev => prev.filter(m => m.id !== action.payload.id));
                            break;
                        // --- FAMILIAS ---
                        case 'FAMILIA_SAVE':
                            await db.familias.put(action.payload);
                            setFamilias(prev => {
                                const index = prev.findIndex(f => f.id === action.payload.id);
                                if (index > -1) {
                                    const newFamilias = [...prev];
                                    newFamilias[index] = action.payload;
                                    return newFamilias;
                                }
                                return [...prev, action.payload];
                            });
                            break;
                        case 'FAMILIA_DELETE':
                            await db.familias.delete(action.payload.id);
                            setFamilias(prev => prev.filter(f => f.id !== action.payload.id));
                            break;
                        // --- PROMOCIONES ---
                        case 'PROMOCIONES_SET':
                            await db.promociones.clear();
                            await db.promociones.bulkPut(action.payload);
                            setPromociones(action.payload);
                            break;
                        // --- DOCUMENTOS DE VENTA ---
                        case 'SALEDOCUMENT_ADD':
                        case 'SALEDOCUMENT_UPDATE':
                             await db.saleDocuments.put(action.payload);
                             setDocuments(prev => {
                                const index = prev.findIndex(d => d.id === action.payload.id);
                                if (index > -1) {
                                    const newDocs = [...prev];
                                    newDocs[index] = action.payload;
                                    return newDocs;
                                }
                                return [...prev, action.payload];
                             });
                            break;
                         case 'PURCHASEDOCUMENT_ADD':
                            await db.purchaseDocuments.put(action.payload);
                            setPurchaseDocuments(prev => [...prev, action.payload]);
                            break;
                    case 'APPSTATE_SAVE':
                        // Ignorar actualizaciones remotas de syncEnabled para no apagar/prender el switch local
                        if (action.payload?.key === 'syncEnabled' && action.clientId !== clientIdRef.current) {
                           console.log('⏭️ Ignorando APPSTATE_SAVE remoto de syncEnabled para preservar configuración local');
                           break;
                        }
                        await db.appState.put(action.payload);
                        const { key, value } = action.payload;
                             // This needs to be more specific to update the correct React state
                             if (key === 'caja') setCaja(value);
                             if (key === 'dolarBlue') setDolarBlue(value);
                             // Si el servidor actualiza la configuración AFIP, aplicarla aquí para que el cliente
                             // use la configuración del servidor (CUIT, punto de venta, condicionIVA, etc.)
                             if (key === 'afipConfig') {
                                 try {
                                     // Solo aplicar si tiene datos válidos
                                     const hasValidConfig = value && value.cuit && value.puntoVenta && value.url;
                                     if (hasValidConfig) {
                                         setAfipConfig({ ...initialAfipConfig, ...value });
                                         addToast('🔁 Configuración AFIP actualizada desde el servidor', 'info');
                                         console.log('✅ AFIP configuration updated from server via APPSTATE_SAVE');
                                     } else {
                                         console.log('⏭️ Ignorando actualización AFIP vacía del servidor');
                                     }
                                 } catch (err) {
                                     console.warn('⚠️ Error aplicando afipConfig desde APPSTATE_SAVE:', err);
                                 }
                             }
                             // ... etc for other appState keys
                            break;
                        default:
                            console.warn(`Acción no manejada en el cliente: ${action.type}`);
                    }

                } catch (error) {
                    console.error("Error al procesar la acción del servidor:", error);
                }
            };

            ws.onclose = () => {
                console.log('Desconectado del servidor. Intentando reconectar...');
                setSyncStatus('desconectado');
                wsRef.current = null;
                
                if (syncEnabled) {
                    addToast('Conexión perdida. Intentando reconectar...', 'error', true);

                    const delay = Math.min(30000, (2 ** reconnectAttemptsRef.current) * 1000);
                    reconnectAttemptsRef.current++;
                    
                    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
                    reconnectTimeoutRef.current = window.setTimeout(connectWebSocket, delay);
                }
            };

            ws.onerror = (error) => {
                console.error('❌ Error de WebSocket:', error);
                console.error(`❌ URL intentada: ${wsUrl}`);
                console.error(`❌ Modo: ${networkConfig.serverMode}`);
                addToast(`❌ Error conectando a ${wsUrl}. Verifica que el servidor esté corriendo.`, 'error', true);
                // No need to set status here, onclose will be triggered and handle it.
            };
        };

        connectWebSocket();

        return () => {
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
            if (wsRef.current) {
                wsRef.current.onclose = null; 
                wsRef.current.close();
            }
        };
    }, [syncInitialized, syncEnabled, canStartSync, networkConfig.serverUrl]); // eslint-disable-line react-hooks/exhaustive-deps
    
  // Funciones helper para sincronizar promociones
  const sincronizarPromocionesAlInicio = async (promos: Promocion[], productosBase: Product[]) => {
    // Eliminar productos de promociones antiguas
    const productosPromo = productosBase.filter(p => p.esPromocion);
    for (const prod of productosPromo) {
      await db.products.delete(prod.cod);
    }

    // Crear/actualizar productos virtuales para promociones activas
    const nuevosProductosPromo: Product[] = [];
    for (const promo of promos.filter(p => p.activa)) {
      const productoVirtual: Product = {
        cod: promo.codigo,
        codBarras: promo.codigo,
        desc: promo.detalle,
        marca: 'PROMOCION',
        familia: 'PROMOCION',
        proveedor: 'PROMO',
        precioCompra: promo.items.reduce((total, item) => {
          const prod = productosBase.find(p => p.cod === item.productoCod);
          return total + ((prod?.costo || prod?.precioCompra || 0) * item.cantidad);
        }, 0),
        precioVenta: promo.precioTotal,
        stock: Math.min(...promo.items.map(item => {
          const prod = productosBase.find(p => p.cod === item.productoCod);
          return prod ? Math.floor(prod.stock / item.cantidad) : 0;
        })),
        stockMinimo: 0,
        esPromocion: true,
        promocionId: promo.id,
        promocionItems: promo.items,
        lista1: promo.precioTotal,
        lista2: promo.precioTotal,
        lista3: promo.precioTotal,
        lista4: promo.precioTotal,
      };
      
      await db.products.put(productoVirtual);
      nuevosProductosPromo.push(productoVirtual);
    }

    // Actualizar el estado de productos
    const productosNoPromo = productosBase.filter(p => !p.esPromocion);
    setProducts([...productosNoPromo, ...nuevosProductosPromo]);
  };

  useEffect(() => {
    async function loadDataAndCheckRegistration() {
        try {
            await db.open();
            console.log('🔐 Inicializando sistema de protección por hardware...');
            
            // Inicializar el sistema de protección
            HardwareProtection.initDatabase(db);
            
            // Generar y guardar Hardware ID
            const hwId = await HardwareProtection.generateHardwareId();
            setHardwareId(hwId);
            console.log('🆔 Hardware ID:', hwId);
            
            // Verificar activación
            const activated = await HardwareProtection.isActivated();
            setIsRegistered(activated);
            
            if (activated) {
                // Obtener información de la activación
                const info = await HardwareProtection.getActivationInfo();
                setActivationInfo(info);
                console.log('✅ Software activado y verificado');
                
                // Iniciar validación periódica en segundo plano
                HardwareProtection.startPeriodicValidation(() => {
                    console.log('⚠️ Validación periódica falló - requiere reactivación');
                    setIsRegistered(false);
                    addToast('La activación del software no es válida. Por favor, active nuevamente.', 'error');
                });
            } else {
                console.log('⚠️ Software no activado - mostrando pantalla de activación');
            }
            
            // Cargar datos de la aplicación
            await initializeDatabase();
        
    const [bg, logo, dashImg, afip, email, company, kiosk, autoBackup, controlCaja, serverManager, networkCfg, systemCfg, c, prods, clis, provs, vends, marcasData, familiasData, sales, purchases, chqs, promos, lastView, dolar, geminiKey, openaiKey, openrouterKey, openrouterModelData, hfKey, hfModel, hfUseV1, hfBillTo, aiProv, themeState, customThemesState, syncEnabledState, aiFull] = await Promise.all([
            db.appState.get('backgroundImage'),
            db.appState.get('companyLogo'),
            db.appState.get('dashboardImage'),
            db.appState.get('afipConfig'),
            db.appState.get('emailConfig'),
            db.appState.get('companyInfo'),
            db.appState.get('kioskConfig'),
            db.appState.get('autoBackupConfig'),
            db.appState.get('controlCajaConfig'),
            db.appState.get('serverManagerConfig'),
            db.appState.get('networkConfig'),
            db.appState.get('systemConfig'),
            db.appState.get('caja'),
            db.products.toArray(),
            db.clients.toArray(),
            db.proveedores.toArray(),
            db.vendedores.toArray(),
            db.marcas.toArray(),
            db.familias.toArray(),
            db.saleDocuments.toArray(),
            db.purchaseDocuments.toArray(),
            db.cheques.toArray(),
            db.promociones.toArray(),
            db.appState.get('lastView'),
            db.appState.get('dolarBlue'),
            db.appState.get('geminiApiKey'),
            db.appState.get('openaiApiKey'),
            db.appState.get('openrouterApiKey'),
            db.appState.get('openrouterModel'),
            db.appState.get('huggingfaceApiKey'),
            db.appState.get('huggingfaceModel'),
            db.appState.get('huggingfaceUseV1'),
            db.appState.get('huggingfaceBillTo'),
            db.appState.get('aiProvider'),
            db.appState.get('theme'),
            db.appState.get('customThemes'),
            db.appState.get('syncEnabled'),
            db.appState.get('aiFullAccess'),
        ]);
        
        setBackgroundImage(bg?.value || 'https://picsum.photos/seed/nature/1600/900');
        setTheme('stockfacil'); // Force classic theme
        setCustomThemes(customThemesState?.value || []);
        setCompanyLogo(logo?.value || null);
        setDashboardImage(dashImg?.value || null);
        
        // Cargar configuración AFIP desde archivo afipdatos.json
        const loadedAfipConfig = await loadAfipConfig(initialAfipConfig);
        setAfipConfig(loadedAfipConfig);
        // Guardar en Dexie como backup
        if (loadedAfipConfig.cuit || loadedAfipConfig.puntoVenta) {
            await db.appState.put({ key: 'afipConfig', value: loadedAfipConfig });
        }
        
        setEmailConfig({ ...initialEmailConfig, ...email?.value });
        setCompanyInfo(company?.value || initialCompanyInfo);
        setKioskConfig({ ...initialKioskConfig, ...kiosk?.value });
        setAutoBackupConfig({ ...initialAutoBackupConfig, ...autoBackup?.value });
        setControlCajaConfig({ ...initialControlCajaConfig, ...controlCaja?.value });
        setServerManagerConfig({ ...initialServerManagerConfig, ...serverManager?.value });
        setNetworkConfig({ ...initialNetworkConfig, ...networkCfg?.value });
    setSystemConfig({ ...initialSystemConfig, ...systemCfg?.value });
        
        // Sincronización HABILITADA por defecto
    const syncEnabledValue = syncEnabledState?.value !== false; // Si no existe o es undefined, será true
    setSyncEnabled(syncEnabledValue);
        // Programar habilitación diferida de la conexión según autoSyncMode si estaba habilitada
        if (syncEnabledValue) {
            const mode = (networkCfg?.value?.autoSyncMode) || initialNetworkConfig.autoSyncMode || 'instant';
            let delayMs = 0;
            if (mode === 'delay10') delayMs = 10_000;
            if (mode === 'delay30') delayMs = 30_000;
            if (autoConnectTimeoutRef.current) window.clearTimeout(autoConnectTimeoutRef.current);
            if (delayMs === 0) {
                setCanStartSync(true);
                setSyncCountdownSeconds(0);
            } else {
                console.log(`⏳ Auto-conexión diferida (${mode}) en ${delayMs/1000}s...`);
                setSyncCountdownSeconds(Math.ceil(delayMs/1000));
                const target = Date.now() + delayMs;
                setAutoConnectTargetTime(target);
                autoConnectTimeoutRef.current = window.setTimeout(() => {
                    setCanStartSync(true);
                    setSyncCountdownSeconds(0);
                }, delayMs);
            }
        } else {
            setCanStartSync(false);
            setSyncCountdownSeconds(0);
        }
        
        // Si no existe en la BD, guardarlo como true por defecto
        if (syncEnabledState === undefined || syncEnabledState === null) {
            console.log('🔵 [SYNC_INIT] syncEnabled no existe en BD, guardando valor por defecto: true');
            await db.appState.put({ key: 'syncEnabled', value: true });
        }
        
        console.log('[CAJA_LOAD_DEBUG]', {
            cajaFromDB: !!c,
            cajaValue: c?.value,
            movimientosCount: c?.value?.movimientos?.length || 0,
            fallbackUsed: !c?.value
        });
        
        setCaja(c?.value || { abierta: false, fechaApertura: null, saldoInicial: 0, movimientos: [] });
        setProducts(prods);
        setClients(clis);
        setProveedores(provs);
        setVendedores(vends);
    setMarcas(marcasData);
    setFamilias(familiasData);
        setDocuments(sales);
    setPurchaseDocuments(purchases);
    void themeState; // prevent unused variable error
        setCheques(chqs);
        setPromociones(promos || []);
        
    // Cargar IDs de documentos ya procesados (para evitar duplicados)
        const processedDocs = await db.appState.get('processedDocuments');
    // Marcar sincronización como inicializada para evitar parpadeo de switch
    setSyncInitialized(true);
        if (processedDocs?.value && Array.isArray(processedDocs.value)) {
            processedDocumentsRef.current = new Set(processedDocs.value);
            console.log('📋 Cargados documentos procesados desde DB:', processedDocs.value.length);
        }
        
        // Sincronizar promociones como productos después de cargar todo
        if (promos && promos.length > 0) {
            // Filtrar solo productos no promocionales para la sincronización inicial
            const productosSinPromos = prods.filter((p: Product) => !p.esPromocion);
            await sincronizarPromocionesAlInicio(promos, productosSinPromos);
        }
        
        setDolarBlue(dolar?.value || 1250.00);
        setGeminiApiKey(geminiKey?.value || '');
        setOpenaiApiKey(openaiKey?.value || '');
        setOpenrouterApiKey(openrouterKey?.value || '');
    setOpenrouterModel(openrouterModelData?.value || 'meta-llama/llama-3.1-8b-instruct:free');
    setHuggingfaceApiKey(hfKey?.value || '');
    setHuggingfaceModel(hfModel?.value || 'mistralai/Mistral-7B-Instruct-v0.2');
    setHuggingfaceUseV1(Boolean(hfUseV1?.value));
    setHuggingfaceBillTo(hfBillTo?.value || '');
    setAiProvider(aiProv?.value || 'gemini');
    // Normalize provider to supported ones only (Gemini/OpenAI)
    const loadedProv = aiProv?.value;
    if (loadedProv && loadedProv !== 'gemini' && loadedProv !== 'openai') {
        await db.appState.put({ key: 'aiProvider', value: 'gemini' });
        setAiProvider('gemini');
    }
    setAiFullAccess(Boolean(aiFull?.value));
        // La carga anterior ya normalizó y estableció syncEnabled; evitar reasignación que
        // pudiera anular la interpretación (por ejemplo si el valor en DB viene como string).
        
        const lastViewValue = lastView?.value?.view || null;
        setActiveView(lastViewValue);
         if (lastView?.value?.reportType) {
            setReportType(lastView.value.reportType);
        }

        // Intentar una limpieza rápida de duplicados de Marcas/Familias y normalizar nombres en productos
        try {
            await dedupeMastersAndNormalizeProducts(marcasData, familiasData, prods);
        } catch (e) {
            console.warn('No se pudo completar la deduplicación inicial de maestros:', e);
        }

        setIsLoading(false);
        } catch (err) {
            console.error('Error al cargar datos iniciales:', err);
            setIsLoading(false);
            alert('Ocurrió un error al iniciar la aplicación. Revise la consola para más detalles.');
        }
    }
    loadDataAndCheckRegistration();
  }, []);

  // Normaliza un nombre para comparación: trim, espacios compactados y minúsculas
  const normalizeName = (s?: string) => (s || '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();

  // Elige una forma canónica de escritura (primera aparición)
  const canonicalName = (original: string) => original.trim().replace(/\s+/g, ' ');

  // Deduplica Marcas/Familias por nombre y normaliza campos marca/familia en productos
  const dedupeMastersAndNormalizeProducts = async (marcasArr?: Marca[], familiasArr?: Familia[], productsArr?: Product[]) => {
      const currentMarcas = marcasArr ?? marcas;
      const currentFamilias = familiasArr ?? familias;
      const currentProducts = productsArr ?? products;

      const marcaFirst = new Map<string, Marca>();
      const marcaDups: string[] = [];
      currentMarcas.forEach(m => {
          const key = normalizeName(m.nombre);
          if (!key) return;
          if (!marcaFirst.has(key)) marcaFirst.set(key, m);
          else marcaDups.push(m.id);
      });

      const familiaFirst = new Map<string, Familia>();
      const familiaDups: string[] = [];
      currentFamilias.forEach(f => {
          const key = normalizeName(f.nombre);
          if (!key) return;
          if (!familiaFirst.has(key)) familiaFirst.set(key, f);
          else familiaDups.push(f.id);
      });

      // Si no hay duplicados ni necesidad de normalizar productos, salir rápido
      const needsMarcaClean = marcaDups.length > 0;
      const needsFamiliaClean = familiaDups.length > 0;

      // Normalizar nombres de marca/familia en productos a su forma canónica (para evitar re-crear duplicados por espacios/case)
      const productUpdates: Product[] = [];
      const marcaCanonMap = new Map(Array.from(marcaFirst.values()).map(m => [normalizeName(m.nombre), canonicalName(m.nombre)]));
      const familiaCanonMap = new Map(Array.from(familiaFirst.values()).map(f => [normalizeName(f.nombre), canonicalName(f.nombre)]));

      currentProducts.forEach(p => {
          let changed = false;
          if (p.marca) {
              const key = normalizeName(p.marca);
              const canon = marcaCanonMap.get(key);
              const newVal = canon || canonicalName(p.marca);
              if (newVal !== p.marca) { p.marca = newVal; changed = true; }
          }
          if ((p as any).familia) {
              const key = normalizeName((p as any).familia);
              const canon = familiaCanonMap.get(key);
              const newVal = canon || canonicalName((p as any).familia);
              if (newVal !== (p as any).familia) { (p as any).familia = newVal; changed = true; }
          }
          if (changed) productUpdates.push({ ...p });
      });

      await db.transaction('rw', db.marcas, db.familias, db.products, async () => {
          if (needsMarcaClean) await db.marcas.bulkDelete(marcaDups);
          if (needsFamiliaClean) await db.familias.bulkDelete(familiaDups);
          if (productUpdates.length > 0) await db.products.bulkPut(productUpdates);
      });

      // Actualizar estado en memoria
      if (needsMarcaClean) setMarcas(currentMarcas.filter(m => !marcaDups.includes(m.id)));
      if (needsFamiliaClean) setFamilias(currentFamilias.filter(f => !familiaDups.includes(f.id)));
      if (productUpdates.length > 0) {
          const updatesMap = new Map(productUpdates.map(p => [p.cod, p]));
          setProducts(prev => prev.map(p => updatesMap.get(p.cod) || p));
          // Sincronizar productos actualizados al servidor
          productUpdates.forEach(p => sendUpdate({ type: 'PRODUCT_SAVE', payload: p }));
      }
  };

  const applyCustomTheme = useCallback((themeName: string) => {
    const themeData = customThemes.find(t => `custom-${t.name}` === themeName);
    if(themeData) {
        Object.entries(themeData.colors).forEach(([key, value]) => {
            document.body.style.setProperty(key, value);
        });
    }
  }, [customThemes]);

  useEffect(() => {
    // Clear any inline styles from custom themes
    const style = document.body.style;
    for (let i = style.length - 1; i >= 0; i--) {
        const propName = style[i];
        if (propName.startsWith('--color-')) {
            style.removeProperty(propName);
        }
    }

    if (theme.startsWith('custom-')) {
        document.body.className = 'bg-[rgb(var(--color-bg-tertiary))]'; // Base class
        applyCustomTheme(theme);
    } else {
        document.body.className = `theme-${theme} bg-[rgb(var(--color-bg-tertiary))]`;
    }
  }, [theme, applyCustomTheme]);

  useEffect(() => {
    const updateDateTime = () => {
        const now = new Date();
        const dateOptions: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        const timeOptions: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
        
        const dateString = now.toLocaleDateString('es-AR', dateOptions);
        const timeString = now.toLocaleTimeString('es-AR', timeOptions).replace(/\s/g, '').toLowerCase();

        setCurrentDate(dateString.charAt(0).toUpperCase() + dateString.slice(1));
        setCurrentTime(timeString);
    };

    updateDateTime();
    const intervalId = setInterval(updateDateTime, 30000); // Update every 30 seconds

    return () => clearInterval(intervalId);
  }, []);
  
  const handleSetView = useCallback(async (view: ViewType | null) => {
    if (view && currentUser) {
        const permissionKey = viewPermissionMap[view];
        if (permissionKey && !currentUser.permissions[permissionKey]) {
            alert("No tiene permiso para acceder a esta sección.");
            return;
        }
    }
    setActiveView(view);
    const reportTypeToSave = view === 'informes' ? reportType : null;
    await db.appState.put({ key: 'lastView', value: { view, reportType: reportTypeToSave } });
  }, [reportType, currentUser]);
  
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
        // No procesar atajos globales si estamos en ventas (tiene sus propios atajos)
        if (activeView === 'ventas') {
            return;
        }
        
        const keyMap: { [key: string]: ViewType } = { 'F1': 'articulos', 'F2': 'proveedores', 'F3': 'clientes', 'F4': 'vendedores', 'F5': 'compras', 'F6': 'ventas', 'F7': 'caja' };
        const view = keyMap[event.key];
        if (view) {
            event.preventDefault();
            handleSetView(view);
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSetView, activeView]);

  // Auto-backup por intervalo
  useEffect(() => {
    if (!autoBackupConfig.enabled || autoBackupConfig.intervalMinutes === 0) {
      return;
    }

    const intervalMs = autoBackupConfig.intervalMinutes * 60 * 1000;
    const now = Date.now();
    const lastBackup = autoBackupConfig.lastBackupTime || 0;
    const timeSinceLastBackup = now - lastBackup;

    // Si ya pasó el intervalo desde el último backup, hacer uno ahora
    if (timeSinceLastBackup >= intervalMs) {
      void handleBackupData(true);
    }

    // Configurar el intervalo para futuros backups
    const intervalId = setInterval(() => {
      void handleBackupData(true);
    }, intervalMs);

    return () => clearInterval(intervalId);
  }, [autoBackupConfig]);
  
  const handleSelectReport = async (type: string) => {
    if (currentUser?.permissions.canAccessReportes) {
        setReportType(type);
        setActiveView('informes');
        await db.appState.put({ key: 'lastView', value: { view: 'informes', reportType: type } });
    } else {
        alert("No tiene permiso para acceder a los reportes.");
    }
  };
  
  const handleBgChange = async (newBgUrl: string) => {
    const state = { key: 'backgroundImage', value: newBgUrl };
    await db.appState.put(state);
    setBackgroundImage(newBgUrl);
    sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
  };

  const handleThemeChange = async (newTheme: Theme) => {
    const state = { key: 'theme', value: newTheme };
    await db.appState.put(state);
    setTheme(newTheme);
    sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
  };
  
   const handleSaveCustomTheme = async (themeToSave: CustomTheme) => {
    const existingIndex = customThemes.findIndex(t => t.name === themeToSave.name);
    let newThemes;
    if (existingIndex > -1) {
      newThemes = [...customThemes];
      newThemes[existingIndex] = themeToSave;
    } else {
      newThemes = [...customThemes, themeToSave];
    }
    const state = { key: 'customThemes', value: newThemes };
    setCustomThemes(newThemes);
    await db.appState.put(state);
    sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
  };

  const handleDeleteCustomTheme = async (themeName: string) => {
    if(window.confirm(`¿Está seguro que desea eliminar el tema "${themeName}"?`)) {
      const newThemes = customThemes.filter(t => t.name !== themeName);
      const state = { key: 'customThemes', value: newThemes };
      setCustomThemes(newThemes);
      await db.appState.put(state);
      sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
      if (theme === `custom-${themeName}`) {
        handleThemeChange('light');
      }
    }
  };
  
        const handleDocumentCompletion = async (doc: SaleDocument) => {
            console.log(`[DEBUG] handleDocumentCompletion START for doc ${doc.id} type ${doc.type}`);
            // @ts-ignore
            if (!(window as any).stockDebug) (window as any).stockDebug = {};
            // @ts-ignore
            if (!(window as any).stockDebug[doc.id]) (window as any).stockDebug[doc.id] = 0;
            // @ts-ignore
            (window as any).stockDebug[doc.id]++;
            console.log(`[DEBUG] handleDocumentCompletion llamada #${(window as any).stockDebug[doc.id]} for doc ${doc.id}`);
            const { type, items, total, id, fromDeliveryNoteId } = doc;

        // Prevenir ejecuciones duplicadas
            if (processedDocumentsRef.current.has(id)) {
                console.log(`[DEBUG] handleDocumentCompletion SKIP for doc ${doc.id} - already processed`);
                console.debug('[Stock] Skip por ya procesado en memoria', id);
                return;
            }

            // Remitos afectan stock, pero no caja. Facturas afectan caja y stock salvo que provengan de un remito.
            if (type !== 'invoice' && type !== 'credit-note' && type !== 'delivery-note') {
                return;
            }

                // Chequeo de idempotencia persistente (por si hay recargas/HMR o múltiples clientes)
                try {
                            const existing = await db.saleDocuments.get(id);
                            if (existing && existing.stockProcessed) {
                                console.debug('[Stock] Skip por stockProcessed en DB', id);
                                return;
                            }
                } catch (e) {
                    console.warn('No se pudo leer saleDocuments para verificar idempotencia:', e);
                }

        // Marcar como procesado INMEDIATAMENTE
        processedDocumentsRef.current.add(id);

        // Persistir en DB
        db.appState
            .put({ key: 'processedDocuments', value: Array.from(processedDocumentsRef.current) })
            .catch((err) => console.error('Error guardando processedDocuments:', err));

        try {
            // Usar una transacción separada SOLO para productos
                            const productUpdates = await db.transaction('r', db.products, async () => {
                                console.debug('[Stock] Procesando documento', { id, type, fromDeliveryNoteId, items: items.map(i => ({ cod: i.cod, q: i.quantity })) });
                const pCodes = items.map((i) => i.cod);

                // Cargar todos los productos de la venta
                let currentProducts: Product[] = await db.products.where('cod').anyOf(pCodes).toArray();

                // Si hay promociones, cargar también los productos componentes
                const productosPromocion = currentProducts.filter((p) => p.esPromocion);
                if (productosPromocion.length > 0) {
                    const codigosComponentes = productosPromocion.flatMap((p) => (p.promocionItems || []).map((item) => item.productoCod));

                    if (codigosComponentes.length > 0) {
                        const componentesPromo = await db.products.where('cod').anyOf(codigosComponentes).toArray();

                        // Agregar componentes al array si no están ya
                        for (const comp of componentesPromo) {
                            if (!currentProducts.find((p) => p.cod === comp.cod)) {
                                currentProducts.push(comp);
                            }
                        }
                    }
                }

                const productMap = new Map(currentProducts.map((p) => [p.cod, p]));
                const updates: Product[] = [];

                                for (const item of items) {
                    const p = productMap.get(item.cod);
                    if (!p) continue;

                            // Determinar cambio de stock:
                            // - delivery-note: descuenta stock
                            // - invoice: descuenta salvo que venga de remito (en ese caso, 0)
                            // - credit-note: devuelve stock
                            let stockChange = 0;
                            if (type === 'delivery-note') {
                                stockChange = -item.quantity;
                            } else if (type === 'invoice') {
                                stockChange = fromDeliveryNoteId ? 0 : -item.quantity;
                            } else if (type === 'credit-note') {
                                stockChange = item.quantity;
                            }

                    console.log(`[DEBUG] Item ${item.cod}: stock actual ${p.stock}, cambio ${stockChange}, nuevo ${p.stock + stockChange}`);

                    // Si es una promoción, descontar stock de los productos componentes
                    if (p.esPromocion && p.promocionItems) {
                        for (const promoItem of p.promocionItems) {
                            const componente = productMap.get(promoItem.productoCod);
                            if (componente) {
                                const cantidadDescontar = promoItem.cantidad * Math.abs(item.quantity);
                                        const cambioStock = stockChange < 0 ? -cantidadDescontar : stockChange > 0 ? cantidadDescontar : 0;

                                // Buscar si ya está en updates
                                const existing = updates.find((pu) => pu.cod === componente.cod);
                                if (existing) {
                                    existing.stock += cambioStock;
                                } else {
                                            if (cambioStock !== 0) {
                                                updates.push({ ...componente, stock: componente.stock + cambioStock });
                                            }
                                }

                                // Actualizar el map también
                                        if (cambioStock !== 0) {
                                            productMap.set(componente.cod, { ...componente, stock: componente.stock + cambioStock });
                                        }
                            }
                        }

                        // También actualizar el stock virtual de la promoción
                        const nuevoStockPromocion = Math.min(
                            ...((p.promocionItems?.map((pi) => {
                                const comp = productMap.get(pi.productoCod);
                                return comp ? Math.floor(comp.stock / pi.cantidad) : 0;
                            })) || [0])
                        );
                                // Actualizar stock virtual solo si cambió algo en componentes o si corresponde
                                updates.push({ ...p, stock: nuevoStockPromocion });
                    } else {
                        // Producto normal
                                if (stockChange !== 0) {
                                            console.debug('[Stock] Item', item.cod, 'stock original', p.stock, 'cambio', stockChange, 'nuevo', p.stock + stockChange);
                                    updates.push({ ...p, stock: p.stock + stockChange });
                                }
                    }
                }

                return updates;
            });

            // Guardar en DB FUERA de la transacción de lectura
                            if (productUpdates.length > 0) {
                await db.products.bulkPut(productUpdates);

                // Actualizar estado en memoria UNA SOLA VEZ
                const productUpdatesMap = new Map(productUpdates.map((p) => [p.cod, p]));
                setProducts((prev) => prev.map((p) => productUpdatesMap.get(p.cod) || p));

                                // Marcar estos productos como actualizados localmente (para ignorar eco de servidor)
                                const now = Date.now();
                                for (const pu of productUpdates) {
                                    recentProductUpdatesRef.current.set(pu.cod, now);
                                }

                console.log(`[DEBUG] Actualizado stock en DB para ${productUpdates.length} productos:`, productUpdates.map(p => `${p.cod}: ${p.stock}`).join(', '));
                
                // 🔥 SINCRONIZAR: Enviar cada producto actualizado al servidor
                for (const updatedProduct of productUpdates) {
                    console.log(`📤 Enviando actualización de stock al servidor: ${updatedProduct.cod} stock=${updatedProduct.stock}`);
                    sendUpdate({ type: 'PRODUCT_SAVE', payload: updatedProduct });
                }
            }

                    // Marcar documento como procesado en DB (idempotencia fuerte)
                    try {
                        const updatedDoc = { ...doc, stockProcessed: true } as SaleDocument;
                        await db.saleDocuments.put(updatedDoc);
                        setDocuments((prev) => {
                            const idx = prev.findIndex((d) => d.id === updatedDoc.id);
                            if (idx > -1) {
                                const copy = [...prev];
                                copy[idx] = updatedDoc;
                                return copy;
                            }
                            return prev;
                        });
                    } catch (e) {
                        console.warn('No se pudo marcar el documento como procesado:', e);
                    }

                    // Actualizar caja si está abierta (facturas, remitos y notas de crédito)
                    if (caja.abierta && (type === 'invoice' || type === 'delivery-note' || type === 'credit-note')) {
                await db.transaction('rw', db.appState, async () => {
                    const cajaStateFromDB = await db.appState.get('caja');
                    const cajaActual = cajaStateFromDB?.value || caja;
                    const lastMovement = cajaActual.movimientos[cajaActual.movimientos.length - 1];
                    const baseMov = { id: (lastMovement?.id || 0) + 1, fecha: new Date().toISOString(), usuario: currentUser?.nombre || 'N/A' };

                    let newMov: CajaMovimiento | null = null;
                    if (type === 'invoice') {
                        newMov = { ...baseMov, concepto: `Venta - Factura N° ${id}`, tipo: 'Ingreso Venta', importe: total };
                    } else if (type === 'delivery-note') {
                        newMov = { ...baseMov, concepto: `Venta - Remito N° ${id}`, tipo: 'Ingreso Venta', importe: total };
                    } else if (type === 'credit-note') {
                        newMov = { ...baseMov, concepto: `Devolución - N. Crédito N° ${id}`, tipo: 'Egreso Manual', importe: -total };
                    }

                    if (newMov) {
                        const newCajaState = { ...cajaActual, movimientos: [...cajaActual.movimientos, newMov] };
                        const state = { key: 'caja', value: newCajaState };
                        await db.appState.put(state);
                        setCaja(newCajaState);
                    }
                });
            }
        } catch (err) {
            console.error('❌ Error en handleDocumentCompletion:', err);
            // Si hay error, quitar el ID de procesados para permitir reintento
            processedDocumentsRef.current.delete(id);
        }
        console.log(`[DEBUG] handleDocumentCompletion END for doc ${doc.id}`);
    };

  
  const handlePurchaseCompletion = (items: PurchaseItem[]) => {
    db.transaction('rw', db.products, async () => {
        const pCodes = items.map(i => i.cod);
        const currentProducts: Product[] = await db.products.where('cod').anyOf(pCodes).toArray();
        const productMap = new Map(currentProducts.map(p => [p.cod, p]));
        const productUpdates = items.map(item => {
            const p = productMap.get(item.cod)!;
            return { ...p, stock: p.stock + item.quantity, costo: item.cost };
        });
        await db.products.bulkPut(productUpdates);
        productUpdates.forEach(p => sendUpdate({ type: 'PRODUCT_SAVE', payload: p }));
        
        setProducts(prev => prev.map(p => {
            const updated = productUpdates.find(u => u.cod === p.cod);
            return updated || p;
        }));
    });
  };

  const addDocument = async (doc: Omit<SaleDocument, 'id' | 'date'>): Promise<SaleDocument> => {
        // Dedupe key: type + customer + vendedor + items (cod,qty,price,discount) + total
        const dedupeKey = JSON.stringify({
            t: doc.type,
            c: doc.customer?.cod,
            v: doc.vendedor?.cod,
            it: (doc.items || []).map(i => ({ c: i.cod, q: i.quantity, p: i.price, d: i.discount })),
            tot: doc.total
        });
        const now = Date.now();
        if (lastAddedDocRef.current && lastAddedDocRef.current.key === dedupeKey && (now - lastAddedDocRef.current.time) < 2000) {
            console.warn('Ignorando creación duplicada de documento (ventana 2s).');
            return lastAddedDocRef.current.doc;
        }

    const newDocData: Omit<SaleDocument, 'id'> = { ...doc, date: new Date().toLocaleDateString('es-AR', {day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires'}) };
    const newId = await db.saleDocuments.add(newDocData as SaleDocument);
    const newDocWithId = { ...newDocData, id: newId };
    setDocuments(prev => [...prev, newDocWithId]);
    sendUpdate({ type: 'SALEDOCUMENT_ADD', payload: newDocWithId });
    await handleDocumentCompletion(newDocWithId);
        // Guardar para deduplicar siguientes intentos iguales por 2s
        lastAddedDocRef.current = { key: dedupeKey, time: Date.now(), doc: newDocWithId };
    return newDocWithId;
  };
  
    const addPurchase = async (doc: Omit<PurchaseDocument, 'id' | 'date'>) => {
        const newDocData: Omit<PurchaseDocument, 'id'> = { ...doc, date: new Date().toLocaleDateString('es-AR', {day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires'})};
    const newId = await db.purchaseDocuments.add(newDocData as PurchaseDocument);
    const newDocWithId = { ...newDocData, id: newId };
    setPurchaseDocuments(prev => [...prev, newDocWithId]);
    sendUpdate({ type: 'PURCHASEDOCUMENT_ADD', payload: newDocWithId });
    handlePurchaseCompletion(newDocWithId.items);

        // Registrar movimiento en Caja si está abierta
        if (caja.abierta) {
            const lastMovement = caja.movimientos[caja.movimientos.length - 1];
            const baseMov = { id: (lastMovement?.id || 0) + 1, fecha: new Date().toISOString(), usuario: currentUser?.nombre || 'N/A' };
            const metodoLabel = newDocWithId.paymentMethod === 'efectivo' ? 'Efectivo' : newDocWithId.paymentMethod === 'transferencia' ? 'Transferencia' : 'Cheque';
            const chequeExtra = newDocWithId.paymentMethod === 'cheque' && newDocWithId.chequeDetails
                ? ` #${newDocWithId.chequeDetails.numeroCheque} - ${newDocWithId.chequeDetails.banco}`
                : '';
            const newMov: CajaMovimiento = { 
                ...baseMov, 
                concepto: `Compra - ${newDocWithId.proveedor.razonSocial} (${metodoLabel}${chequeExtra})`, 
                tipo: 'Egreso Compra', 
                importe: -Math.abs(newDocWithId.total) 
            };
            const newCajaState = { ...caja, movimientos: [...caja.movimientos, newMov] };
            const state = { key: 'caja', value: newCajaState };
            await db.appState.put(state);
            setCaja(newCajaState);
            sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
        }

        // Registrar cheque en módulo Cheques si la compra fue con cheque
        if (newDocWithId.paymentMethod === 'cheque' && newDocWithId.chequeDetails) {
            const chequeData = {
                numero: newDocWithId.chequeDetails.numeroCheque,
                banco: newDocWithId.chequeDetails.banco,
                fechaEmision: newDocWithId.chequeDetails.fechaEmision,
                // Usar fecha de cobro provista; fallback a fecha de emisión si no vino
                fechaCobro: newDocWithId.chequeDetails.fechaCobro || newDocWithId.chequeDetails.fechaEmision,
                importe: Math.abs(newDocWithId.total),
                cliente: newDocWithId.proveedor.razonSocial,
                estado: 'En Cartera' as const,
            };
            const newChequeId = await db.cheques.add(chequeData as any);
            const savedCheque = { ...chequeData, id: newChequeId } as any;
            setCheques(prev => [...prev, savedCheque]);
            sendUpdate({ type: 'CHEQUE_SAVE', payload: savedCheque });
        }
  };

  const updateDocument = async (docId: number, updates: Partial<SaleDocument>) => {
    await db.saleDocuments.update(docId, updates);
    const updatedDoc = documents.find(d => d.id === docId);
    if(updatedDoc) {
        const finalDoc = { ...updatedDoc, ...updates };
        setDocuments(prev => prev.map(doc => doc.id === docId ? finalDoc : doc));
        sendUpdate({ type: 'SALEDOCUMENT_UPDATE', payload: finalDoc });
    }
  };

  const handleVoidDocument = async (docToVoid: SaleDocument) => {
    if (docToVoid.type !== 'invoice') {
        addToast("Error: Solo se pueden anular facturas.", 'error');
        return;
    }

    await db.transaction('rw', db.saleDocuments, db.products, db.appState, async () => {
        // 1. Update document type to 'invoice-voided'
        const voidedDoc = { ...docToVoid, type: 'invoice-voided' as DocumentType };
        await db.saleDocuments.put(voidedDoc);
        sendUpdate({ type: 'SALEDOCUMENT_UPDATE', payload: voidedDoc });
        
        // 2. Revert stock (add items back)
        const pCodes = docToVoid.items.map(i => i.cod);
        const currentProducts: Product[] = await db.products.where('cod').anyOf(pCodes).toArray();
        const productMap = new Map(currentProducts.map(p => [p.cod, p]));
        
        const productUpdates = docToVoid.items.map(item => {
            const p = productMap.get(item.cod);
            if (!p) return null;
            return { ...p, stock: p.stock + item.quantity };
        }).filter(Boolean) as Product[];

        if (productUpdates.length > 0) {
            await db.products.bulkPut(productUpdates);
            productUpdates.forEach(p => sendUpdate({ type: 'PRODUCT_SAVE', payload: p }));
        }
        
        // 3. Revert Caja movement
        const currentCajaState: CajaEstado = (await db.appState.get('caja'))?.value;
        if (currentCajaState && currentCajaState.abierta) {
            const lastMovement = currentCajaState.movimientos[currentCajaState.movimientos.length - 1];
            const newMov: CajaMovimiento = {
                id: (lastMovement?.id || 0) + 1,
                fecha: new Date().toISOString(),
                usuario: currentUser?.nombre || 'N/A',
                concepto: `Anulación Factura N° ${docToVoid.id}`,
                tipo: 'Egreso Manual',
                importe: -docToVoid.total
            };
            
            const newCajaState = { ...currentCajaState, movimientos: [...currentCajaState.movimientos, newMov] };
            const state = { key: 'caja', value: newCajaState };
            await db.appState.put(state);
            sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
            setCaja(newCajaState);
        }
        
        // 4. Update React State
        setDocuments(prev => prev.map(doc => doc.id === docToVoid.id ? voidedDoc : doc));
        const productUpdatesMap = new Map(productUpdates.map(p => [p.cod, p]));
        setProducts(prev => prev.map(p => productUpdatesMap.get(p.cod) || p));

    }).then(() => {
        addToast(`Factura ${docToVoid.id} anulada localmente. El stock ha sido restaurado.`, 'success');
    }).catch(err => {
        console.error("Error al anular la factura:", err);
        addToast("No se pudo anular la factura.", 'error');
    });
};
  
    const handleGenerateAfipInvoice = async (doc: SaleDocument): Promise<SaleDocument | null> => {
        // En modo cliente, no es necesario validar configuración AFIP local
        // El servidor se encargará de todo
        if (networkConfig.serverMode !== 'client') {
            // Solo validar si es servidor local
            if (!afipConfig.url || !afipConfig.cuit || !afipConfig.puntoVenta || !afipConfig.condicionIVA) {
                alert('Por favor, complete la configuración de AFIP antes de facturar (incluyendo la Condición de IVA de su empresa). Vaya a "Administración".');
                return null;
            }
        } else {
            // En modo cliente, validar que esté conectado al servidor
            if (!networkConfig.serverUrl) {
                alert('⚠️ No está conectado al servidor.\n\nPara facturar desde un cliente:\n1. Ve a Administración → Configuración de Red\n2. Configura la conexión al servidor\n3. Verifica que esté "🟢 Conectado"');
                return null;
            }
        }

        // Si estamos en modo CLIENTE e insuficiente configuración AFIP local, intentar obtenerla del servidor de sincronización
        if (networkConfig.serverMode === 'client' && (!afipConfig.cuit || !afipConfig.puntoVenta || !afipConfig.condicionIVA)) {
            try {
                const syncServerUrl = networkConfig.serverUrl?.replace('ws://', 'http://').replace('wss://', 'https://') || 'http://localhost:3000';
                const afipCfgResp = await fetch(syncServerUrl.endsWith('/') ? `${syncServerUrl}api/afip-config` : `${syncServerUrl}/api/afip-config`, { method: 'GET' });
                if (afipCfgResp.ok) {
                    const data = await afipCfgResp.json();
                    if (data?.afipConfig) {
                        setAfipConfig({ ...initialAfipConfig, ...data.afipConfig });
                        console.log('✅ AFIP configuration fetched from server on-demand');
                    }
                } else {
                    console.warn('No se pudo obtener afip-config desde el servidor:', afipCfgResp.status);
                }
            } catch (err) {
                console.warn('Error consultando afip-config en servidor:', err);
            }
        }

        const getCbteTipo = (
            companyCondition: AfipConfig['condicionIVA'],
            customerCondition: Customer['condicionIVA']
        ): { type: number, name: string } => {
            if (companyCondition === 'Monotributo') {
                return { type: 11, name: 'C' }; // Factura C
            }
            if (customerCondition === 'Responsable Inscripto') {
                return { type: 1, name: 'A' }; // Factura A
            }
            return { type: 6, name: 'B' }; // Factura B for all others
        };
        
        // En modo cliente, usar configuración sincronizada del servidor o valor por defecto
        const companyCondicion = afipConfig.condicionIVA || 'Responsable Inscripto';
        const invoiceType = getCbteTipo(companyCondicion, doc.customer.condicionIVA);

        // Si es un documento nuevo (id=0), no mostrar el número temporal
        const displayId = doc.id === 0 ? 'NUEVO' : String(doc.id).padStart(8, '0');
        if (!window.confirm(`Se generará una Factura "${invoiceType.name}" ${doc.id === 0 ? 'nueva' : `para el comprobante N° ${displayId}`}\.\n¿Desea continuar? Esta acción generará un comprobante fiscal real.`)) {
            return null;
        }

        try {
            const afipDocTypes = { 'CUIT': 80, 'CUIL': 86, 'DNI': 96 };

            const ivaDetails: { [key: number]: { base: number, importe: number } } = {};
            const getIvaId = (rate: number) => (rate === 21 ? 5 : (rate === 10.5 ? 4 : (rate === 27 ? 6 : 5)));

            doc.items.forEach(item => {
                const productInfo = products.find(p => p.cod === item.cod);
                const ivaRate = (productInfo?.iva || 21) / 100;
                const ivaId = getIvaId(productInfo?.iva || 21);
                
                const totalItemConDescuento = item.price * item.quantity * (1 - item.discount / 100);
                const baseImpItem = totalItemConDescuento / (1 + ivaRate);
                const importeIvaItem = baseImpItem * ivaRate;

                if (!ivaDetails[ivaId]) ivaDetails[ivaId] = { base: 0, importe: 0 };
                ivaDetails[ivaId].base += baseImpItem;
                ivaDetails[ivaId].importe += importeIvaItem;
            });

            const totalNeto = Object.values(ivaDetails).reduce((sum, val) => sum + val.base, 0);
            const totalIva = Object.values(ivaDetails).reduce((sum, val) => sum + val.importe, 0);
            const afipIvaArray = Object.entries(ivaDetails).map(([id, data]) => ({ 'Id': parseInt(id), 'BaseImp': parseFloat(data.base.toFixed(2)), 'Importe': parseFloat(data.importe.toFixed(2)) }));
            
            const [day, month, year] = doc.date.split('/');
            const afipDate = `${year}${month}${day}`;

            const afipPayload = {
                Id: doc.id, Tipo_doc: afipDocTypes[doc.customer.docTipo] || 99, Nro_doc: doc.customer.docNro ? parseInt(doc.customer.docNro.replace(/-/g, '')) : 0,
                Tipo_cbte: invoiceType.type, Punto_vta: parseInt(afipConfig.puntoVenta), Imp_total: parseFloat(doc.total.toFixed(2)), Imp_tot_conc: 0, 
                Imp_neto: parseFloat(totalNeto.toFixed(2)), Impto_liq: parseFloat(totalIva.toFixed(2)), Imp_op_ex: 0, Fecha_cbte: afipDate, Iva: afipIvaArray,
            };

            // Determinar URL del endpoint según el modo (cliente usa proxy del servidor)
            let facturacionUrl: string;
            
            if (networkConfig.serverMode === 'client') {
                // Cliente: verificar si tiene configuración AFIP local
                if (afipConfig.cuit && afipConfig.puntoVenta) {
                    // Cliente tiene configuración AFIP local - facturar directamente
                    const urlMatch = (afipConfig.url || '').match(/:(\d+)/);
                    const port = urlMatch ? urlMatch[1] : '3001';
                    facturacionUrl = `http://127.0.0.1:${port}/facturar`;
                    console.log('🏠 Cliente con AFIP local - facturando directamente:', facturacionUrl);
                } else {
                    // Cliente sin configuración AFIP - usar proxy del servidor
                    const syncServerUrl = networkConfig.serverUrl?.replace('ws://', 'http://').replace('wss://', 'https://') || 'http://localhost:3000';
                    facturacionUrl = syncServerUrl.endsWith('/') 
                        ? `${syncServerUrl}api/facturar` 
                        : `${syncServerUrl}/api/facturar`;
                    console.log('🔄 Cliente usando proxy de facturación del servidor:', facturacionUrl);
                }
            } else {
                // Servidor local: usar facturacion-server directo en localhost
                // Extraer solo el puerto de la URL configurada, pero siempre usar 127.0.0.1
                const urlMatch = (afipConfig.url || '').match(/:(\d+)/);
                const port = urlMatch ? urlMatch[1] : '3001';
                facturacionUrl = `http://127.0.0.1:${port}/facturar`;
                console.log('🏠 Usando servidor local de facturación:', facturacionUrl);
            }

            // Construir las rutas de los archivos cert y key según el certificado seleccionado
            const certType = afipConfig.certificado || 'produccion';
            const certPath = `afip_certs/${certType}.crt`;
            const keyPath = `afip_certs/${certType}.key`;

            const response = await fetch(facturacionUrl, {
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ 
                    afipConfig: { 
                        cuit: afipConfig.cuit, 
                        ambiente: afipConfig.ambiente || 'produccion',
                        cert: certPath,
                        key: keyPath
                    }, 
                    invoiceData: afipPayload 
                }),
            });

            if (!response.ok) {
                const errorData: any = await response.json();
                
                // Mensaje de error mejorado con instrucciones
                let detailedMessage = `❌ Error al generar la factura:\n\n${errorData.message || 'Error sin mensaje.'}`;
                
                if (errorData.hint) {
                    detailedMessage += `\n\n📋 Solución:\n${errorData.hint}`;
                }
                
                if (errorData.certPath || errorData.basePath) {
                    detailedMessage += `\n\n📁 Ruta buscada: ${errorData.certPath || errorData.basePath}`;
                }
                
                if (errorData.stack) {
                    detailedMessage += `\n\n--- Detalles técnicos ---\n${errorData.stack}`;
                }
                
                throw new Error(detailedMessage);
            }

            const result = await response.json();
            let finalSavedDoc: SaleDocument | null = null;
            
            // Si es un documento nuevo (id=0), crearlo con CAE. Si ya existe, actualizarlo.
            if (doc.id === 0) {
                // Crear nuevo documento CON CAE desde el principio
                const created = await addDocument({
                    type: doc.type,
                    customer: doc.customer,
                    vendedor: doc.vendedor,
                    items: doc.items,
                    subtotal: doc.subtotal,
                    totalDiscount: doc.totalDiscount,
                    total: doc.total,
                    fromDeliveryNoteId: (doc as any).fromDeliveryNoteId,
                    cae: result.cae,
                    caeVencimiento: result.caeVencimiento,
                    numeroComprobante: result.numeroComprobante,
                });
                finalSavedDoc = created;
            } else {
                // Actualizar documento existente
                await updateDocument(doc.id, { cae: result.cae, caeVencimiento: result.caeVencimiento, numeroComprobante: result.numeroComprobante });
                // Obtener la versión más reciente del documento actualizado
                const updated = await db.saleDocuments.get(doc.id);
                if (updated) {
                    finalSavedDoc = updated as SaleDocument;
                } else {
                    // Fallback en memoria
                    const fromState = documents.find(d => d.id === doc.id);
                    finalSavedDoc = fromState ? { ...fromState, cae: result.cae, caeVencimiento: result.caeVencimiento, numeroComprobante: result.numeroComprobante } : null;
                }
            }
            
            addToast(`Factura electrónica generada con éxito! CAE: ${result.cae}`, 'success');

            return finalSavedDoc;

        } catch (error) {
            console.error("Error generating AFIP invoice:", error);
            alert(`Error al generar la factura: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
  };

  const handleGenerateAfipNote = async (originalInvoice: SaleDocument, noteType: 'credit-note' | 'debit-note'): Promise<boolean> => {
        const noteTypeName = noteType === 'credit-note' ? 'Crédito' : 'Débito';
        if (!window.confirm(`Está a punto de generar una Nota de ${noteTypeName} fiscal para la Factura ${originalInvoice.numeroComprobante}.\n\nEsta acción es IRREVERSIBLE y generará un comprobante fiscal real en AFIP.\n\n¿Desea continuar?`)) {
            return false;
        }

        try {
            const getCbteTipo = (companyCondition: AfipConfig['condicionIVA'], customerCondition: Customer['condicionIVA']): number => {
                if (companyCondition === 'Monotributo') return 11; // Factura C
                if (customerCondition === 'Responsable Inscripto') return 1; // Factura A
                return 6; // Factura B
            };

            const getNotaCbteTipo = (invoiceType: number, noteType: 'credit-note' | 'debit-note'): number => {
                const map = {
                    credit: { 1: 3, 6: 8, 11: 13 },
                    debit: { 1: 2, 6: 7, 11: 12 }
                };
                return noteType === 'credit-note' ? (map.credit as any)[invoiceType] : (map.debit as any)[invoiceType];
            };

            const originalInvoiceType = getCbteTipo(afipConfig.condicionIVA, originalInvoice.customer.condicionIVA);
            const noteCbteType = getNotaCbteTipo(originalInvoiceType, noteType);

            if (!noteCbteType) throw new Error("No se pudo determinar el tipo de comprobante para la nota.");

            const [ptoVtaStr, nroCmpStr] = originalInvoice.numeroComprobante!.split('-');
            
            const ivaDetails: { [key: number]: { base: number, importe: number } } = {};
            const getIvaId = (rate: number) => (rate === 21 ? 5 : (rate === 10.5 ? 4 : (rate === 27 ? 6 : 5)));
            originalInvoice.items.forEach(item => {
                const productInfo = products.find(p => p.cod === item.cod);
                const ivaRate = (productInfo?.iva || 21) / 100;
                const ivaId = getIvaId(productInfo?.iva || 21);
                const totalItem = item.price * item.quantity * (1 - item.discount / 100);
                const baseImp = totalItem / (1 + ivaRate);
                if (!ivaDetails[ivaId]) ivaDetails[ivaId] = { base: 0, importe: 0 };
                ivaDetails[ivaId].base += baseImp;
                ivaDetails[ivaId].importe += baseImp * ivaRate;
            });

            const totalNeto = Object.values(ivaDetails).reduce((sum, val) => sum + val.base, 0);
            const totalIva = Object.values(ivaDetails).reduce((sum, val) => sum + val.importe, 0);
            const afipIvaArray = Object.entries(ivaDetails).map(([id, data]) => ({ 'Id': parseInt(id), 'BaseImp': parseFloat(data.base.toFixed(2)), 'Importe': parseFloat(data.importe.toFixed(2)) }));

            const afipDocTypes = { 'CUIT': 80, 'CUIL': 86, 'DNI': 96 };
            
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const afipDate = `${year}${month}${day}`;

            const afipPayload = {
                Tipo_doc: afipDocTypes[originalInvoice.customer.docTipo] || 99,
                Nro_doc: originalInvoice.customer.docNro ? parseInt(originalInvoice.customer.docNro.replace(/-/g, '')) : 0,
                Tipo_cbte: noteCbteType,
                Punto_vta: parseInt(ptoVtaStr),
                Imp_total: parseFloat(originalInvoice.total.toFixed(2)),
                Imp_neto: parseFloat(totalNeto.toFixed(2)),
                Impto_liq: parseFloat(totalIva.toFixed(2)),
                Fecha_cbte: afipDate,
                Iva: afipIvaArray,
                CbtesAsoc: [{
                    Tipo: originalInvoiceType,
                    PtoVta: parseInt(ptoVtaStr),
                    Nro: parseInt(nroCmpStr)
                }]
            };

            // Determinar URL del endpoint según el modo (cliente usa proxy del servidor)
            let facturacionUrl: string;
            
            if (networkConfig.serverMode === 'client') {
                // Cliente: verificar si tiene configuración AFIP local
                if (afipConfig.cuit && afipConfig.puntoVenta) {
                    // Cliente tiene configuración AFIP local - facturar directamente
                    const urlMatch = (afipConfig.url || '').match(/:(\d+)/);
                    const port = urlMatch ? urlMatch[1] : '3001';
                    facturacionUrl = `http://127.0.0.1:${port}/facturar`;
                    console.log('🏠 Cliente con AFIP local - generando nota directamente:', facturacionUrl);
                } else {
                    // Cliente sin configuración AFIP - usar proxy del servidor
                    const syncServerUrl = networkConfig.serverUrl?.replace('ws://', 'http://').replace('wss://', 'https://') || 'http://localhost:3000';
                    facturacionUrl = syncServerUrl.endsWith('/') 
                        ? `${syncServerUrl}api/facturar` 
                        : `${syncServerUrl}/api/facturar`;
                    console.log('🔄 Cliente usando proxy del servidor para nota de ' + noteTypeName);
                }
            } else {
                // Servidor local: usar facturacion-server directo en localhost
                // Extraer solo el puerto de la URL configurada, pero siempre usar 127.0.0.1
                const urlMatch = (afipConfig.url || '').match(/:(\d+)/);
                const port = urlMatch ? urlMatch[1] : '3001';
                facturacionUrl = `http://127.0.0.1:${port}/facturar`;
                console.log('🏠 Usando servidor local de facturación para nota:', facturacionUrl);
            }

            // Construir las rutas de los archivos cert y key según el certificado seleccionado
            const certType = afipConfig.certificado || 'produccion';
            const certPath = `afip_certs/${certType}.crt`;
            const keyPath = `afip_certs/${certType}.key`;

            const response = await fetch(facturacionUrl, {
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ 
                    afipConfig: { 
                        cuit: afipConfig.cuit, 
                        ambiente: afipConfig.ambiente || 'produccion',
                        cert: certPath,
                        key: keyPath
                    }, 
                    invoiceData: afipPayload 
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Error del servidor de facturación.');
            }

            const result = await response.json();

            await addDocument({
                type: noteType,
                customer: originalInvoice.customer,
                vendedor: originalInvoice.vendedor,
                items: JSON.parse(JSON.stringify(originalInvoice.items)),
                subtotal: originalInvoice.subtotal,
                totalDiscount: originalInvoice.totalDiscount,
                total: originalInvoice.total,
                cae: result.cae,
                caeVencimiento: result.caeVencimiento,
                numeroComprobante: result.numeroComprobante,
                associatedInvoiceId: originalInvoice.id,
            });

            addToast(`Nota de ${noteTypeName} generada con éxito.`, 'success');
            return true;

        } catch (error) {
            console.error(`Error al generar Nota de ${noteTypeName} AFIP:`, error);
            alert(`Error al generar la nota: ${error instanceof Error ? error.message : 'Error desconocido'}`);
            return false;
        }
  };

  const handleSaveAfipConfig = async (newConfig: AfipConfig) => {
      try {
          // Guardar usando el nuevo sistema de archivos
          const success = await saveAfipConfig(newConfig);
          
          if (success) {
              setAfipConfig(newConfig);
              // También guardar en Dexie como backup
              await db.appState.put({ key: 'afipConfig', value: newConfig });
              // Notificar a otros clientes vía WebSocket
              sendUpdate({ type: 'APPSTATE_SAVE', payload: { key: 'afipConfig', value: newConfig } });
              console.log('✅ Configuración AFIP guardada exitosamente');
          } else {
              console.error('❌ Error guardando configuración AFIP');
              addToast('❌ Error guardando configuración AFIP', 'error');
          }
      } catch (error) {
          console.error('❌ Error en handleSaveAfipConfig:', error);
          addToast('❌ Error guardando configuración AFIP', 'error');
      }
  };

    const handleSaveEmailConfig = async (newConfig: EmailConfig) => {
        const state = { key: 'emailConfig', value: newConfig };
        await db.appState.put(state);
        setEmailConfig(newConfig);
        sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
    };

    const handleSaveCompanyInfo = async (newInfo: CompanyInfo) => {
        const state = { key: 'companyInfo', value: newInfo };
        await db.appState.put(state);
        setCompanyInfo(newInfo);
        sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
    };

    const handleSaveKioskConfig = async (newConfig: KioskConfig) => {
        const state = { key: 'kioskConfig', value: newConfig };
        await db.appState.put(state);
        setKioskConfig(newConfig);
        sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
    };

    const handleSaveAutoBackupConfig = async (newConfig: AutoBackupConfig) => {
        const state = { key: 'autoBackupConfig', value: newConfig };
        await db.appState.put(state);
        setAutoBackupConfig(newConfig);
        sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
    };

    const handleSaveControlCajaConfig = async (newConfig: ControlCajaConfig) => {
        const state = { key: 'controlCajaConfig', value: newConfig };
        await db.appState.put(state);
        setControlCajaConfig(newConfig);
        sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
    };

    const handleSaveServerManagerConfig = async (newConfig: ServerManagerConfig) => {
        const state = { key: 'serverManagerConfig', value: newConfig };
        await db.appState.put(state);
        setServerManagerConfig(newConfig);
        sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
    };

    const handleToggleServerManager = async (enabled: boolean) => {
        const newConfig = { ...serverManagerConfig, enabled };
        await handleSaveServerManagerConfig(newConfig);
    };

    const handleSaveNetworkConfig = async (newConfig: NetworkConfig) => {
        const state = { key: 'networkConfig', value: newConfig };
        await db.appState.put(state);
        setNetworkConfig(newConfig);
        sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
        // Reconectar WebSocket si cambió la URL
        if (syncEnabled && wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        // Reprogramar countdown si cambia el autoSyncMode y aún no ha iniciado conexión
        if (syncEnabled && !canStartSync) {
            if (autoConnectTimeoutRef.current) window.clearTimeout(autoConnectTimeoutRef.current);
            let delayMs = 0;
            if (newConfig.autoSyncMode === 'delay10') delayMs = 10_000;
            if (newConfig.autoSyncMode === 'delay30') delayMs = 30_000;
            if (delayMs === 0) {
                setCanStartSync(true);
                setSyncCountdownSeconds(0);
                setAutoConnectTargetTime(null);
            } else {
                setSyncCountdownSeconds(Math.ceil(delayMs/1000));
                const target = Date.now() + delayMs;
                setAutoConnectTargetTime(target);
                autoConnectTimeoutRef.current = window.setTimeout(() => {
                    setCanStartSync(true);
                    setSyncCountdownSeconds(0);
                    setAutoConnectTargetTime(null);
                }, delayMs);
            }
        }
    };

    const handleSaveSystemConfig = async (newConfig: SystemConfig) => {
        const state = { key: 'systemConfig', value: newConfig };
        await db.appState.put(state);
        setSystemConfig(newConfig);
        sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
    };

    const handleSaveCompanyLogo = async (logoBase64: string | null) => {
        const state = { key: 'companyLogo', value: logoBase64 };
        await db.appState.put(state);
        setCompanyLogo(logoBase64);
        sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
    };

    const handleSaveDashboardImage = async (imageBase64: string | null) => {
        const state = { key: 'dashboardImage', value: imageBase64 };
        await db.appState.put(state);
        setDashboardImage(imageBase64);
        sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
    };

    const handleSaveDolarBlue = async (price: number) => {
      const state = { key: 'dolarBlue', value: price };
      await db.appState.put(state);
      setDolarBlue(price);
      sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
    };

    const handleSaveSyncEnabled = async (enabled: boolean) => {
        console.log('🔵 [SYNC_SAVE] Guardando syncEnabled =', enabled);
        const state = { key: 'syncEnabled', value: enabled };
        await db.appState.put(state);
        setSyncEnabled(enabled);
        sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
        // Si se habilita manualmente, permitir conexión inmediata ignorando delay
        if (enabled) {
            if (autoConnectTimeoutRef.current) window.clearTimeout(autoConnectTimeoutRef.current);
            setCanStartSync(true);
            setSyncCountdownSeconds(0);
            setAutoConnectTargetTime(null);
        } else {
            // Al deshabilitar, impedir conexiones futuras hasta que se vuelva a habilitar
            if (autoConnectTimeoutRef.current) window.clearTimeout(autoConnectTimeoutRef.current);
            setCanStartSync(false);
            setSyncCountdownSeconds(0);
            setAutoConnectTargetTime(null);
            // Cerrar conexión existente si hubiera
            if (wsRef.current) {
                try { wsRef.current.close(); } catch (e) { /* ignore */ }
                wsRef.current = null;
            }
        }
    };
    
    const handleSaveGeminiApiKey = async (key: string) => {
      const state = { key: 'geminiApiKey', value: key };
      await db.appState.put(state);
      setGeminiApiKey(key);
      sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
    };
    
    const handleSaveOpenaiApiKey = async (key: string) => {
      const state = { key: 'openaiApiKey', value: key };
      await db.appState.put(state);
      setOpenaiApiKey(key);
      sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
    };

    const handleSaveOpenrouterApiKey = async (key: string) => {
      const state = { key: 'openrouterApiKey', value: key };
      await db.appState.put(state);
      setOpenrouterApiKey(key);
      sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
    };

    const handleSaveOpenrouterModel = async (model: string) => {
      const state = { key: 'openrouterModel', value: model };
      await db.appState.put(state);
      setOpenrouterModel(model);
      sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
    };

        // Forzar conexión inmediata (salta el delay)
        const handleForceSyncConnect = () => {
            if (autoConnectTimeoutRef.current) window.clearTimeout(autoConnectTimeoutRef.current);
            setCanStartSync(true);
            setSyncCountdownSeconds(0);
            setAutoConnectTargetTime(null);
        };

        const handleSaveHuggingfaceApiKey = async (key: string) => {
            const state = { key: 'huggingfaceApiKey', value: key };
            await db.appState.put(state);
            setHuggingfaceApiKey(key);
            sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
        };

        const handleSaveHuggingfaceModel = async (model: string) => {
            const state = { key: 'huggingfaceModel', value: model };
            await db.appState.put(state);
            setHuggingfaceModel(model);
            sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
        };

        const handleSaveHuggingfaceUseV1 = async (useV1: boolean) => {
            const state = { key: 'huggingfaceUseV1', value: useV1 };
            await db.appState.put(state);
            setHuggingfaceUseV1(useV1);
            sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
        };

        const handleSaveHuggingfaceBillTo = async (billTo: string) => {
            const state = { key: 'huggingfaceBillTo', value: billTo };
            await db.appState.put(state);
            setHuggingfaceBillTo(billTo);
            sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
        };

    const handleSaveAiProvider = async (provider: AiProvider) => {
      const state = { key: 'aiProvider', value: provider };
      await db.appState.put(state);
      setAiProvider(provider);
      sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
    };

        const handleSaveAiFullAccess = async (enabled: boolean) => {
                const state = { key: 'aiFullAccess', value: enabled };
                await db.appState.put(state);
                setAiFullAccess(enabled);
                sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
        };

  const handleSaveProduct = async (data: Product, mode: 'add' | 'edit') => {
    console.log(`💾 Guardando producto: ${data.cod} - ${data.desc} (modo: ${mode})`);
    await db.products.put(data);
    if (mode === 'add') setProducts(prev => [...prev, data]);
    else setProducts(prev => prev.map(p => p.cod === data.cod ? data : p));
    console.log(`📤 Enviando PRODUCT_SAVE al servidor para: ${data.cod}`);
    sendUpdate({ type: 'PRODUCT_SAVE', payload: data });
  };
  const handleDeleteProduct = async (cod: string) => {
    await db.products.delete(cod);
    setProducts(prev => prev.filter(p => p.cod !== cod));
    sendUpdate({ type: 'PRODUCT_DELETE', payload: { cod } });
  };
  const handleSetProducts = async (newProducts: Product[]) => {
      await db.products.bulkPut(newProducts);
      setProducts(newProducts);
      sendUpdate({ type: 'PRODUCTS_SET', payload: newProducts });
  }

  const handleSaveClient = async (data: Customer, mode: 'add' | 'edit') => {
    await db.clients.put(data);
    if (mode === 'add') setClients(prev => [...prev, data]);
    else setClients(prev => prev.map(c => c.cod === data.cod ? data : c));
    sendUpdate({ type: 'CLIENT_SAVE', payload: data });
  };
  const handleDeleteClient = async (cod: string) => {
    await db.clients.delete(cod);
    setClients(prev => prev.filter(c => c.cod !== cod));
    sendUpdate({ type: 'CLIENT_DELETE', payload: { cod } });
  };

  const handleSavePromociones = async (newPromociones: Promocion[]) => {
    await db.promociones.clear();
    await db.promociones.bulkPut(newPromociones);
    setPromociones(newPromociones);
    
    // Sincronizar promociones activas como productos virtuales
    await sincronizarPromocionesComoProductos(newPromociones);
    
    sendUpdate({ type: 'PROMOCIONES_SET', payload: newPromociones });
  };

  const sincronizarPromocionesComoProductos = async (promos: Promocion[]) => {
    // Eliminar productos de promociones antiguas
    const productosPromo = products.filter(p => p.esPromocion);
    for (const prod of productosPromo) {
      await db.products.delete(prod.cod);
    }

    // Crear/actualizar productos virtuales para promociones activas
    const nuevosProductosPromo: Product[] = [];
    for (const promo of promos.filter(p => p.activa)) {
      const productoVirtual: Product = {
        cod: promo.codigo,
        codBarras: promo.codigo,
        desc: promo.detalle,
        marca: 'PROMOCION',
        familia: 'PROMOCION',
        proveedor: 'PROMO',
        precioCompra: promo.items.reduce((total, item) => {
          const prod = products.find(p => p.cod === item.productoCod);
          return total + ((prod?.costo || prod?.precioCompra || 0) * item.cantidad);
        }, 0),
        precioVenta: promo.precioTotal,
        stock: Math.min(...promo.items.map(item => {
          const prod = products.find(p => p.cod === item.productoCod);
          return prod ? Math.floor(prod.stock / item.cantidad) : 0;
        })),
        stockMinimo: 0,
        esPromocion: true,
        promocionId: promo.id,
        promocionItems: promo.items,
        lista1: promo.precioTotal,
        lista2: promo.precioTotal,
        lista3: promo.precioTotal,
        lista4: promo.precioTotal,
      };
      
      await db.products.put(productoVirtual);
      nuevosProductosPromo.push(productoVirtual);
    }

    // Actualizar el estado de productos
    const productosNoPromo = products.filter(p => !p.esPromocion);
    setProducts([...productosNoPromo, ...nuevosProductosPromo]);
  };

  const handleSaveProveedor = async (data: Proveedor, mode: 'add' | 'edit') => {
    await db.proveedores.put(data);
    if (mode === 'add') setProveedores(prev => [...prev, data]);
    else setProveedores(prev => prev.map(p => p.cod === data.cod ? data : p));
    sendUpdate({ type: 'PROVEEDOR_SAVE', payload: data });
  };
  const handleDeleteProveedor = async (cod: string) => {
    await db.proveedores.delete(cod);
    setProveedores(prev => prev.filter(p => p.cod !== cod));
    sendUpdate({ type: 'PROVEEDOR_DELETE', payload: { cod } });
  };

  const handleSaveMarca = async (data: Marca, mode: 'add' | 'edit') => {
    await db.marcas.put(data);
    if (mode === 'add') setMarcas(prev => [...prev, data]);
    else setMarcas(prev => prev.map(m => m.id === data.id ? data : m));
    sendUpdate({ type: 'MARCA_SAVE', payload: data });
  };
  const handleDeleteMarca = async (id: string) => {
    await db.marcas.delete(id);
    setMarcas(prev => prev.filter(m => m.id !== id));
    sendUpdate({ type: 'MARCA_DELETE', payload: { id } });
  };

  const handleSaveFamilia = async (data: Familia, mode: 'add' | 'edit') => {
    await db.familias.put(data);
    if (mode === 'add') setFamilias(prev => [...prev, data]);
    else setFamilias(prev => prev.map(f => f.id === data.id ? data : f));
    sendUpdate({ type: 'FAMILIA_SAVE', payload: data });
  };
  const handleDeleteFamilia = async (id: string) => {
    await db.familias.delete(id);
    setFamilias(prev => prev.filter(f => f.id !== id));
    sendUpdate({ type: 'FAMILIA_DELETE', payload: { id } });
  };

  const handleSaveVendedor = async (data: Vendedor, mode: 'add' | 'edit') => {
    await db.vendedores.put(data);
    if (mode === 'add') setVendedores(prev => [...prev, data]);
    else setVendedores(prev => prev.map(v => v.cod === data.cod ? data : v));
    sendUpdate({ type: 'VENDEDOR_SAVE', payload: data });
  };
  const handleDeleteVendedor = async (cod: string) => {
    await db.vendedores.delete(cod);
    setVendedores(prev => prev.filter(v => v.cod !== cod));
    sendUpdate({ type: 'VENDEDOR_DELETE', payload: { cod } });
  };

  const handleSaveCheque = async (data: Omit<Cheque, 'id'>, id?: number) => {
    let savedCheque: Cheque;
    if (id !== undefined) {
      savedCheque = { ...data, id };
      await db.cheques.put(savedCheque);
      setCheques(prev => prev.map(c => c.id === id ? savedCheque : c));
    } else {
      const newId = await db.cheques.add(data as Cheque);
      savedCheque = { ...data, id: newId };
      setCheques(prev => [...prev, savedCheque]);
    }
    sendUpdate({ type: 'CHEQUE_SAVE', payload: savedCheque });
  };
  const handleDeleteCheque = async (id: number) => {
    await db.cheques.delete(id);
    setCheques(prev => prev.filter(c => c.id !== id));
    sendUpdate({ type: 'CHEQUE_DELETE', payload: { id } });
  };

  const handleAbrirCaja = async (saldoInicial: number) => {
    if (caja.abierta) return;
    const fecha = new Date().toISOString();
    const aperturaMov: CajaMovimiento = { id: 1, fecha, concepto: 'Apertura de Caja', tipo: 'Apertura', importe: saldoInicial, usuario: currentUser?.nombre || 'N/A' };
    const newCajaState = { abierta: true, fechaApertura: fecha, saldoInicial, movimientos: [aperturaMov] };
    const state = { key: 'caja', value: newCajaState };
    await db.appState.put(state);
    setCaja(newCajaState);
    sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
  };

    // Helper: compute Control de Caja summary for a period and optional vendor
    // ASYNC para leer de DB - siempre toma los datos más frescos
    const computeControlCajaSummary = async (from: Date, to: Date, vendorCod?: string) => {
        console.log('🚨 [COMPUTE_START] INICIANDO COMPUTE CONTROL CAJA');
        
        // 🔧 FORZAR múltiples lecturas para depurar el problema
        console.log('[CONTROL_CAJA:DEBUG_DB_READ] Leyendo desde múltiples fuentes...');
        
        // Intentar leer con múltiples métodos
        const cajaFromDB1 = await db.appState.get('caja');
        const allAppState = await db.appState.toArray();
        const cajaFromArray = allAppState.find(item => item.key === 'caja');
        
        console.log('[CONTROL_CAJA:DEBUG_DB_READ] Resultados:', {
            metodo1_get: {
                existe: !!cajaFromDB1,
                movimientos: cajaFromDB1?.value?.movimientos?.length || 0
            },
            metodo2_array: {
                existe: !!cajaFromArray,
                movimientos: cajaFromArray?.value?.movimientos?.length || 0
            },
            totalAppStateItems: allAppState.length,
            appStateKeys: allAppState.map(item => item.key)
        });
        
        // 🚨 DETECCIÓN DE PROBLEMA: Si no hay movimientos, construir desde documentos
        const movimientos1 = cajaFromDB1?.value?.movimientos?.length || 0;
        const movimientos2 = cajaFromArray?.value?.movimientos?.length || 0;
        
        // Usar el método que funciona
        let cajaFromDB = cajaFromArray || cajaFromDB1;
        
        if (movimientos1 === 0 && movimientos2 === 0) {
            console.error('🚨 [EMERGENCY] Caja sin movimientos! Construyendo desde documentos de venta...');
            
            // SOLUCIÓN REAL: Construir movimientos desde los documentos de venta
            const allDocs = await db.saleDocuments.toArray();
            console.log('[EMERGENCY] Total documentos en DB:', allDocs.length);
            
            // Filtrar documentos por fecha y vendedor
            console.log('🔍 [EMERGENCY:FILTER_DEBUG] Rango de fechas:', {
                from: from.toISOString(),
                to: to.toISOString(),
                fromMs: from.getTime(),
                toMs: to.getTime()
            });
            
            const relevantDocs = allDocs.filter(doc => {
                // Parsear fecha en formato dd/mm/yyyy a Date
                let docDate: Date;
                if (doc.date.includes('/')) {
                    // Formato dd/mm/yyyy
                    const [day, month, year] = doc.date.split('/').map(Number);
                    docDate = new Date(year, month - 1, day); // month es 0-indexed
                } else {
                    // Formato ISO
                    docDate = new Date(doc.date);
                }
                
                const docDateMs = docDate.getTime();
                const fromMs = from.getTime();
                const toMs = to.getTime();
                
                const dentroDeRango = docDateMs >= fromMs && docDateMs <= toMs;
                const esVendedor = !vendorCod || doc.vendedor?.cod === vendorCod;
                
                // Debug: loggear TODOS los documentos del vendedor
                if (doc.vendedor?.cod === vendorCod) {
                    console.log(`[EMERGENCY:DOC_CHECK] Doc ${doc.id}:`, {
                        date: doc.date,
                        docDateMs,
                        fromMs,
                        toMs,
                        dentroDeRango,
                        diferencia: docDateMs - fromMs,
                        vendedor: doc.vendedor?.nombre,
                        incluido: dentroDeRango && esVendedor
                    });
                }
                
                return dentroDeRango && esVendedor;
            });
            
            console.log('[EMERGENCY] Documentos filtrados:', relevantDocs.length, 'de', allDocs.length);
            console.log('[EMERGENCY] Filtros aplicados:', { 
                from: from.toISOString(), 
                to: to.toISOString(), 
                vendorCod,
                vendorName: vendorCod ? vendedores.find(v => v.cod === vendorCod)?.nombre : 'Todos'
            });
            
            if (relevantDocs.length > 0) {
                console.log('[EMERGENCY] Documentos incluidos:', relevantDocs.map(d => ({
                    id: d.id,
                    date: d.date,
                    vendedor: d.vendedor?.nombre,
                    total: d.total
                })));
            }
            
            // Convertir documentos a movimientos
            const movimientosFromDocs = relevantDocs.map(doc => ({
                id: doc.id,
                fecha: doc.date,
                usuario: doc.vendedor?.nombre || 'Desconocido',
                concepto: `Venta - ${doc.type === 'invoice' ? 'Factura' : 'Remito'} N° ${doc.id}`,
                tipo: 'Ingreso Venta',
                importe: doc.total
            }));
            
            console.log('✅ [EMERGENCY] Movimientos construidos:', movimientosFromDocs.length);
            if (movimientosFromDocs.length > 0) {
                console.log('[EMERGENCY] Primeros 3 movimientos:', movimientosFromDocs.slice(0, 3));
            }
            
            // Crear caja temporal con estos movimientos
            const cajaEmergencia = {
                abierta: true,
                fechaApertura: from.toISOString(),
                saldoInicial: 0,
                movimientos: movimientosFromDocs
            };
            
            cajaFromDB = { key: 'caja', value: cajaEmergencia };
            console.log('✅ [EMERGENCY] Caja reconstruida con', movimientosFromDocs.length, 'movimientos');
        }
        
        const cajaActual: CajaEstado = cajaFromDB?.value || { abierta: false, fechaApertura: null, saldoInicial: 0, movimientos: [] };
        
        const vendorName = vendorCod ? vendedores.find(v => v.cod === vendorCod)?.nombre : undefined;

        console.log('[CONTROL_CAJA:VENDOR_LOOKUP]', {
            vendorCod,
            allVendedores: vendedores.map(v => ({cod: v.cod, nombre: v.nombre})),
            foundVendor: vendedores.find(v => v.cod === vendorCod),
            vendorName
        });

        console.log('[CONTROL_CAJA:COMPUTE] Inicio', {
            from: from.toISOString(),
            to: to.toISOString(),
            vendorCod,
            vendorName,
            totalMovimientos: cajaActual.movimientos.length,
            movimientosSnapshot: cajaActual.movimientos.slice(-10).map(m => ({
                fecha: m.fecha,
                tipo: m.tipo,
                usuario: m.usuario,
                importe: m.importe,
                concepto: m.concepto
            }))
        });

            // Movements filtered by date and (optional) vendor (matched by name)
            const movimientosFiltrados = cajaActual.movimientos.filter(mov => {
            const f = new Date(mov.fecha);
            if (f < from || f > to) return false;
            if (vendorName && mov.usuario !== vendorName) return false;
                if (mov.tipo === 'Apertura' || mov.tipo === 'Cierre') return false;
            return true;
        });

        const movimientosAgrupados: { [key: string]: { total: number; ingreso: number; egreso: number; cantidad?: number } } = {};
            // Ventas: sumar por movimientos de 'Ingreso Venta' en la ventana (con precisión por hora)
            const movimientosVenta = cajaActual.movimientos
                .filter(mov => {
                    if (mov.tipo !== 'Ingreso Venta') return false;
                    const f = new Date(mov.fecha);
                    const enRango = f >= from && f <= to;
                    const usuarioMatch = !vendorName || mov.usuario === vendorName;
                    console.log('[CONTROL_CAJA:MOV_VENTA]', {
                        fecha: mov.fecha,
                        usuario: mov.usuario,
                        vendorName,
                        usuarioMatch,
                        enRango,
                        importe: mov.importe,
                        concepto: mov.concepto
                    });
                    return enRango && usuarioMatch;
                });
            
            // Separar facturas y remitos
            const facturas = movimientosVenta.filter(m => m.concepto.includes('Factura'));
            const remitos = movimientosVenta.filter(m => m.concepto.includes('Remito'));
            
            const totalFacturas = facturas.reduce((s, m) => s + (m.importe || 0), 0);
            const totalRemitos = remitos.reduce((s, m) => s + (m.importe || 0), 0);
            const ventasFromMov = totalFacturas + totalRemitos;
            
            console.log('[CONTROL_CAJA:VENTAS_TOTAL]', {
                movimientosEncontrados: movimientosVenta.length,
                facturas: { cantidad: facturas.length, total: totalFacturas },
                remitos: { cantidad: remitos.length, total: totalRemitos },
                ventasFromMov,
                movimientosVentaDetalle: movimientosVenta.map(m => ({
                    fecha: m.fecha,
                    usuario: m.usuario,
                    concepto: m.concepto,
                    importe: m.importe
                }))
            });
            
            if (totalFacturas !== 0) {
                movimientosAgrupados['Facturas'] = {
                    total: Math.abs(totalFacturas),
                    ingreso: totalFacturas > 0 ? totalFacturas : 0,
                    egreso: totalFacturas < 0 ? Math.abs(totalFacturas) : 0,
                    cantidad: facturas.length
                };
            }
            
            if (totalRemitos !== 0) {
                movimientosAgrupados['Remitos'] = {
                    total: Math.abs(totalRemitos),
                    ingreso: totalRemitos > 0 ? totalRemitos : 0,
                    egreso: totalRemitos < 0 ? Math.abs(totalRemitos) : 0,
                    cantidad: remitos.length
                };
            }

            for (const mov of movimientosFiltrados) {
            let key = '';
            if (mov.tipo === 'Ingreso Manual') key = 'Ingresos de Caja';
            else if (mov.tipo === 'Egreso Manual') key = 'Retiros de Caja';
            else if (mov.tipo === 'Egreso Compra') {
                let metodo = 'Efectivo';
                if (mov.concepto.includes('(Transferencia')) metodo = 'Transferencia';
                else if (mov.concepto.includes('(Cheque')) metodo = 'Cheque';
                key = `Compras - ${metodo}`;
            } else {
                key = mov.tipo;
            }
            if (!movimientosAgrupados[key]) {
                movimientosAgrupados[key] = { total: 0, ingreso: 0, egreso: 0, cantidad: 0 };
            }
            movimientosAgrupados[key].cantidad = (movimientosAgrupados[key].cantidad || 0) + 1;
            if (mov.importe >= 0) {
                movimientosAgrupados[key].total += mov.importe;
                movimientosAgrupados[key].ingreso += mov.importe;
            } else {
                const abs = Math.abs(mov.importe);
                movimientosAgrupados[key].total += abs;
                movimientosAgrupados[key].egreso += abs;
            }
        }

            const totalIngresos = Object.values(movimientosAgrupados).reduce((s, m) => s + m.ingreso, 0) + cajaActual.saldoInicial;
        const totalEgresos = Object.values(movimientosAgrupados).reduce((s, m) => s + m.egreso, 0);
        const saldoFinal = cajaActual.saldoInicial + (totalIngresos - cajaActual.saldoInicial) - totalEgresos;

        const result = {
            desde: from,
            hasta: to,
            vendorCod: vendorCod || null,
            vendorName: vendorName || null,
            movimientosAgrupados,
            saldoInicial: cajaActual.saldoInicial,
            ingresos: totalIngresos,
            egresos: totalEgresos,
            saldoFinal,
            ventasFromMov
        } as const;

        console.log('[CONTROL_CAJA:RESULT_FINAL]', {
            vendorName: result.vendorName,
            ventasFromMov: result.ventasFromMov,
            movimientosAgrupados: Object.keys(result.movimientosAgrupados),
            facturas: result.movimientosAgrupados['Facturas'] || 'NO ENCONTRADAS',
            remitos: result.movimientosAgrupados['Remitos'] || 'NO ENCONTRADOS',
            desde: result.desde.toISOString(),
            hasta: result.hasta.toISOString(),
            vendorCod: result.vendorCod
        });

        // ALERTA CRÍTICA si las ventas son 0
        if (result.ventasFromMov === 0 && result.vendorName) {
            console.error('🚨 ALERTA: ventasFromMov es 0 para', result.vendorName);
            console.error('Verificar:', {
                movimientosVentaEncontrados: movimientosVenta.length,
                rango: `${result.desde.toISOString()} → ${result.hasta.toISOString()}`,
                vendorMatch: result.vendorName
            });
        }

        return result;
    };

    // Helper: generate simple PDF (Base64) for Control de Caja summary
        const generateControlCajaPdfBase64 = useCallback(async (summary: Awaited<ReturnType<typeof computeControlCajaSummary>>) => {
        const w: any = window as any;
        const jsPDF = w.jspdf?.jsPDF || (w.jspdf && w.jspdf.jsPDF);
        if (!jsPDF) throw new Error('jsPDF no está cargado');

        const pdf = new jsPDF('p', 'mm', 'a4');
        const formatMoney = (n: number) => `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        const title = 'Control de Caja';
        const company = companyInfo.nombre || 'FX VENTAS';
        const rango = `${summary.desde.toLocaleDateString('es-AR')} ${summary.desde.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} - ${summary.hasta.toLocaleDateString('es-AR')} ${summary.hasta.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;
        const vendedor = summary.vendorName ? `Vendedor: ${summary.vendorName}` : 'Vendedor: Todos';

        let y = 15;
        pdf.setFontSize(16); pdf.text(company, 10, y); y += 8;
        pdf.setFontSize(14); pdf.text(title, 10, y); y += 8;
        pdf.setFontSize(10); pdf.text(rango, 10, y); y += 6;
        pdf.text(vendedor, 10, y); y += 10;

        // Totales del período (precisos por movimientos)
        pdf.setFontSize(12); pdf.text('Totales del Período', 10, y); y += 6;
        pdf.setFontSize(10);
        const facturas = summary.movimientosAgrupados['Facturas'];
        const remitos = summary.movimientosAgrupados['Remitos'];
        if (facturas) {
            pdf.text(`Facturas (${facturas.cantidad || 0}): ${formatMoney(facturas.total)}`, 12, y); y += 6;
        }
        if (remitos) {
            pdf.text(`Remitos (${remitos.cantidad || 0}): ${formatMoney(remitos.total)}`, 12, y); y += 6;
        }
    pdf.text(`Ventas Totales: ${formatMoney(summary.ventasFromMov || 0)}`, 12, y); y += 6;

    // Totales de caja (Ingresos/Retiros/Compras)
    const ingresosCaja = summary.movimientosAgrupados['Ingresos de Caja'];
    const retirosCaja = summary.movimientosAgrupados['Retiros de Caja'];
    const compraEntries = Object.entries(summary.movimientosAgrupados).filter(([k]) => k.startsWith('Compras - '));
    const comprasTotal = compraEntries.reduce((s, [, m]: any) => s + (m?.total || 0), 0);
    const comprasCount = compraEntries.reduce((s, [, m]: any) => s + (m?.cantidad || 0), 0);
    if (ingresosCaja) { pdf.text(`Ingresos de Caja (${ingresosCaja.cantidad || 0}): ${formatMoney(ingresosCaja.total)}`, 12, y); y += 6; }
    if (retirosCaja) { pdf.text(`Retiros de Caja (${retirosCaja.cantidad || 0}): ${formatMoney(retirosCaja.total)}`, 12, y); y += 6; }
    if (compraEntries.length) { pdf.text(`Compras (${comprasCount}): ${formatMoney(comprasTotal)}`, 12, y); y += 8; }

    // Detalle de Movimientos
    pdf.setFontSize(12); pdf.text('Detalle de Movimientos', 10, y); y += 6;
        pdf.setFontSize(10);
        pdf.text(`Saldo Inicial: ${formatMoney(summary.saldoInicial)}`, 12, y); y += 6;
        const entries = Object.entries(summary.movimientosAgrupados);
        for (const [key, mov] of entries) {
            if (y > 270) { pdf.addPage(); y = 15; }
            const label = mov.cantidad ? `${key} (${mov.cantidad})` : key;
            pdf.text(label, 12, y);
            pdf.text(`Total: ${formatMoney(mov.total)}`, 90, y);
            pdf.text(`Ingreso: ${formatMoney(mov.ingreso)}`, 130, y);
            pdf.text(`Egreso: ${formatMoney(mov.egreso)}`, 170, y);
            y += 6;
        }
        y += 4;
        if (y > 270) { pdf.addPage(); y = 15; }
        pdf.setFontSize(11);
        pdf.text(`Ingresos: ${formatMoney(summary.ingresos)}`, 12, y); y += 6;
        pdf.text(`Egresos: ${formatMoney(summary.egresos)}`, 12, y); y += 6;
        pdf.text(`Saldo Final: ${formatMoney(summary.saldoFinal)}`, 12, y); y += 6;

        const fileName = `ControlCaja_${summary.vendorName ? summary.vendorName.replace(/\s+/g,'_') : 'Todos'}_${new Date().toISOString().slice(0,10)}.pdf`;
        const base64 = pdf.output('datauristring').split(',')[1];
        return { base64, fileName };
    }, [companyInfo.nombre]);

    // Helper: send Control de Caja email via local email server
        const sendControlCajaEmail = useCallback(async (to: string, subject: string, pdfBase64: string) => {
        const resp = await fetch('http://localhost:3004/api/email/send-document', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    to, 
                    subject, 
                    documentType: 'Control de Caja', 
                    documentNumber: '-', 
                    customerName: companyInfo.nombre || 'Empresa',
                    pdfBase64, 
                    companyName: companyInfo.nombre || 'FX VENTAS' 
                })
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) {
            throw new Error(data?.message || 'Error enviando email');
        }
        }, [companyInfo.nombre]);

    // Compose and send Control de Caja report if configured
    // NO usar useCallback para que siempre lea el estado fresco de caja
    const sendControlCajaReport = async (from: Date, to: Date, vendorCod?: string) => {
        try {
            if (!controlCajaConfig.emailEnabled) return;
            const toEmail = (controlCajaConfig.recipientEmail || '').trim();
            if (!toEmail || !/^([^\s@]+)@([^\s@]+)\.[^\s@]+$/.test(toEmail)) return;

            console.log('[CONTROL_CAJA:SEND_START] Leyendo estado actual de caja:', {
                movimientosActuales: caja.movimientos.length,
                ultimoMovimiento: caja.movimientos[caja.movimientos.length - 1]
            });

            // 🚨 LOG CRÍTICO: Parámetros exactos enviados a computeControlCajaSummary
            console.log('🎯 [SEND_REPORT:CRITICAL] Parámetros a enviar a compute:', {
                from: from.toISOString(),
                to: to.toISOString(),
                vendorCod: vendorCod,
                vendorCodType: typeof vendorCod
            });

            const summary = await computeControlCajaSummary(from, to, vendorCod);
            const pdf = await generateControlCajaPdfBase64(summary);
            const vendedorLabel = summary.vendorName ? ` - ${summary.vendorName}` : '';
            console.log('[CONTROL_CAJA:SEND]', {
                vendorCod,
                vendorName: summary.vendorName || 'Todos',
                desde: summary.desde.toISOString(),
                hasta: summary.hasta.toISOString(),
                ventasFromMov: summary.ventasFromMov || 0,
                grupos: Object.keys(summary.movimientosAgrupados)
            });
            const subject = `Control de Caja${vendedorLabel} - ${companyInfo.nombre || 'FX VENTAS'} (${summary.desde.toLocaleDateString('es-AR')} ${summary.desde.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})} - ${summary.hasta.toLocaleDateString('es-AR')} ${summary.hasta.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})})`;
            await sendControlCajaEmail(toEmail, subject, pdf.base64);
            addToast('Control de Caja enviado por email.', 'success');
        } catch (err) {
            console.error('Error enviando Control de Caja:', err);
            addToast('Error al enviar Control de Caja por email.', 'error');
        }
    };

    // Switch user: envía informe del vendedor saliente inmediatamente ANTES de hacer logout
    const handleSwitchUser = async () => {
        // Capturar el usuario ACTUAL (currentUser) antes de hacer logout
        const outgoingUser = currentUser;
        const sessionStart = lastVendorSwitchTimeRef.current;
        
        console.log('[SWITCH_USER:INICIO]', {
            outgoingUser: outgoingUser?.nombre,
            outgoingCod: outgoingUser?.cod,
            sessionStart: sessionStart ? new Date(sessionStart).toISOString() : null,
            ahora: new Date().toISOString()
        });
        
        try {
            if (controlCajaConfig.emailEnabled && controlCajaConfig.sendOnVendorChange && outgoingUser && sessionStart) {
                // CORRECCIÓN: Usar SOLO el inicio del día actual (no incluir días anteriores)
                const hoy = new Date();
                hoy.setHours(0, 0, 0, 0); // Inicio del día actual (00:00:00)
                const desde = hoy; // Siempre desde inicio del día de HOY
                const hasta = new Date(); // Hasta ahora
                
                console.log('[SWITCH_USER] Enviando informe del vendedor saliente:', {
                    vendorCod: outgoingUser.cod,
                    vendorName: outgoingUser.nombre,
                    sessionStart: new Date(sessionStart).toISOString(),
                    inicioDelDia: hoy.toISOString(),
                    desdeUsado: desde.toISOString(),
                    hasta: hasta.toISOString()
                });
                
                // 🚨 LOG CRÍTICO: Verificar exactamente qué parámetros se envían
                console.log('🎯 [SWITCH_USER:CRITICAL] Parámetros exactos para Control de Caja:', {
                    desdeFinal: desde.toISOString(),
                    hastaFinal: hasta.toISOString(),
                    vendorCodFinal: outgoingUser.cod,
                    esCarla: outgoingUser.cod === '2',
                    nombreVendedor: outgoingUser.nombre
                });
                
                await sendControlCajaReport(desde, hasta, outgoingUser.cod);
            }
        } catch (e) {
            console.error('Error enviando Control de Caja al cambiar de usuario:', e);
        } finally {
            // Limpiar estado para el próximo login
            lastVendorSwitchTimeRef.current = null;
            setCurrentUser(null);
            setActiveView(null);
        }
    };

  const handleSaveMovimientoCaja = async (tipo: 'Ingreso Manual' | 'Egreso Manual', concepto: string, importe: number) => {
    if (!caja.abierta) return;
    const cajaStateFromDB = await db.appState.get('caja');
    const cajaActual = cajaStateFromDB?.value || caja;
    const lastMovement = cajaActual.movimientos[cajaActual.movimientos.length - 1];
    const newMov: CajaMovimiento = { id: (lastMovement?.id || 0) + 1, fecha: new Date().toISOString(), concepto, tipo, importe: tipo === 'Ingreso Manual' ? importe : -importe, usuario: currentUser?.nombre || 'N/A' };
    const newCajaState = { ...cajaActual, movimientos: [...cajaActual.movimientos, newMov] };
    const state = { key: 'caja', value: newCajaState };
    await db.appState.put(state);
    setCaja(newCajaState);
    sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
  };

  const handleAddMovimientoCaja = async (concepto: string, importe: number, tipo: 'Ingreso Manual' | 'Egreso Manual') => {
    if (!caja.abierta) return;
    const lastMovement = caja.movimientos[caja.movimientos.length - 1];
    const newMov: CajaMovimiento = { 
      id: (lastMovement?.id || 0) + 1, 
      fecha: new Date().toISOString(), 
      concepto, 
      tipo, 
      importe, 
      usuario: currentUser?.nombre || 'N/A' 
    };
    const newCajaState = { ...caja, movimientos: [...caja.movimientos, newMov] };
    const state = { key: 'caja', value: newCajaState };
    await db.appState.put(state);
    setCaja(newCajaState);
    sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
  };

  const handleEditMovimientoCaja = async (id: number, tipo: 'Ingreso Manual' | 'Egreso Manual', concepto: string, importe: number) => {
    if (!caja.abierta) return;
    const updatedMovimientos = caja.movimientos.map(mov => 
      mov.id === id 
        ? { ...mov, concepto, tipo, importe: tipo === 'Ingreso Manual' ? importe : -importe }
        : mov
    );
    const newCajaState = { ...caja, movimientos: updatedMovimientos };
    const state = { key: 'caja', value: newCajaState };
    await db.appState.put(state);
    setCaja(newCajaState);
    sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
  };

  const handleDeleteMovimientoCaja = async (id: number) => {
    if (!caja.abierta) return;
    const movimiento = caja.movimientos.find(mov => mov.id === id);
    if (!movimiento) return;
    
    // No permitir eliminar movimientos de apertura o cierre
    if (movimiento.tipo === 'Apertura' || movimiento.tipo === 'Cierre') {
      alert('No se pueden eliminar movimientos de apertura o cierre de caja.');
      return;
    }

    if (!window.confirm(`¿Está seguro de eliminar el movimiento "${movimiento.concepto}" por ${movimiento.importe < 0 ? '-' : ''}$${Math.abs(movimiento.importe).toFixed(2)}?`)) {
      return;
    }

    const updatedMovimientos = caja.movimientos.filter(mov => mov.id !== id);
    const newCajaState = { ...caja, movimientos: updatedMovimientos };
    const state = { key: 'caja', value: newCajaState };
    await db.appState.put(state);
    setCaja(newCajaState);
    sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
  };

    const handleCerrarCaja = async () => {
    if (!caja.abierta) return;
        // Auto-send Control de Caja on close if configured
        try {
            if (controlCajaConfig.emailEnabled && controlCajaConfig.sendOnCajaClose && caja.fechaApertura) {
                const desde = new Date(caja.fechaApertura);
                const hasta = new Date();
                await sendControlCajaReport(desde, hasta);
            }
        } catch {}
    const newCajaState = { abierta: false, fechaApertura: null, saldoInicial: 0, movimientos: [] };
    const state = { key: 'caja', value: newCajaState };
    await db.appState.put(state);
    setCaja(newCajaState);
    alert("Caja cerrada y reiniciada.");
    sendUpdate({ type: 'APPSTATE_SAVE', payload: state });
  };

  // Effect for scheduled emails
  useEffect(() => {
    if (!controlCajaConfig.scheduledEmailEnabled || !controlCajaConfig.scheduledEmailTimes || controlCajaConfig.scheduledEmailTimes.length === 0) {
      return;
    }

    const checkScheduledEmails = () => {
      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      const currentDateKey = now.toLocaleDateString('es-AR');
      
      // Check if we already sent an email for any scheduled time today
      const sentKey = `scheduledEmail_${currentDateKey}`;
      const sentTimes = JSON.parse(localStorage.getItem(sentKey) || '[]') as string[];

      (controlCajaConfig.scheduledEmailTimes || []).forEach(scheduledTime => {
        if (currentTime === scheduledTime && !sentTimes.includes(scheduledTime)) {
          // Send email for this scheduled time
          const startOfDay = new Date();
          startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date();
          
          sendControlCajaReport(startOfDay, endOfDay).then(() => {
            // Mark this time as sent for today
            const updatedSentTimes = [...sentTimes, scheduledTime];
            localStorage.setItem(sentKey, JSON.stringify(updatedSentTimes));
            console.log(`[SCHEDULED_EMAIL] Enviado a las ${scheduledTime} el ${currentDateKey}`);
          }).catch(err => {
            console.error('[SCHEDULED_EMAIL] Error:', err);
          });
        }
      });

      // Clean up old entries (keep only today's)
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('scheduledEmail_') && key !== sentKey) {
          localStorage.removeItem(key);
        }
      });
    };

    // Check every minute
    const intervalId = setInterval(checkScheduledEmails, 60000);
    
    // Check immediately on mount
    checkScheduledEmails();

    return () => clearInterval(intervalId);
  }, [controlCajaConfig.scheduledEmailEnabled, controlCajaConfig.scheduledEmailTimes]);

  // Fix ULTRA-AGRESIVO para inputs desde React
  useEffect(() => {
    console.log('Iniciando fix ultra-agresivo de inputs desde React...');
    
    const restaurarInputsDesdeReact = () => {
      const inputs = document.querySelectorAll('input, textarea, select');
      let processedCount = 0;
      
      inputs.forEach((input: any) => {
        // EXCLUIR inputs del login para evitar interferencia
        const isLoginInput = input.closest('.login-container') || 
                            input.closest('[class*="login"]') ||
                            input.type === 'password' ||
                            (input.placeholder && input.placeholder.toLowerCase().includes('usuario')) ||
                            (input.placeholder && input.placeholder.toLowerCase().includes('contraseña'));
        
        if (!isLoginInput && !input.disabled && input.getAttribute('data-disabled') !== 'true') {
          // Aplicar corrección agresiva
          const computedStyle = window.getComputedStyle(input);
          const needsFix = computedStyle.pointerEvents === 'none' || 
                         computedStyle.userSelect === 'none' ||
                         input.style.pointerEvents === 'none' ||
                         input.style.userSelect === 'none';
          
          if (needsFix) {
            // Aplicar estilos con !important
            input.style.setProperty('pointer-events', 'auto', 'important');
            input.style.setProperty('user-select', 'text', 'important');
            input.style.setProperty('-webkit-user-select', 'text', 'important');
            input.style.setProperty('background-color', 'white', 'important');
            input.style.setProperty('color', 'black', 'important');
            input.style.setProperty('border', '1px solid #ccc', 'important');
            input.style.setProperty('padding', '4px 8px', 'important');
            
            // Eliminar atributos problemáticos
            if (input.hasAttribute('readonly') && input.getAttribute('data-readonly') !== 'true') {
              input.removeAttribute('readonly');
            }
            processedCount++;
          }
        }
      });
      
      // LIMPIEZA AGRESIVA DE OVERLAYS PROBLEMÁTICOS DESDE REACT
      const eliminarOverlaysDesdeReact = () => {
        const problematicSelectors = [
          'div[class*="fixed"][class*="inset-0"][class*="bg-black"]',
          'div[class*="fixed inset-0"]',
          '.modal-overlay',
          '[role="dialog"] + div[class*="fixed"]',
          'div[style*="position: fixed"][style*="inset: 0"]'
        ];
        
        let overlaysRemoved = 0;
        
        problematicSelectors.forEach(selector => {
          const overlays = document.querySelectorAll(selector);
          overlays.forEach((overlay: any) => {
            // Verificar si es un overlay problemático (sin hijos visibles o modal cerrado)
            const hasVisibleChildren = Array.from(overlay.children).some((child: any) => {
              const style = window.getComputedStyle(child);
              return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            });
            
            // Si no tiene hijos visibles o el modal está cerrado, eliminarlo
            if (!hasVisibleChildren || overlay.children.length === 0) {
              console.log('React: Eliminando overlay problemático:', overlay.className || selector);
              overlay.remove();
              overlaysRemoved++;
            }
            
            // También verificar si el overlay tiene pointer-events que bloquean
            const computedStyle = window.getComputedStyle(overlay);
            if (computedStyle.pointerEvents === 'none' || 
                overlay.style.pointerEvents === 'none') {
              // Si tiene pointer-events: none, probablemente no está bloqueando
              return;
            }
            
            // Para overlays con alto z-index que pueden estar bloqueando
            const zIndex = parseInt(computedStyle.zIndex) || parseInt(overlay.style.zIndex);
            if (zIndex && zIndex > 10 && !hasVisibleChildren) {
              console.log('React: Eliminando overlay con alto z-index problemático:', zIndex);
              overlay.remove();
              overlaysRemoved++;
            }
          });
        });
        
        // Buscar overlays específicos de modales que se quedan abiertos
        const modalOverlays = document.querySelectorAll('div[onclick*="onClose"], div[onclick*="setShow"]');
        modalOverlays.forEach((overlay: any) => {
          const computedStyle = window.getComputedStyle(overlay);
          const hasModalContent = overlay.querySelector('[class*="modal"], [class*="dialog"], .bg-white, .bg-gray-100');
          
          // Si el overlay no tiene contenido modal visible, eliminarlo
          if (!hasModalContent && computedStyle.display !== 'none') {
            console.log('React: Eliminando overlay modal vacío:', overlay);
            overlay.remove();
            overlaysRemoved++;
          }
        });
        
        if (overlaysRemoved > 0) {
          console.log('React: Overlays eliminados:', overlaysRemoved);
        }
      };
      
      // Ejecutar limpieza de overlays desde React
      eliminarOverlaysDesdeReact();
      
      if (processedCount > 0) {
        console.log('React: Inputs procesados ultra-agresivamente:', processedCount);
      }
    };
    
    // Ejecutar cada 2 segundos desde React (más agresivo para overlays)
    const reactInterval = setInterval(restaurarInputsDesdeReact, 2000);
    
    // Ejecutar inmediatamente
    restaurarInputsDesdeReact();
    
    return () => clearInterval(reactInterval);
  }, []);

  const handleResetData = async () => {
    if (window.confirm('¿Está SEGURO que desea borrar TODOS los datos de la aplicación? Esta acción es irreversible y restaurará la aplicación a su estado inicial.')) {
        setIsLoading(true);
        try {
            await Promise.all(db.tables.map(table => table.clear()));
            // This is a special case that can't be synced via delta. It requires a full reset on all clients.
            // For now, we just reload the current client. Other clients will be out of sync until they reload.
            alert('Datos eliminados. La aplicación se recargará.');
            window.location.reload();
        } catch (error) {
            console.error("Failed to reset database", error);
            alert("Ocurrió un error al restaurar los datos.");
            setIsLoading(false);
        }
    }
  };

  const handleCleanInvalidDocuments = async () => {
    if (window.confirm('¿Desea limpiar documentos con datos corruptos? Esto puede solucionar errores de visualización.')) {
        try {
            const validTypes: DocumentType[] = ['invoice', 'quote', 'delivery-note', 'credit-note', 'debit-note', 'invoice-voided'];
            const allDocs = await db.saleDocuments.toArray();
            const invalidDocs = allDocs.filter(doc => !doc.type || !validTypes.includes(doc.type));
            
            if (invalidDocs.length > 0) {
                for (const doc of invalidDocs) {
                    await db.saleDocuments.delete(doc.id);
                }
                // Actualizar el estado
                setDocuments(prev => prev.filter(doc => doc.type && validTypes.includes(doc.type)));
                alert(`Se eliminaron ${invalidDocs.length} documentos con datos corruptos.`);
            } else {
                alert('No se encontraron documentos corruptos.');
            }
        } catch (error) {
            console.error("Error cleaning invalid documents:", error);
            alert("Error al limpiar documentos.");
        }
    }
  };

  const handleBackupData = async (isAuto: boolean = false) => {
    try {
        const backupData: { [key: string]: any } = {};
        await db.transaction('r', db.tables, async () => {
            const tableNames = db.tables.map(table => table.name);
            const dataPromises = tableNames.map(name => db.table(name).toArray());
            const allData = await Promise.all(dataPromises);
            
            tableNames.forEach((name, index) => {
                backupData[name] = allData[index];
            });
        });

        const fullBackup = {
            version: db.verno,
            exportDate: new Date().toISOString(),
            data: backupData,
            // Configuraciones adicionales no almacenadas en IndexedDB
            configuration: {
                theme: theme,
                customThemes: customThemes,
                backgroundImage: backgroundImage,
                companyLogo: companyLogo,
                afipConfig: afipConfig,
                emailConfig: emailConfig,
                companyInfo: companyInfo,
                kioskConfig: kioskConfig,
                autoBackupConfig: autoBackupConfig,
                dolarBlue: dolarBlue,
                syncEnabled: syncEnabled,
                geminiApiKey: geminiApiKey,
                openaiApiKey: openaiApiKey,
                openrouterApiKey: openrouterApiKey,
                openrouterModel: openrouterModel,
                huggingfaceApiKey: huggingfaceApiKey,
                huggingfaceModel: huggingfaceModel,
                huggingfaceUseV1: huggingfaceUseV1,
                huggingfaceBillTo: huggingfaceBillTo,
                aiProvider: aiProvider,
                aiFullAccess: aiFullAccess,
                caja: caja
            }
        };

        const jsonString = JSON.stringify(fullBackup, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        const now = new Date();
        const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
        
        // Para auto-backup, agregar hora y contador si es necesario
        let filename = `backup-pvplus-${date}`;
        if (isAuto) {
            const time = now.toTimeString().slice(0, 5).replace(':', '-'); // HH-MM
            filename = `backup-pvplus-${date}-${time}`;
        }
        
        a.href = url;
        a.download = `${filename}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        if (!isAuto) {
            alert('Copia de seguridad generada con éxito.');
        }

        // Actualizar tiempo del último backup
        if (isAuto) {
            const updatedConfig = { ...autoBackupConfig, lastBackupTime: Date.now() };
            await handleSaveAutoBackupConfig(updatedConfig);
        }

    } catch (error) {
        console.error("Failed to create backup", error);
        if (!isAuto) {
            alert("Ocurrió un error al generar la copia de seguridad. Revise la consola para más detalles.");
        }
    }
  };

    const handleRestoreData = async (file: File) => {
        if (!window.confirm('¿Está SEGURO que desea restaurar los datos desde este archivo? TODOS los datos actuales se borrarán y reemplazarán. Esta acción es irreversible.')) {
            return;
        }

        setIsLoading(true);
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                // FIX on line 574: Add a type guard to ensure fileContent is a string before passing it to JSON.parse, resolving a TypeScript error.
                const fileContent = event.target?.result;
                if (typeof fileContent === 'string') {
                    const json = JSON.parse(fileContent);
                    if (!json.data || !json.version) {
                        throw new Error("El archivo de backup no tiene el formato correcto.");
                    }

                    await db.transaction('rw', db.tables, async () => {
                        for (const table of db.tables) {
                            await table.clear();
                            if (json.data[table.name]) {
                                await table.bulkPut(json.data[table.name]);
                            }
                        }
                    });
                    
                    // Restaurar configuraciones adicionales si existen
                    if (json.configuration) {
                        const config = json.configuration;
                        
                        // Guardar configuraciones en IndexedDB
                        if (config.theme !== undefined) await db.appState.put({ key: 'theme', value: config.theme });
                        if (config.customThemes !== undefined) await db.appState.put({ key: 'customThemes', value: config.customThemes });
                        if (config.backgroundImage !== undefined) await db.appState.put({ key: 'backgroundImage', value: config.backgroundImage });
                        if (config.companyLogo !== undefined) await db.appState.put({ key: 'companyLogo', value: config.companyLogo });
                        if (config.afipConfig !== undefined) await db.appState.put({ key: 'afipConfig', value: config.afipConfig });
                        if (config.emailConfig !== undefined) await db.appState.put({ key: 'emailConfig', value: config.emailConfig });
                        if (config.companyInfo !== undefined) await db.appState.put({ key: 'companyInfo', value: config.companyInfo });
                        if (config.kioskConfig !== undefined) await db.appState.put({ key: 'kioskConfig', value: config.kioskConfig });
                        if (config.autoBackupConfig !== undefined) await db.appState.put({ key: 'autoBackupConfig', value: config.autoBackupConfig });
                        if (config.dolarBlue !== undefined) await db.appState.put({ key: 'dolarBlue', value: config.dolarBlue });
                        if (config.syncEnabled !== undefined) await db.appState.put({ key: 'syncEnabled', value: config.syncEnabled });
                        if (config.geminiApiKey !== undefined) await db.appState.put({ key: 'geminiApiKey', value: config.geminiApiKey });
                        if (config.openaiApiKey !== undefined) await db.appState.put({ key: 'openaiApiKey', value: config.openaiApiKey });
                        if (config.openrouterApiKey !== undefined) await db.appState.put({ key: 'openrouterApiKey', value: config.openrouterApiKey });
                        if (config.openrouterModel !== undefined) await db.appState.put({ key: 'openrouterModel', value: config.openrouterModel });
                        if (config.huggingfaceApiKey !== undefined) await db.appState.put({ key: 'huggingfaceApiKey', value: config.huggingfaceApiKey });
                        if (config.huggingfaceModel !== undefined) await db.appState.put({ key: 'huggingfaceModel', value: config.huggingfaceModel });
                        if (config.huggingfaceUseV1 !== undefined) await db.appState.put({ key: 'huggingfaceUseV1', value: config.huggingfaceUseV1 });
                        if (config.huggingfaceBillTo !== undefined) await db.appState.put({ key: 'huggingfaceBillTo', value: config.huggingfaceBillTo });
                        if (config.aiProvider !== undefined) await db.appState.put({ key: 'aiProvider', value: config.aiProvider });
                        if (config.aiFullAccess !== undefined) await db.appState.put({ key: 'aiFullAccess', value: config.aiFullAccess });
                        if (config.caja !== undefined) await db.appState.put({ key: 'caja', value: config.caja });
                    }
                    
                    // Similar to reset, this is a full state replacement that can't be delta-synced easily.
                    alert('Restauración completada con éxito. La aplicación se recargará.');
                    window.location.reload();
                } else {
                  throw new Error("File could not be read as text.");
                }
            } catch (error) {
                console.error("Error restaurando el backup:", error);
                alert(`Ocurrió un error durante la restauración: ${error instanceof Error ? error.message : 'Error desconocido'}`);
                setIsLoading(false);
            }
        };
        reader.onerror = () => {
             alert('No se pudo leer el archivo de backup.');
             setIsLoading(false);
        };
        reader.readAsText(file);
    };
    
  // SISTEMA DE PROTECCIÓN: Activar con clave
  const handleRegister = async (code: string): Promise<{ success: boolean; message: string }> => {
    try {
      const result = await HardwareProtection.activateSoftware(code);
      
      if (result.success) {
        setIsRegistered(true);
        const info = await HardwareProtection.getActivationInfo();
        setActivationInfo(info);
        addToast('✅ ' + result.message, 'success');
        
        // Iniciar validación periódica
        HardwareProtection.startPeriodicValidation(() => {
          console.log('⚠️ Validación periódica falló');
          setIsRegistered(false);
          addToast('La activación no es válida. Por favor, active nuevamente.', 'error');
        });
        
        return { success: true, message: result.message };
      } else {
        addToast('❌ ' + result.message, 'error');
        return { success: false, message: result.message };
      }
    } catch (error) {
      console.error('Error en activación:', error);
      const message = 'Error al activar el software';
      addToast(message, 'error');
      return { success: false, message };
    }
  };

  const handleBulkDeleteProducts = async (criteria: 'all' | 'marca' | 'proveedor', value?: string) => {
    // let productsToDeleteQuery; // not used
    let productsToDelete: Product[] = [];
    let count = 0;

    if (criteria === 'all') {
        productsToDelete = await db.products.toArray();
        count = productsToDelete.length;
        if (count === 0) { addToast('No hay artículos para borrar.', 'info'); return; }
        if (!window.confirm(`¿Está SEGURO de que desea borrar TODOS los ${count} artículos?`)) return;
    } else if (value) {
        productsToDelete = await db.products.where(criteria).equals(value).toArray();
        count = productsToDelete.length;
        if (count === 0) { addToast(`No se encontraron artículos para ${criteria} "${value}".`, 'info'); return; }
        if (!window.confirm(`¿Está SEGURO de que desea borrar los ${count} artículos para ${criteria} "${value}"?`)) return;
    } else {
        return;
    }

    try {
        const codesToDelete = productsToDelete.map(p => p.cod);
        await db.products.bulkDelete(codesToDelete);
        
        const remainingProducts = await db.products.toArray();
        setProducts(remainingProducts);
        // Send a single bulk update action for efficiency
        sendUpdate({ type: 'PRODUCTS_SET', payload: remainingProducts });
        addToast(`${count} artículo(s) borrado(s) con éxito.`, 'success');

    } catch (error) {
        console.error("Error during bulk delete:", error);
        addToast('Ocurrió un error al borrar los artículos.', 'error');
    }
};
    const handleLoginSuccess = (user: Vendedor) => {
        console.log('[LOGIN_SUCCESS] Usuario ingresando:', user.nombre, 'Cod:', user.cod);
        // Iniciar nueva ventana de sesión para este usuario
        lastVendorSwitchTimeRef.current = Date.now();
        setCurrentUser(user);
        // After login, default to no view selected
        setActiveView(null); 
        db.appState.put({ key: 'lastView', value: { view: null, reportType: null } });
    };
  
  const handleLogout = async () => {
    // Hacer backup antes de salir si está configurado
    if (autoBackupConfig.enabled && autoBackupConfig.backupOnExit) {
      addToast('Generando backup antes de salir...', 'info');
      await handleBackupData(true);
      addToast('Backup completado', 'success');
    }
    setCurrentUser(null);
    setActiveView(null);
  }

  const handleBulkUpdateProducts = async (updatedProducts: Product[]) => {
      await db.transaction('rw', db.products, async () => {
          await db.products.bulkPut(updatedProducts);
      });

      const updatedMap = new Map(updatedProducts.map(p => [p.cod, p]));
      setProducts(prev => prev.map(p => updatedMap.get(p.cod) || p));

      updatedProducts.forEach(p => sendUpdate({ type: 'PRODUCT_SAVE', payload: p }));

      addToast(`${updatedProducts.length} productos fueron actualizados.`, 'success');
  };

  const renderActiveView = () => {
    if (!activeView || !currentUser) return null;
    const quotes = documents.filter(d => d.type === 'quote');
    const deliveryNotes = documents.filter(d => d.type === 'delivery-note');
    const permissionKey = viewPermissionMap[activeView];
    if (permissionKey && !currentUser.permissions[permissionKey]) {
        return <div className="text-center p-10"><h2 className="text-xl font-bold text-red-600">Acceso Denegado</h2><p className="text-gray-600 mt-2">No tiene los permisos necesarios para ver esta sección.</p></div>;
    }
    switch (activeView) {
      case 'dashboard': return <DashboardView documents={documents} products={products} clients={clients} setView={handleSetView} currentUser={currentUser} backgroundImage={systemConfig.dashboardBackgroundImage} />;
      case 'ventas': return <VentasView addDocument={addDocument} quotes={quotes} deliveryNotes={deliveryNotes} products={products} clients={clients} vendedores={vendedores} currentUser={currentUser} generateAfipInvoice={handleGenerateAfipInvoice} kioskConfig={kioskConfig} companyInfo={companyInfo} afipConfig={afipConfig} companyLogo={companyLogo} onBulkUpdateProducts={handleBulkUpdateProducts} systemConfig={systemConfig} isActive={activeView === 'ventas'} />;
      case 'articulos': return <ArticulosView products={products} proveedores={proveedores} onSave={handleSaveProduct} onDelete={handleDeleteProduct} onSetProducts={handleSetProducts} geminiApiKey={geminiApiKey} marcas={marcas} familias={familias} onSaveMarca={handleSaveMarca} onDeleteMarca={handleDeleteMarca} onSaveFamilia={handleSaveFamilia} onDeleteFamilia={handleDeleteFamilia} onOpenPromociones={() => setActiveView('promociones')} />;
      case 'promociones': return <PromocionesView promociones={promociones} productos={products} onSave={handleSavePromociones} />;
      case 'clientes': return <ClientesView clients={clients} onSave={handleSaveClient} onDelete={handleDeleteClient} />;
    case 'compras': return <ComprasView addPurchase={addPurchase} products={products} proveedores={proveedores} purchases={purchaseDocuments} />;
      case 'proveedores': return <ProveedoresView proveedores={proveedores} onSave={handleSaveProveedor} onDelete={handleDeleteProveedor} />;
      case 'vendedores': return <VendedoresView vendedores={vendedores} onSave={handleSaveVendedor} onDelete={handleDeleteVendedor} />;
      case 'reportes': return <ReportesView documents={documents} updateDocument={updateDocument} afipConfig={afipConfig} products={products} companyLogo={companyLogo} companyInfo={companyInfo} generateAfipInvoice={handleGenerateAfipInvoice} currentUser={currentUser} voidDocument={handleVoidDocument} handleGenerateAfipNote={handleGenerateAfipNote} emailConfig={emailConfig} addToast={addToast} addDocument={addDocument} />;
        case 'administracion': return <AdministracionView onBgChange={handleBgChange} onThemeChange={handleThemeChange} activeTheme={theme} customThemes={customThemes} onSaveCustomTheme={handleSaveCustomTheme} onDeleteCustomTheme={handleDeleteCustomTheme} afipConfig={afipConfig} onSaveAfipConfig={handleSaveAfipConfig} emailConfig={emailConfig} onSaveEmailConfig={handleSaveEmailConfig} companyInfo={companyInfo} onSaveCompanyInfo={handleSaveCompanyInfo} kioskConfig={kioskConfig} onSaveKioskConfig={handleSaveKioskConfig} autoBackupConfig={autoBackupConfig} onSaveAutoBackupConfig={handleSaveAutoBackupConfig} controlCajaConfig={controlCajaConfig} onSaveControlCajaConfig={handleSaveControlCajaConfig} serverManagerConfig={serverManagerConfig} onSaveServerManagerConfig={handleSaveServerManagerConfig} networkConfig={networkConfig} onSaveNetworkConfig={handleSaveNetworkConfig} systemConfig={systemConfig} onSaveSystemConfig={handleSaveSystemConfig} onResetData={handleResetData} onCleanInvalidDocuments={handleCleanInvalidDocuments} onBackupData={handleBackupData} onRestoreData={handleRestoreData} companyLogo={companyLogo} onSaveCompanyLogo={handleSaveCompanyLogo} dashboardImage={dashboardImage} onSaveDashboardImage={handleSaveDashboardImage} syncStatus={syncStatus} syncEnabled={syncEnabled} onSaveSyncEnabled={handleSaveSyncEnabled} onManualSync={() => {}} dolarBlue={dolarBlue} onSaveDolarBlue={handleSaveDolarBlue} geminiApiKey={geminiApiKey} onSaveGeminiApiKey={handleSaveGeminiApiKey} openaiApiKey={openaiApiKey} onSaveOpenaiApiKey={handleSaveOpenaiApiKey} openrouterApiKey={openrouterApiKey} onSaveOpenrouterApiKey={handleSaveOpenrouterApiKey} openrouterModel={openrouterModel} onSaveOpenrouterModel={handleSaveOpenrouterModel} huggingfaceApiKey={huggingfaceApiKey} onSaveHuggingfaceApiKey={handleSaveHuggingfaceApiKey} huggingfaceModel={huggingfaceModel} onSaveHuggingfaceModel={handleSaveHuggingfaceModel} huggingfaceUseV1={huggingfaceUseV1} onSaveHuggingfaceUseV1={handleSaveHuggingfaceUseV1} huggingfaceBillTo={huggingfaceBillTo} onSaveHuggingfaceBillTo={handleSaveHuggingfaceBillTo} aiProvider={aiProvider} onSaveAiProvider={handleSaveAiProvider} aiFullAccess={aiFullAccess} onSaveAiFullAccess={handleSaveAiFullAccess} products={products} onBulkDeleteProducts={handleBulkDeleteProducts} marcas={marcas} familias={familias} proveedores={proveedores} onSaveMarca={(m) => handleSaveMarca(m, 'add')} onSaveFamilia={(f) => handleSaveFamilia(f, 'add')} onSaveProveedor={(p) => handleSaveProveedor(p, 'add')} activationInfo={activationInfo} hardwareId={hardwareId} onActivate={handleRegister} 
            // Sync delay UX
            syncCountdownSeconds={syncCountdownSeconds}
            canStartSync={canStartSync}
            onForceSyncConnect={handleForceSyncConnect}
        />;
      case 'cheques': return <ChequesView cheques={cheques} onSave={handleSaveCheque} onDelete={handleDeleteCheque} />;
      case 'caja': return <CajaView caja={caja} onAbrirCaja={handleAbrirCaja} onCerrarCaja={handleCerrarCaja} onSaveMovimiento={handleSaveMovimientoCaja} onEditMovimiento={handleEditMovimientoCaja} onDeleteMovimiento={handleDeleteMovimientoCaja} />;
      case 'controlcaja': return <ControlCajaView caja={caja} onAbrirCaja={handleAbrirCaja} onCerrarCaja={handleCerrarCaja} onAddMovimiento={handleAddMovimientoCaja} currentUser={currentUser} documents={documents} products={products} vendedores={vendedores} onClose={() => setActiveView('dashboard')} />;
            case 'servers': return <ServerManagerView onClose={() => setActiveView('dashboard')} networkConfig={networkConfig} serverManagerEnabled={serverManagerConfig.enabled} onToggleServerManager={handleToggleServerManager} syncStatus={syncStatus} syncEnabled={syncEnabled} onSaveSyncEnabled={handleSaveSyncEnabled} onManualSync={() => {}} 
                autoSyncMode={networkConfig.autoSyncMode || 'instant'}
                syncCountdownSeconds={syncCountdownSeconds}
                canStartSync={canStartSync}
                onForceSyncConnect={handleForceSyncConnect}
            />;
      case 'informes': return <InformesView reportType={reportType} products={products} documents={documents} setView={handleSetView} vendedores={vendedores} companyLogo={companyLogo} afipConfig={afipConfig} companyInfo={companyInfo} currentUser={currentUser} />;
      default: return null;
    }
  };
  
  if (isLoading) {
    return <div className="w-screen h-screen bg-slate-100"><LoadingSpinner /></div>;
  }
  
  // SISTEMA DE PROTECCIÓN: Verificar activación antes de login
  if (!isRegistered) {
    return <LoginScreen 
      onLoginSuccess={handleLoginSuccess} 
      onRegister={handleRegister} 
      isTrialExpired={true} 
      vendedores={vendedores} 
      backgroundImage={systemConfig.loginBackgroundImage}
      hardwareId={hardwareId}
    />;
  }
  
  // Login de usuario después de activación
  if (!currentUser) {
    return <LoginScreen 
      onLoginSuccess={handleLoginSuccess} 
      onRegister={handleRegister} 
      isTrialExpired={false} 
      vendedores={vendedores} 
      backgroundImage={systemConfig.loginBackgroundImage}
      hardwareId={hardwareId}
    />;
  }

  return (
    <div className="stockfacil-theme flex flex-col h-screen font-sans text-sm non-printable">
      {/* Toast Container */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-3">
        {toasts.map(toast => (
          <Toast key={toast.id} message={toast.message} type={toast.type} onClose={() => removeToast(toast.id)} />
        ))}
      </div>

      <AIAssistant
          documents={documents}
          purchases={purchaseDocuments}
          cheques={cheques}
          products={products}
          clients={clients}
          proveedores={proveedores}
          vendedores={vendedores}
          currentUser={currentUser}
          geminiApiKey={geminiApiKey}
          openaiApiKey={openaiApiKey}
          openrouterApiKey={openrouterApiKey}
          openrouterModel={openrouterModel}
          huggingfaceApiKey={huggingfaceApiKey}
          huggingfaceModel={huggingfaceModel}
          huggingfaceUseV1={huggingfaceUseV1}
          huggingfaceBillTo={huggingfaceBillTo}
          aiProvider={aiProvider}
          aiFullAccess={aiFullAccess}
          addDocument={addDocument}
          onBulkUpdateProducts={handleBulkUpdateProducts}
          onAddPurchase={addPurchase}
          onSaveCheque={(data) => handleSaveCheque(data)}
          onVoidInvoice={(doc) => handleVoidDocument(doc)}
      />

            <Header 
                setView={handleSetView} 
                onSelectReport={handleSelectReport} 
                currentUser={currentUser} 
                onLogout={handleLogout} 
                onSwitchUser={handleSwitchUser}
                controlCajaEnabled={controlCajaConfig.enabled} 
                serverManagerEnabled={serverManagerConfig.enabled} 
            />
            
            {/* Estado de conexión - Solo mostrar si no hay vista activa */}
            {!activeView && (
                <div className="p-4">
                    <ConnectionStatus />
                </div>
            )}
            
    <main className="flex-1 relative overflow-hidden p-4">
        
        <div className="absolute inset-0 flex items-center justify-center opacity-20 pointer-events-none">
            {dashboardImage ? (
              <img src={dashboardImage} alt="Dashboard" className="w-1/2 max-w-lg object-contain" />
            ) : (
              <StockFacilLogo className="w-1/2 max-w-lg text-white" />
            )}
        </div>
        
        {activeView && (
            <div className="sf-window absolute top-4 left-4 right-4 bottom-4 flex flex-col rounded-lg shadow-md overflow-hidden" style={{zIndex:5}}>
                <div className="sf-title-bar flex justify-between items-center">
                    <span>{viewTitles[activeView]}</span>
                    <button onClick={() => handleSetView(null)} className="text-white font-mono text-lg leading-none" title="Cerrar Ventana">X</button>
                </div>
                <div className="sf-window-content flex-1 overflow-y-auto bg-[rgb(var(--color-bg-primary))] relative z-10">
                  {renderActiveView()}
                </div>
            </div>
        )}
      </main>
      
      <footer style={{backgroundColor: 'var(--sf-bg-window)', color: 'var(--sf-text)'}} className="text-xs px-4 py-1 flex justify-between items-center non-printable border-t-2 border-[var(--sf-border-light)]">
        <span>{companyInfo.nombre || 'FX VENTAS'}</span>
        <div className="flex items-center gap-2">
            <span>Usuario:</span>
            <span className="font-semibold">{currentUser.nombre}</span>
        </div>
        <span>{new Date().toLocaleDateString('es-AR')}</span>
      </footer>
    </div>
  );
};

export default App;
