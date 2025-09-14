-- Script para configurar la base de datos PostgreSQL para el sistema GPS
-- Ejecutar como usuario postgres o con permisos de superusuario

-- Crear base de datos
CREATE DATABASE gps_transporte;

-- Conectar a la base de datos
\c gps_transporte;

-- Crear tabla principal de ubicaciones
CREATE TABLE IF NOT EXISTS ubicaciones (
    imei VARCHAR(20) PRIMARY KEY,
    lat DECIMAL(10, 8) NOT NULL,
    lng DECIMAL(11, 8) NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    linea VARCHAR(50),
    coche VARCHAR(50),
    velocidad INTEGER,
    direccion VARCHAR(20)
);

-- Crear tabla de asignaciones de unidades
CREATE TABLE IF NOT EXISTS asignaciones (
    id SERIAL PRIMARY KEY,
    fecha DATE NOT NULL,
    linea VARCHAR(10) NOT NULL,
    servicio VARCHAR(20) NOT NULL,
    coche INTEGER NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crear tabla de eventos de velocidad
CREATE TABLE IF NOT EXISTS eventos_velocidad (
    id SERIAL PRIMARY KEY,
    imei VARCHAR(20) NOT NULL,
    velocidad INTEGER NOT NULL,
    lat DECIMAL(10, 8),
    lng DECIMAL(11, 8),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (imei) REFERENCES ubicaciones(imei)
);

-- Crear índices para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_ubicaciones_timestamp ON ubicaciones(timestamp);
CREATE INDEX IF NOT EXISTS idx_ubicaciones_linea ON ubicaciones(linea);
CREATE INDEX IF NOT EXISTS idx_asignaciones_fecha ON asignaciones(fecha);
CREATE INDEX IF NOT EXISTS idx_eventos_velocidad_timestamp ON eventos_velocidad(timestamp);

-- Insertar datos de ejemplo
INSERT INTO ubicaciones (imei, lat, lng, linea, coche, velocidad, direccion) 
VALUES ('0352672108550815', -31.2608, -61.4751, 'Línea 1', 'Coche 1', 45, 'Norte')
ON CONFLICT (imei) DO NOTHING;

-- Crear usuario específico para la aplicación (opcional)
-- CREATE USER gps_user WITH PASSWORD 'gps_password';
-- GRANT ALL PRIVILEGES ON DATABASE gps_transporte TO gps_user;
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO gps_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO gps_user;
