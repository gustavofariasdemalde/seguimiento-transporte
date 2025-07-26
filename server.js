require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const net = require('net');

const app = express();
app.use(cors());
app.use(express.json());

const UBICACIONES_FILE = path.join(__dirname, 'ubicaciones.json');

// Leer ubicaciones desde archivo
function leerUbicaciones() {
  try {
    if (!fs.existsSync(UBICACIONES_FILE)) return {};
    const data = fs.readFileSync(UBICACIONES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
}

// Guardar ubicaciones en archivo
function guardarUbicaciones(ubicaciones) {
  fs.writeFileSync(UBICACIONES_FILE, JSON.stringify(ubicaciones, null, 2));
}

// --- DECODIFICADOR GT02A ---
const socketIMEIs = new Map();

function decodeIMEI(hex) {
  let imei = '';
  for (let i = 0; i < hex.length; i += 2) {
    imei += hex[i] + hex[i + 1];
  }
  return imei.replace(/^0+/, '');
}
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



// --- SERVIDOR TCP PARA GT02A ---
const TCP_PORT = 3010; // Puerto TCP diferente para evitar conflicto con HTTP
const tcpServer = net.createServer(socket => {
  socket.on('data', data => {
    const hex = data.toString('hex');
    console.log(`📨 Paquete recibido crudo (hex): ${hex}`);

    // Paquete de login: 78780d0103XXXXXXXXXXXXXX0008xxxx0d0a
    if (hex.startsWith('78780d01')) {
      const imeiHex = hex.substring(12, 28); // 8+4=12, 12+16=28
      const imei = decodeIMEI(imeiHex);
      socketIMEIs.set(socket, imei);
      console.log('IMEI login:', imei);
      // ACK login
      const ack = Buffer.from('787805010001d9dc0d0a', 'hex');
      socket.write(ack);
      return;
    }

    // Paquete de localización: 7878...
    if (hex.startsWith('7878')) {
      const imei = socketIMEIs.get(socket);
      if (!imei) {
        console.log('No IMEI asociado a este socket');
        return;
      }
      const latHex = hex.substring(22, 30);
      const lngHex = hex.substring(30, 38);
      const flagHex = hex.substring(38, 40);
      const { lat, lng } = decodeLatLng(latHex, lngHex, flagHex);
      const ubicaciones = leerUbicaciones();
      ubicaciones[imei] = { imei, lat, lng, timestamp: new Date().toISOString() };
      guardarUbicaciones(ubicaciones);
      console.log(`📍 Ubicación actualizada: ${imei} → ${lat}, ${lng}`);
      // ACK localización
      const ack = Buffer.from('787805010001d9dc0d0a', 'hex');
      socket.write(ack);
    }
  });
  socket.on('error', err => {
    console.error('Socket error:', err.message);
  });
  socket.on('close', () => {
    socketIMEIs.delete(socket);
  });
});
tcpServer.listen(TCP_PORT, () => {
  console.log(`📡 Servidor TCP GT02A escuchando en puerto ${TCP_PORT}`);
});

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, '')));

// Endpoint para recibir datos GPS
app.post('/api/location', (req, res) => {
  const { imei, lat, lng } = req.body;
  if (!imei || !lat || !lng) {
    return res.status(400).json({ error: 'Faltan datos' });
  }
  const ubicaciones = leerUbicaciones();
  ubicaciones[imei] = { imei, lat, lng, timestamp: new Date().toISOString() };
  guardarUbicaciones(ubicaciones);
  res.status(201).json({ message: 'Ubicación guardada' });
});

// Endpoint para obtener la última ubicación por IMEI
app.get('/api/location/:imei', (req, res) => {
  const { imei } = req.params;
  const ubicaciones = leerUbicaciones();
  const ubicacion = ubicaciones[imei];
  if (!ubicacion) return res.status(404).json({ error: 'No encontrado' });
  res.json(ubicacion);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));