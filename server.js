
const express = require('express');
const net = require('net');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const HTTP_PORT = 3001;
const TCP_PORT = 3010;
const app = express();

// Inicializar base de datos SQLite
const db = new sqlite3.Database('ubicaciones.db');
db.run(`CREATE TABLE IF NOT EXISTS ubicaciones (
  imei TEXT PRIMARY KEY,
  lat REAL,
  lng REAL,
  timestamp TEXT
)`);

app.use(express.static(__dirname));

// Decodificar coordenadas del paquete del GPS
function decodeLatLng(latHex, lngHex, flagHex) {
  const latRaw = parseInt(latHex, 16);
  const lngRaw = parseInt(lngHex, 16);
  let lat = latRaw / 30000 / 60;
  let lng = lngRaw / 30000 / 60;
  // Fuerza el signo negativo para Argentina (hemisferio sur y oeste)
  lat = -Math.abs(lat);
  lng = -Math.abs(lng);
  return { lat, lng };
}

// Guardar ubicación en la base de datos
function guardarUbicacion(imei, lat, lng, timestamp) {
  db.run(
    `INSERT OR REPLACE INTO ubicaciones (imei, lat, lng, timestamp) VALUES (?, ?, ?, ?)`,
    [imei, lat, lng, timestamp]
  );
}

// Obtener ubicación por IMEI
function obtenerUbicacion(imei, callback) {
  db.get(
    `SELECT * FROM ubicaciones WHERE imei = ?`,
    [imei],
    (err, row) => callback(err, row)
  );
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

    // Verificar si es un paquete de localización (22 = ubicación GPS)
    if (hex.startsWith('7878') && hex.length >= 40) {
      const imei = socketIMEIs.get(socket);
      if (!imei) {
        console.log('⚠️ No IMEI asociado a este socket');
        return;
      }

      const latHex = hex.substring(22, 30);
      const lngHex = hex.substring(30, 38);
      const flagHex = hex.substring(38, 40);

      if (latHex.length !== 8 || lngHex.length !== 8 || flagHex.length !== 2) {
        console.log('❌ Paquete inválido de coordenadas');
        return;
      }

      const { lat, lng } = decodeLatLng(latHex, lngHex, flagHex);
      if (isNaN(lat) || isNaN(lng)) {
        console.log(`❌ Coordenadas inválidas: ${lat}, ${lng}`);
        return;
      }

      guardarUbicacion(imei, lat, lng, new Date().toISOString());

      console.log(`📍 Ubicación actualizada: ${imei} → ${lat}, ${lng}`);

      // ACK localización
      const ack = Buffer.from('787805010001d9dc0d0a', 'hex');
      socket.write(ack);
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
app.get('/ubicaciones', (req, res) => {
  db.all('SELECT * FROM ubicaciones', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Error en la base de datos' });
    // Devuelve un objeto con IMEI como clave
    const ubicaciones = {};
    rows.forEach(row => {
      ubicaciones[row.imei] = {
        imei: row.imei,
        lat: row.lat,
         lng: row.lng,
        timestamp: row.timestamp
      };
    });
    res.json(ubicaciones);
  });
});

app.get('/api/location/:imei', (req, res) => {
  const imei = req.params.imei;
  obtenerUbicacion(imei, (err, row) => {
    if (err || !row) {
      return res.status(404).json({ error: 'No se encontraron datos para este IMEI' });
    }
    res.json({
      lat: row.lat,
      lng: row.lng,
      timestamp: row.timestamp
    });
  });
});
app.listen(HTTP_PORT, () => {
  console.log(`✅ Servidor HTTP disponible en http://localhost:${HTTP_PORT}`);
});