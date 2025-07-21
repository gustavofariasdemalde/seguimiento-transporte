require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

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