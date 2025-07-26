# GPS Transporte PPS

## Instrucciones para seguimiento en tiempo real con GT02A

### 1. Instalar dependencias

```bash
npm install
```

### 2. Iniciar el servidor

Esto levanta el backend HTTP (para la app web) y el servidor TCP (para el GPS):

```bash
node server.js
```

- HTTP (frontend/API): http://localhost:3001
- TCP (GT02A): puerto 3010

### 3. Exponer el puerto TCP con ngrok

Instala [ngrok](https://ngrok.com/) y ejecuta:

```bash
ngrok tcp 3010
```

Te dará una dirección tipo:

```
Forwarding tcp://0.tcp.sa.ngrok.io:12345 -> localhost:3010
```

### 4. Configurar el GT02A

Envía el siguiente SMS al GPS (reemplaza IP y puerto por los de ngrok):

```
adminip123456 0.tcp.sa.ngrok.io 12345
```

### 5. Ver la ubicación en el mapa

Abre `seguimiento.html` en tu navegador. Haz clic en "Iniciar Seguimiento". El marcador se actualizará automáticamente cada 5 segundos con la última ubicación recibida.

---

- El archivo `ubicaciones.json` guarda la última ubicación de cada IMEI.
- El backend decodifica el protocolo GT02A y responde con ACK.
- El frontend usa Leaflet para mostrar la ubicación en tiempo real. 