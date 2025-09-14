const express = require('express');
const net = require('net');
const path = require('path');
const { Pool } = require('pg');
const fs = require('fs');

const HTTP_PORT = 3001;
const TCP_PORT = 3010;
const app = express();

// Configuración de PostgreSQL
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'gps_transporte',
  password: 'tu_password_aqui', // Cambiar por tu password
  port: 5432,
});

// Crear tabla si no existe
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
`).catch(err => console.error('Error creando tabla:', err));

app.use(express.static(__dirname));

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

app.listen(HTTP_PORT, () => {
  console.log(`✅ Servidor HTTP disponible en http://localhost:${HTTP_PORT}`);
  console.log(`🗄️ Usando PostgreSQL como base de datos principal`);
});
