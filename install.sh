#!/bin/bash

# ==========================================
# INSTALADOR AUTOMÁTICO - KIOSCO MONTMARTRE
# ==========================================

echo "=========================================="
echo " INICIANDO INSTALADOR KIOSCO MONTMARTRE "
echo "=========================================="

# 1. VERIFICACIÓN DE ARQUITECTURA
ARCH=$(uname -m)
if [ "$ARCH" != "x86_64" ] && [ "$ARCH" != "aarch64" ]; then
    echo ""
    echo "❌ ERROR FATAL: Arquitectura no soportada ($ARCH)."
    echo "Electron y Node.js modernos requieren un sistema operativo de 64 bits."
    echo "Si estás en una Netbook, asegúrate de instalar Debian amd64, NO i386 ni i686."
    echo "La instalación ha sido abortada."
    echo ""
    exit 1
fi
echo "✅ Arquitectura compatible ($ARCH) detectada."

# 2. ACTUALIZACIÓN E INSTALACIÓN DE PAQUETES
echo "Actualizando el sistema e instalando herramientas (esto puede tardar)..."
sudo apt update && sudo apt upgrade -y
sudo apt install -y xserver-xorg xinit openbox unclutter udiskie git curl build-essential x11-xserver-utils python3

# 3. INSTALACIÓN DE NODE.JS v20
echo "Instalando Node.js v20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 4. DESCARGA DEL PROYECTO
echo "Clonando el sistema de Tablero / Kiosco..."
cd ~
rm -rf tablero
git clone https://github.com/lheredi281/os-molmatrepc.git tablero
cd tablero
echo "Instalando dependencias de Node.js..."
npm install

# 5. CONFIGURACIÓN DE AUTO-ARRANQUE GRÁFICO (X11)
echo "Configurando entorno gráfico Openbox..."
echo 'if [ -z "${DISPLAY}" ] && [ "${XDG_VTNR}" -eq 1 ]; then' > ~/.bash_profile
echo '  exec startx -- -nocursor' >> ~/.bash_profile
echo 'fi' >> ~/.bash_profile
echo "exec openbox-session" > ~/.xinitrc

mkdir -p ~/.config/openbox
cat << 'EOF' > ~/.config/openbox/autostart
xset s off
xset s noblank
xset -dpms
udiskie &
cd ~/tablero
export DISPLAY=:0
npm start > ~/kiosco_error.log 2>&1 &
EOF

# 6. CONFIGURACIÓN DEL ACTUALIZADOR AUTOMÁTICO (CRON)
echo "Configurando actualizaciones automáticas..."
chmod +x ~/tablero/auto_update.sh
(crontab -l 2>/dev/null | grep -v "auto_update.sh"; echo "* * * * * ~/tablero/auto_update.sh >> ~/tablero/update.log 2>&1") | crontab -

# 7. CONFIGURACIÓN DE AUTOLOGIN (Debian Systemd)
echo "Configurando inicio de sesión automático para el usuario: $USER"
sudo mkdir -p /etc/systemd/system/getty@tty1.service.d
echo "[Service]" | sudo tee /etc/systemd/system/getty@tty1.service.d/override.conf > /dev/null
echo "ExecStart=" | sudo tee -a /etc/systemd/system/getty@tty1.service.d/override.conf > /dev/null
echo "ExecStart=-/sbin/agetty --autologin $USER --noclear %I \$TERM" | sudo tee -a /etc/systemd/system/getty@tty1.service.d/override.conf > /dev/null
sudo systemctl daemon-reload

echo "=========================================="
echo "✅ INSTALACIÓN COMPLETADA EXITOSAMENTE ✅"
echo "=========================================="
echo "El sistema se reiniciará en 5 segundos..."
sleep 5
sudo reboot
