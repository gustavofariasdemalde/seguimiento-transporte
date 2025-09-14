
let map;
let marker;
let seguimientoActivo = false;

// Usa el IMEI correcto de tu GPS
const IMEI = "0352672108550815";

function initMap() {
  // Centra el mapa en Rafaela, Santa Fe, Argentina
  map = L.map('map').setView([-31.2608, -61.4751], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);
}

function actualizarUbicacion() {
  fetch(`/api/location/${IMEI}`)
    .then(res => {
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return res.json();
    })
    .then(data => {
      console.log('📍 Datos recibidos:', data);
      if (data.lat && data.lng && !isNaN(data.lat) && !isNaN(data.lng)) {
        if (!marker) {
          marker = L.marker([data.lat, data.lng]).addTo(map)
            .bindPopup(`LINEA 1 - COCHE 1<br>Última actualización: ${new Date(data.timestamp).toLocaleString()}`)
            .openPopup();
        } else {
          marker.setLatLng([data.lat, data.lng]);
          marker.setPopupContent(`LINEA 1 - COCHE 1<br>Última actualización: ${new Date(data.timestamp).toLocaleString()}`);
        }
        map.setView([data.lat, data.lng], 16);
        console.log(`✅ Ubicación actualizada: ${data.lat}, ${data.lng}`);
      } else {
        console.log('⚠️ Datos de ubicación inválidos:', data);
      }
    })
    .catch(error => {
      console.error('❌ Error al obtener ubicación:', error);
    });
}

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  actualizarUbicacion(); // Inicia el seguimiento automáticamente
  setInterval(actualizarUbicacion, 5000); // Actualiza cada 5 segundos
  document.getElementById('volver').onclick = () => window.location.href = 'menu.html';
});