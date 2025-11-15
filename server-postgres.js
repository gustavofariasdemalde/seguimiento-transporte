const express = require('express');
const net = require('net');
const path = require('path');
const { Pool } = require('pg');
const fs = require('fs');
const cors = require('cors');
require('dotenv').config();

const HTTP_PORT = process.env.PORT || 3001;
const TCP_PORT = process.env.TCP_PORT || 3010;
const app = express();

// Habilitar CORS para permitir peticiones desde cualquier origen
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuración de PostgreSQL - soporta variables de entorno para Render.com y otros servicios
let poolConfig;
if (process.env.DATABASE_URL) {
  // Render.com y otros servicios usan DATABASE_URL
  poolConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  };
} else {
  // Configuración local
  poolConfig = {
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'gps_transporte',
    password: process.env.DB_PASSWORD || 'tu_password_aqui',
    port: process.env.DB_PORT || 5432,
  };
}

const pool = new Pool(poolConfig);

// Verificar conexión a PostgreSQL
pool.query('SELECT NOW()')
  .then(result => {
    console.log('✅ Conexión a PostgreSQL establecida:', result.rows[0].now);
  })
  .catch(err => {
    console.error('❌ Error conectando a PostgreSQL:', err.message);
    console.error('❌ Verifique que PostgreSQL esté corriendo y que la configuración sea correcta');
    console.error('❌ Detalles:', {
      user: pool.options.user,
      host: pool.options.host,
      database: pool.options.database,
      port: pool.options.port
    });
  });

// Crear tablas si no existen
pool.query(`
  CREATE TABLE IF NOT EXISTS ubicaciones (
    imei VARCHAR(20) PRIMARY KEY,
    lat DECIMAL(10, 8),
    lng DECIMAL(11, 8),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    linea VARCHAR(50),
    coche VARCHAR(50),
    velocidad INTEGER,
    direccion VARCHAR(20)
  )
`).catch(err => console.error('Error creando tabla ubicaciones:', err));

pool.query(`
  CREATE TABLE IF NOT EXISTS asignaciones (
    id SERIAL PRIMARY KEY,
    fecha DATE NOT NULL,
    linea VARCHAR(20) NOT NULL,
    servicio VARCHAR(20) NOT NULL,
    coche INTEGER NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`)
.then(() => console.log('✅ Tabla asignaciones creada/verificada'))
.catch(err => {
  console.error('❌ Error creando tabla asignaciones:', err);
  console.error('❌ Detalles:', err.message, err.code);
});

// Endpoint de prueba para verificar que el servidor esté funcionando
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Servidor funcionando correctamente',
    timestamp: new Date().toISOString()
  });
});

// Decodificar coordenadas del paquete del GPS
function decodeLatLng(latHex, lngHex, flagHex) {
  const latRaw = parseInt(latHex, 16);
  const lngRaw = parseInt(lngHex, 16);
  
  // Convertir a grados decimales (formato estándar GPS)
  let lat = latRaw / 30000 / 60;
  let lng = lngRaw / 30000 / 60;
  
  // Aplicar signo correcto basado en el flag
  const latFlag = parseInt(flagHex.substring(0, 1), 16);
  const lngFlag = parseInt(flagHex.substring(1, 2), 16);
  
  // Si el flag indica hemisferio sur/oeste, hacer negativo
  if (latFlag & 0x8) lat = -Math.abs(lat);
  if (lngFlag & 0x8) lng = -Math.abs(lng);
  
  console.log(`🔍 Debug coordenadas: latRaw=${latRaw}, lngRaw=${lngRaw}, lat=${lat}, lng=${lng}, flag=${flagHex}`);
  
  return { lat, lng };
}

// Guardar ubicación en PostgreSQL y JSON
async function guardarUbicacion(imei, lat, lng, timestamp) {
  try {
    // Guardar en PostgreSQL
    await pool.query(
      `INSERT INTO ubicaciones (imei, lat, lng, timestamp, linea, coche, velocidad, direccion) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (imei) 
       DO UPDATE SET lat = $2, lng = $3, timestamp = $4, velocidad = $7`,
      [imei, lat, lng, timestamp, "Línea 1", "Coche 1", Math.floor(Math.random() * 80) + 20, "Norte"]
    );

    // Insertar en histórico
    await pool.query(
      `INSERT INTO ubicaciones_historial (imei, lat, lng, timestamp, velocidad, direccion, linea, coche)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [imei, lat, lng, timestamp, Math.floor(Math.random() * 80) + 20, "Norte", "Línea 1", "Coche 1"]
    );

    // Guardar en JSON
    const jsonPath = path.join(__dirname, 'ubicaciones.json');
    let ubicaciones = {};
    
    // Leer archivo existente
    if (fs.existsSync(jsonPath)) {
      const data = fs.readFileSync(jsonPath, 'utf8');
      ubicaciones = JSON.parse(data);
    }

    // Actualizar datos
    ubicaciones[imei] = {
      imei: imei,
      lat: lat,
      lng: lng,
      timestamp: timestamp,
      linea: "Línea 1",
      coche: "Coche 1",
      velocidad: Math.floor(Math.random() * 80) + 20,
      direccion: "Norte"
    };

    // Escribir archivo actualizado
    fs.writeFileSync(jsonPath, JSON.stringify(ubicaciones, null, 2));
    console.log(`💾 Datos guardados en PostgreSQL y JSON para IMEI: ${imei}`);
  } catch (error) {
    console.error('❌ Error al guardar ubicación:', error);
  }
}

// Obtener ubicación por IMEI desde PostgreSQL
async function obtenerUbicacion(imei) {
  try {
    const result = await pool.query('SELECT * FROM ubicaciones WHERE imei = $1', [imei]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('❌ Error al obtener ubicación:', error);
    return null;
  }
}

// Mapa para asociar sockets con IMEI
const socketIMEIs = new Map();

// Servidor TCP para el GPS
const tcpServer = net.createServer((socket) => {
  console.log('📡 Nueva conexión TCP');

  socket.on('data', (data) => {
    const hex = data.toString('hex');
    console.log(`📨 Paquete recibido crudo (hex): ${hex}`);

    // Verificar si es un login (78 78 0D 01...)
    if (hex.startsWith('78780d01') && hex.length >= 24) {
      const imei = hex.substring(8, 24);
      socketIMEIs.set(socket, imei);
      console.log(`🔐 IMEI login: ${imei}`);
      // ACK login
      const ack = Buffer.from('787805010001d9dc0d0a', 'hex');
      socket.write(ack);
      return;
    }

    // Verificar si es un paquete de localización GPS
    if (hex.startsWith('7878') && hex.length >= 40) {
      const imei = socketIMEIs.get(socket);
      if (!imei) {
        console.log('⚠️ No IMEI asociado a este socket');
        return;
      }

      // Extraer información del paquete
      const protocolNumber = hex.substring(4, 6);
      const dataLength = parseInt(hex.substring(6, 8), 16);
      
      console.log(`📦 Protocolo: ${protocolNumber}, Longitud: ${dataLength}`);
      
      // Protocolo 22 = ubicación GPS
      if (protocolNumber === '22' && hex.length >= 40) {
        const latHex = hex.substring(22, 30);
        const lngHex = hex.substring(30, 38);
        const flagHex = hex.substring(38, 40);

        if (latHex.length !== 8 || lngHex.length !== 8 || flagHex.length !== 2) {
          console.log('❌ Paquete inválido de coordenadas');
          return;
        }

        const { lat, lng } = decodeLatLng(latHex, lngHex, flagHex);
        
        // Validar que las coordenadas estén en un rango razonable para Argentina
        if (isNaN(lat) || isNaN(lng) || lat < -60 || lat > 0 || lng < -80 || lng > -50) {
          console.log(`❌ Coordenadas fuera de rango: ${lat}, ${lng}`);
          return;
        }

        guardarUbicacion(imei, lat, lng, new Date().toISOString());
        console.log(`📍 Ubicación actualizada: ${imei} → ${lat}, ${lng}`);

        // ACK localización
        const ack = Buffer.from('787805010001d9dc0d0a', 'hex');
        socket.write(ack);
      } else {
        console.log(`📋 Otro tipo de paquete: ${protocolNumber}`);
      }
    }
  });

  socket.on('close', () => {
    console.log('🔌 Conexión cerrada');
    socketIMEIs.delete(socket);
  });

  socket.on('error', (err) => {
    console.error('❗ Error de socket:', err);
  });
});

tcpServer.listen(TCP_PORT, () => {
  console.log(`✅ Servidor TCP escuchando en el puerto ${TCP_PORT}`);
});

// Servidor HTTP para frontend
app.get('/ubicaciones', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM ubicaciones ORDER BY timestamp DESC');
    const ubicaciones = {};
    result.rows.forEach(row => {
      ubicaciones[row.imei] = {
        imei: row.imei,
        lat: row.lat,
        lng: row.lng,
        timestamp: row.timestamp,
        linea: row.linea,
        coche: row.coche,
        velocidad: row.velocidad,
        direccion: row.direccion
      };
    });
    res.json(ubicaciones);
  } catch (error) {
    console.error('❌ Error en endpoint /ubicaciones:', error);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

app.get('/api/location/:imei', async (req, res) => {
  const imei = req.params.imei;
  try {
    const row = await obtenerUbicacion(imei);
    if (!row) {
      return res.status(404).json({ error: 'No se encontraron datos para este IMEI' });
    }
    res.json({
      lat: row.lat,
      lng: row.lng,
      timestamp: row.timestamp
    });
  } catch (error) {
    console.error('❌ Error en endpoint /api/location:', error);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

// Endpoint para obtener datos del JSON
app.get('/api/ubicaciones-json', (req, res) => {
  try {
    const jsonPath = path.join(__dirname, 'ubicaciones.json');
    if (fs.existsSync(jsonPath)) {
      const data = fs.readFileSync(jsonPath, 'utf8');
      const ubicaciones = JSON.parse(data);
      res.json(ubicaciones);
    } else {
      res.json({});
    }
  } catch (error) {
    console.error('❌ Error al leer JSON:', error);
    res.status(500).json({ error: 'Error al leer datos JSON' });
  }
});

// Endpoint para obtener datos de velocidad
app.get('/api/velocidad', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT linea, coche, velocidad, timestamp 
      FROM ubicaciones 
      WHERE velocidad > 60 
      ORDER BY timestamp DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error en endpoint /api/velocidad:', error);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

// Endpoints para asignaciones
app.post('/api/asignaciones', async (req, res) => {
  try {
    console.log('📥 POST /api/asignaciones recibido');
    console.log('📦 Body recibido:', JSON.stringify(req.body, null, 2));
    
    const asignaciones = Array.isArray(req.body?.asignaciones) ? req.body.asignaciones : [];
    console.log(`📊 Número de asignaciones: ${asignaciones.length}`);
    
    if (asignaciones.length === 0) {
      console.log('⚠️ No se recibieron asignaciones');
      return res.status(400).json({ error: 'No se recibieron asignaciones' });
    }

    // Validar estructura de datos
    asignaciones.forEach((a, idx) => {
      if (!a.fecha || !a.linea || !a.servicio || a.coche === undefined) {
        console.error(`❌ Asignación ${idx} inválida:`, a);
      }
    });

    // Primero, eliminar asignaciones existentes para la misma fecha
    if (asignaciones.length > 0) {
      const fechaPrimera = asignaciones[0].fecha;
      console.log(`🗑️ Eliminando asignaciones existentes para fecha: ${fechaPrimera}`);
      const deleteResult = await pool.query(
        `DELETE FROM asignaciones WHERE fecha = $1`,
        [fechaPrimera]
      );
      console.log(`🗑️ Filas eliminadas: ${deleteResult.rowCount}`);
    }

    // Insertar en bloque (ahora sin duplicados porque eliminamos las anteriores)
    const values = [];
    const params = [];
    asignaciones.forEach((a, idx) => {
      const base = idx * 5;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
      
      // Asegurar formato correcto de fecha (DATE) y timestamp
      const fechaFormato = a.fecha || new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const timestampFormato = a.timestamp || new Date().toISOString(); // ISO string completo
      
      params.push(
        fechaFormato, 
        a.linea || '', 
        a.servicio || '', 
        parseInt(a.coche, 10), 
        timestampFormato
      );
      
      console.log(`📝 Asignación ${idx + 1}:`, {
        fecha: fechaFormato,
        linea: a.linea,
        servicio: a.servicio,
        coche: a.coche,
        timestamp: timestampFormato
      });
    });

    if (values.length > 0) {
      const insertQuery = `INSERT INTO asignaciones (fecha, linea, servicio, coche, timestamp) VALUES ${values.join(', ')}`;
      console.log('💾 Ejecutando INSERT con query:', insertQuery);
      console.log('📋 Parámetros:', params);
      
      try {
        const insertResult = await pool.query(insertQuery, params);
        console.log(`✅ Insertadas ${insertResult.rowCount || asignaciones.length} asignaciones correctamente`);
        
        // Verificar que se insertaron correctamente haciendo una consulta
        const verifyResult = await pool.query(
          `SELECT COUNT(*) as count FROM asignaciones WHERE fecha = $1`,
          [asignaciones[0].fecha]
        );
        console.log(`✅ Verificación: ${verifyResult.rows[0].count} asignaciones encontradas para la fecha`);
      } catch (insertError) {
        console.error('❌ Error al insertar:', insertError);
        throw insertError; // Re-lanzar para que se maneje en el catch principal
      }
    } else {
      console.warn('⚠️ No hay valores para insertar');
    }

    console.log('✅ POST /api/asignaciones exitoso');
    res.json({ ok: true, count: asignaciones.length });
  } catch (error) {
    console.error('❌ Error en POST /api/asignaciones:', error);
    console.error('❌ Stack trace:', error.stack);
    console.error('❌ Detalles:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint,
      constraint: error.constraint,
      table: error.table
    });
    
    // Asegurar que siempre se envíe una respuesta
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Error al guardar asignaciones',
        details: error.message,
        code: error.code,
        hint: error.hint || 'Verifique los logs del servidor para más detalles'
      });
    } else {
      console.error('❌ No se pudo enviar respuesta: headers ya enviados');
    }
  }
});

app.get('/api/asignaciones', async (req, res) => {
  try {
    const { fecha } = req.query;
    if (fecha) {
      const result = await pool.query(
        `SELECT fecha, linea, servicio, coche, timestamp FROM asignaciones WHERE fecha = $1 ORDER BY timestamp DESC`,
        [fecha]
      );
      return res.json(result.rows);
    }
    const result = await pool.query(
      `SELECT fecha, linea, servicio, coche, timestamp FROM asignaciones ORDER BY timestamp DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error en GET /api/asignaciones:', error);
    res.status(500).json({ error: 'Error al obtener asignaciones' });
  }
});

// Historial por IMEI y rango
app.get('/api/historial', async (req, res) => {
  try {
    const { imei, from, to } = req.query;
    if (!imei) {
      return res.status(400).json({ error: 'Parámetro imei es requerido' });
    }
    const clauses = ['imei = $1'];
    const params = [imei];
    let idx = 2;
    if (from) { clauses.push(`timestamp >= $${idx++}`); params.push(from); }
    if (to) { clauses.push(`timestamp <= $${idx++}`); params.push(to); }
    const sql = `SELECT imei, lat, lng, velocidad, direccion, linea, coche, timestamp 
                 FROM ubicaciones_historial 
                 WHERE ${clauses.join(' AND ')} 
                 ORDER BY timestamp ASC`;
    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error en GET /api/historial:', error);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// Manejo de rutas de API no encontradas (debe ir ANTES de express.static)
app.use('/api/*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint de API no encontrado',
    path: req.path,
    method: req.method
  });
});

// Servir archivos estáticos (HTML, CSS, JS) - debe ir DESPUÉS de las rutas de API
app.use(express.static(__dirname));

// Manejo de rutas generales no encontradas (404)
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'Endpoint de API no encontrado' });
  } else {
    res.status(404).send('Página no encontrada');
  }
});

app.listen(HTTP_PORT, () => {
  console.log(`✅ Servidor HTTP disponible en puerto ${HTTP_PORT}`);
  console.log(`🗄️ Usando PostgreSQL como base de datos principal`);
  if (process.env.DATABASE_URL) {
    console.log(`🌐 Configuración: Servicio en la nube (Render.com)`);
  } else {
    console.log(`💻 Configuración: Servidor local`);
  }
});
