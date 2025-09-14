# Configuración de PostgreSQL para el Sistema GPS

## Instalación de PostgreSQL

### Windows
1. Descargar PostgreSQL desde: https://www.postgresql.org/download/windows/
2. Instalar con las opciones por defecto
3. Recordar la contraseña del usuario `postgres`

### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
```

### macOS
```bash
brew install postgresql
brew services start postgresql
```

## Configuración de la Base de Datos

1. **Conectar a PostgreSQL:**
   ```bash
   sudo -u postgres psql
   ```

2. **Ejecutar el script de configuración:**
   ```bash
   sudo -u postgres psql -f database-setup.sql
   ```

3. **Verificar la instalación:**
   ```bash
   sudo -u postgres psql -d gps_transporte -c "\dt"
   ```

## Configuración del Servidor

1. **Instalar dependencias:**
   ```bash
   npm install
   ```

2. **Configurar la conexión en `server-postgres.js`:**
   ```javascript
   const pool = new Pool({
     user: 'postgres',           // Usuario de PostgreSQL
     host: 'localhost',          // Host de la base de datos
     database: 'gps_transporte', // Nombre de la base de datos
     password: 'tu_password',    // Contraseña del usuario postgres
     port: 5432,                 // Puerto de PostgreSQL
   });
   ```

3. **Ejecutar el servidor con PostgreSQL:**
   ```bash
   npm run start:postgres
   ```

## Migración de Datos desde SQLite

Si tienes datos existentes en SQLite que quieres migrar:

1. **Exportar datos de SQLite:**
   ```bash
   sqlite3 ubicaciones.db ".dump" > backup.sql
   ```

2. **Convertir el formato SQLite a PostgreSQL:**
   - Cambiar `INTEGER PRIMARY KEY` por `SERIAL PRIMARY KEY`
   - Cambiar `REAL` por `DECIMAL`
   - Ajustar tipos de datos según sea necesario

3. **Importar a PostgreSQL:**
   ```bash
   sudo -u postgres psql -d gps_transporte -f converted_backup.sql
   ```

## Ventajas de PostgreSQL sobre SQLite

- **Concurrencia:** Múltiples usuarios pueden acceder simultáneamente
- **Escalabilidad:** Mejor rendimiento con grandes volúmenes de datos
- **Características avanzadas:** Índices, vistas, procedimientos almacenados
- **Integridad:** Mejor control de transacciones y consistencia
- **Backup:** Herramientas robustas de respaldo y recuperación

## Comandos Útiles

```bash
# Conectar a la base de datos
sudo -u postgres psql -d gps_transporte

# Ver tablas
\dt

# Ver estructura de una tabla
\d ubicaciones

# Ver datos
SELECT * FROM ubicaciones;

# Hacer backup
pg_dump -U postgres gps_transporte > backup.sql

# Restaurar backup
psql -U postgres gps_transporte < backup.sql
```

## Solución de Problemas

### Error de conexión
- Verificar que PostgreSQL esté ejecutándose: `sudo systemctl status postgresql`
- Verificar la contraseña en la configuración
- Verificar que el puerto 5432 esté abierto

### Error de permisos
- Asegurarse de que el usuario tenga permisos en la base de datos
- Verificar la configuración de `pg_hba.conf`

### Error de base de datos no encontrada
- Ejecutar el script `database-setup.sql` para crear la base de datos
- Verificar el nombre de la base de datos en la configuración
