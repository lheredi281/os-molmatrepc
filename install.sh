#!/bin/bash

# ==========================================
# INSTALADOR MÁGICO - KIOSCO MONTMARTRE
# ==========================================

# 1. VERIFICAR QUE SE EJECUTE COMO ROOT
if [ "$EUID" -ne 0 ]; then
  echo ""
  echo "❌ ERROR: Este instalador maestro debe correrse como Administrador Supremo (root)."
  echo "👉 Escribe 'su -', pon tu contraseña de root, y vuelve a pegar este comando."
  echo ""
  exit 1
fi

echo "=========================================="
echo " INICIANDO INSTALADOR KIOSCO MONTMARTRE "
echo "=========================================="

# 2. VERIFICACIÓN DE ARQUITECTURA
ARCH=$(uname -m)
if [ "$ARCH" != "x86_64" ] && [ "$ARCH" != "aarch64" ]; then
    echo "❌ ERROR FATAL: Arquitectura no soportada ($ARCH)."
    echo "Requiere 64-bits (amd64). Abortando..."
    exit 1
fi
echo "✅ Arquitectura compatible ($ARCH)."

# 3. PEDIR EL USUARIO OBJETIVO
echo ""
read -p "👉 Ingresa el nombre de tu usuario normal de la PC (ej. admin o chanca): " TARGET_USER

if ! id -u "$TARGET_USER" > /dev/null 2>&1; then
  echo "❌ El usuario '$TARGET_USER' no existe. Asegúrate de escribirlo bien."
  exit 1
fi

USER_HOME=$(eval echo ~$TARGET_USER)
echo "✅ Instalando todo en la cuenta de: $TARGET_USER ($USER_HOME)"
echo ""

# 4. INSTALACIÓN DE PAQUETES, SUDO Y SSH
echo "⏳ Actualizando sistema e instalando herramientas base (X11, SSH, Sudo)..."
apt update && apt upgrade -y
apt install -y xserver-xorg xinit openbox unclutter udiskie git curl build-essential x11-xserver-utils python3 sudo openssh-server

# Habilitar SSH y agregar usuario a sudoers
systemctl enable ssh
systemctl start ssh
usermod -aG sudo $TARGET_USER

# 5. INSTALACIÓN DE NODE.JS v20
echo "⏳ Instalando Node.js v20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 6. DESCARGA DEL PROYECTO (COMO EL USUARIO NORMAL)
echo "⏳ Descargando tu software desde GitHub..."
sudo -u $TARGET_USER bash -c "cd $USER_HOME && rm -rf tablero && git clone https://github.com/lheredi281/os-molmatrepc.git tablero && cd tablero && npm install"

# 7. CONFIGURACIÓN DE AUTO-ARRANQUE GRÁFICO (X11)
echo "⏳ Configurando el encendido automático en Modo Kiosco..."
sudo -u $TARGET_USER bash -c "echo 'if [ -z \"\${DISPLAY}\" ] && [ \"\${XDG_VTNR}\" -eq 1 ]; then' > $USER_HOME/.bash_profile"
sudo -u $TARGET_USER bash -c "echo '  exec startx -- -nocursor' >> $USER_HOME/.bash_profile"
sudo -u $TARGET_USER bash -c "echo 'fi' >> $USER_HOME/.bash_profile"
sudo -u $TARGET_USER bash -c "echo 'exec openbox-session' > $USER_HOME/.xinitrc"

sudo -u $TARGET_USER bash -c "mkdir -p $USER_HOME/.config/openbox"
sudo -u $TARGET_USER bash -c "cat << 'EOF' > $USER_HOME/.config/openbox/autostart
xset s off
xset s noblank
xset -dpms
udiskie &
cd $USER_HOME/tablero
export DISPLAY=:0
npm start > $USER_HOME/kiosco_error.log 2>&1 &
EOF"

# 8. CONFIGURACIÓN DEL ACTUALIZADOR AUTOMÁTICO (CRON)
echo "⏳ Activando actualizador invisible..."
chmod +x $USER_HOME/tablero/auto_update.sh
sudo -u $TARGET_USER bash -c "(crontab -l 2>/dev/null | grep -v \"auto_update.sh\"; echo \"* * * * * $USER_HOME/tablero/auto_update.sh >> $USER_HOME/tablero/update.log 2>&1\") | crontab -"

# 9. CONFIGURACIÓN DE AUTOLOGIN (Systemd)
echo "⏳ Configurando Autologin para que no pida contraseña al encender..."
mkdir -p /etc/systemd/system/getty@tty1.service.d
echo "[Service]" > /etc/systemd/system/getty@tty1.service.d/override.conf
echo "ExecStart=" >> /etc/systemd/system/getty@tty1.service.d/override.conf
echo "ExecStart=-/sbin/agetty --autologin $TARGET_USER --noclear %I \$TERM" >> /etc/systemd/system/getty@tty1.service.d/override.conf
systemctl daemon-reload

# 10. REPORTE FINAL
IP_ADDR=$(hostname -I | awk '{print $1}')

echo ""
echo "=========================================="
echo "✅ INSTALACIÓN COMPLETADA EXITOSAMENTE ✅"
echo "=========================================="
echo "🔌 SERVICIO SSH: Instalado y Activado."
echo "🌐 TU DIRECCIÓN IP ES: $IP_ADDR"
echo "👤 USUARIO SSH: $TARGET_USER"
echo "=========================================="
echo "La PC se reiniciará sola en 10 segundos..."
echo "¡Disfruta tu nuevo Tablero Montmartre!"
sleep 10
reboot
