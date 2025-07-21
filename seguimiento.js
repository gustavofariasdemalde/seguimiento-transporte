let map;
let marker;
const IMEI = '352672108550815'; // IMEI real proporcionado

function initMap() {
  map = L.map('map').setView([-31.2506, -61.4867], 13); // Rafaela, Santa Fe, Argentina
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);
}

function actualizarUbicacion() {
  fetch(`/api/location/${IMEI}`)
    .then(res => res.json())
    .then(data => {
      if (data.lat && data.lng) {
        if (!marker) {
          marker = L.marker([data.lat, data.lng]).addTo(map);
        } else {
          marker.setLatLng([data.lat, data.lng]);
        }
        map.setView([data.lat, data.lng], 15);
      } else {
        alert('No hay ubicación disponible.');
      }
    })
    .catch(() => alert('Error consultando ubicación.'));
}

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  document.getElementById('iniciarSeguimiento').onclick = actualizarUbicacion;
  document.getElementById('volver').onclick = () => window.location.href = 'index.html';
}); 