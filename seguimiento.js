let map;
let marker;
let seguimientoActivo = false;

const IMEI = "6721085508150008"; // Usa el IMEI correcto

function initMap() {
  // Centra el mapa en Rafaela, Santa Fe, Argentina
  map = L.map('map').setView([-31.2608, -61.4751], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);
}

function actualizarUbicacion() {
  fetch(`/api/location/${IMEI}`)
    .then(res => res.json())
    .then(data => {
      console.log('Ubicación recibida:', data);
      if (data.lat && data.lng) {
        // Forzar hemisferio sur y oeste para Rafaela
        const lat = -Math.abs(data.lat);
        const lng = -Math.abs(data.lng);

        if (!marker) {
          marker = L.marker([lat, lng]).addTo(map)
            .bindPopup("Última ubicación GPS").openPopup();
        } else {
          marker.setLatLng([lat, lng]);
        }
        map.setView([lat, lng], 16);
      }
    })
    .catch(() => {
      // Silenciar error
    });
}

function iniciarSeguimiento() {
  if (!seguimientoActivo) {
    seguimientoActivo = true;
    actualizarUbicacion();
    setInterval(actualizarUbicacion, 5000); // Actualiza cada 5 segundos
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  document.getElementById('iniciarSeguimiento').onclick = iniciarSeguimiento;
  document.getElementById('volver').onclick = () => window.location.href = 'index.html';
});
