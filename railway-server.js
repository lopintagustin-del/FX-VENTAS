// railway-server.js - Servidor unificado para Railway
// Combina server.js + facturacion-server.js + email-server.js

const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const EmailService = require('./email-service');
const AfipService = require('./afip-service');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const prisma = new PrismaClient();

// Middlewares
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Instancia del servicio de email
const emailService = new EmailService();

// Configurar email desde variables de entorno
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    emailService.configure({
        user: process.env.EMAIL_USER,
        appPassword: process.env.EMAIL_PASS
    });
    console.log('✓ Servicio de email configurado');
}

// ==================== RUTAS PRINCIPALES ====================

// Health check
app.get('/', (req, res) => {
    res.json({ 
        message: 'FX Ventas POS - Railway API',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        database: 'PostgreSQL',
        services: ['API', 'AFIP', 'Email']
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// ==================== PRODUCTOS ====================

app.get('/api/products', async (req, res) => {
    try {
        const products = await prisma.product.findMany({
            orderBy: { name: 'asc' }
        });
        res.json({ success: true, data: products });
    } catch (error) {
        console.error('Error obteniendo productos:', error);
        res.status(500).json({ success: false, error: 'Error obteniendo productos' });
    }
});

app.post('/api/products', async (req, res) => {
    try {
        const product = await prisma.product.create({
            data: req.body
        });
        res.json({ success: true, data: product });
    } catch (error) {
        console.error('Error creando producto:', error);
        res.status(500).json({ success: false, error: 'Error creando producto' });
    }
});

app.put('/api/products/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const product = await prisma.product.update({
            where: { id },
            data: req.body
        });
        res.json({ success: true, data: product });
    } catch (error) {
        console.error('Error actualizando producto:', error);
        res.status(500).json({ success: false, error: 'Error actualizando producto' });
    }
});

app.delete('/api/products/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.product.delete({
            where: { id }
        });
        res.json({ success: true, message: 'Producto eliminado' });
    } catch (error) {
        console.error('Error eliminando producto:', error);
        res.status(500).json({ success: false, error: 'Error eliminando producto' });
    }
});

// ==================== CLIENTES ====================

app.get('/api/customers', async (req, res) => {
    try {
        const customers = await prisma.customer.findMany({
            orderBy: { name: 'asc' }
        });
        res.json({ success: true, data: customers });
    } catch (error) {
        console.error('Error obteniendo clientes:', error);
        res.status(500).json({ success: false, error: 'Error obteniendo clientes' });
    }
});

app.post('/api/customers', async (req, res) => {
    try {
        const customer = await prisma.customer.create({
            data: req.body
        });
        res.json({ success: true, data: customer });
    } catch (error) {
        console.error('Error creando cliente:', error);
        res.status(500).json({ success: false, error: 'Error creando cliente' });
    }
});

// ==================== VENTAS ====================

app.get('/api/sales', async (req, res) => {
    try {
        const sales = await prisma.sale.findMany({
            include: {
                customer: true,
                seller: true,
                items: {
                    include: {
                        product: true
                    }
                }
            },
            orderBy: { date: 'desc' },
            take: 100
        });
        res.json({ success: true, data: sales });
    } catch (error) {
        console.error('Error obteniendo ventas:', error);
        res.status(500).json({ success: false, error: 'Error obteniendo ventas' });
    }
});

app.post('/api/sales', async (req, res) => {
    try {
        const { items, ...saleData } = req.body;
        
        const sale = await prisma.sale.create({
            data: {
                ...saleData,
                items: {
                    create: items
                }
            },
            include: {
                items: {
                    include: {
                        product: true
                    }
                }
            }
        });
        
        res.json({ success: true, data: sale });
    } catch (error) {
        console.error('Error creando venta:', error);
        res.status(500).json({ success: false, error: 'Error creando venta' });
    }
});

// ==================== CONFIGURACIÓN AFIP ====================

app.post('/api/save-afip', async (req, res) => {
    try {
        const afipConfig = req.body;
        
        await prisma.appConfig.upsert({
            where: { key: 'afip' },
            update: { value: afipConfig },
            create: { key: 'afip', value: afipConfig }
        });
        
        res.json({ success: true, message: 'Configuración AFIP guardada' });
    } catch (error) {
        console.error('Error guardando config AFIP:', error);
        res.status(500).json({ success: false, error: 'Error guardando configuración AFIP' });
    }
});

app.get('/api/load-afip', async (req, res) => {
    try {
        const config = await prisma.appConfig.findUnique({
            where: { key: 'afip' }
        });
        
        if (config) {
            res.json({ success: true, config: config.value });
        } else {
            res.json({ success: false, config: null });
        }
    } catch (error) {
        console.error('Error cargando config AFIP:', error);
        res.status(500).json({ success: false, error: 'Error cargando configuración AFIP' });
    }
});

// ==================== FACTURACIÓN AFIP ====================

app.post('/consultar-puntos-venta', async (req, res) => {
    try {
        const { afipConfig } = req.body;
        
        if (!afipConfig || !afipConfig.cuit) {
            return res.status(400).json({ error: 'Faltan datos de configuración de AFIP' });
        }
        
        // Por ahora retornamos datos de prueba
        // Aquí iría la integración real con AFIP
        const puntosVenta = [
            { PtoVta: 1, EmisionTipo: "CAE", Bloqueado: "N", FchBaja: null },
            { PtoVta: 2, EmisionTipo: "CAE", Bloqueado: "N", FchBaja: null }
        ];
        
        res.json({ success: true, puntosVenta });
    } catch (error) {
        console.error('Error consultando puntos de venta:', error);
        res.status(500).json({ error: 'Error consultando puntos de venta AFIP' });
    }
});

// ==================== EMAIL ====================

app.post('/send-email', async (req, res) => {
    try {
        const { to, subject, html, attachments } = req.body;
        
        if (!emailService.isConfigured()) {
            return res.status(400).json({ 
                success: false, 
                error: 'Servicio de email no configurado' 
            });
        }
        
        const result = await emailService.sendEmail(to, subject, html, attachments);
        res.json(result);
    } catch (error) {
        console.error('Error enviando email:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Error enviando email' 
        });
    }
});

// ==================== DATOS GENERALES ====================

app.get('/api/get-data/:collection', async (req, res) => {
    try {
        const { collection } = req.params;
        let data = [];
        
        switch (collection) {
            case 'products':
                data = await prisma.product.findMany();
                break;
            case 'customers':
                data = await prisma.customer.findMany();
                break;
            case 'sales':
                data = await prisma.sale.findMany({ include: { items: true } });
                break;
            case 'suppliers':
                data = await prisma.supplier.findMany();
                break;
            case 'sellers':
                data = await prisma.seller.findMany();
                break;
            default:
                return res.status(400).json({ success: false, error: 'Colección no válida' });
        }
        
        res.json({ success: true, data, count: data.length });
    } catch (error) {
        console.error(`Error obteniendo datos de ${req.params.collection}:`, error);
        res.status(500).json({ success: false, error: 'Error obteniendo datos' });
    }
});

// ==================== INICIALIZACIÓN ====================

async function startServer() {
    try {
        // Conectar a la base de datos
        await prisma.$connect();
        console.log('✓ Conectado a PostgreSQL');
        
        // Iniciar servidor
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚂 Railway Server corriendo en puerto ${PORT}`);
            console.log(`📊 Dashboard: https://railway.app`);
            console.log(`🔗 API URL: https://tu-app.railway.app`);
        });
    } catch (error) {
        console.error('❌ Error iniciando servidor:', error);
        process.exit(1);
    }
}

// Manejar cierre limpio
process.on('SIGINT', async () => {
    console.log('🛑 Cerrando servidor...');
    await prisma.$disconnect();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🛑 Cerrando servidor...');
    await prisma.$disconnect();
    process.exit(0);
});

startServer();