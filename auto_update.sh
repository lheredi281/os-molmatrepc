#!/bin/bash
# Script de Auto-Actualización (Estilo Vercel)
# Busca cambios en GitHub y reinicia la pantalla si hay código nuevo

cd /home/chanca/tablero

# Buscar actualizaciones en la nube sin descargarlas aún
git fetch origin main

# Comparar versión local con la nube
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" != "$REMOTE" ]; then
    echo "NUEVA VERSIÓN DETECTADA. Actualizando el sistema..."
    
    # 1. Descartar cualquier cambio local (como el sed del package.json)
    git reset --hard origin/main
    
    # 2. Descargar el nuevo código
    git pull origin main
    
    # 3. Instalar nuevas librerías (si agregaste alguna)
    npm install
    
    # 4. Volver a inyectar el modo sin-sandbox para Linux
    sed -i 's/"electron ."/"electron . --no-sandbox"/g' package.json
    
    # 5. Reiniciar la interfaz gráfica matando el servidor X (el autologin lo volverá a levantar)
    sudo pkill X
else
    echo "El sistema ya está en la última versión."
fi
