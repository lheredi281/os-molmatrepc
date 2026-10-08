@echo off
echo ==========================================
echo    INICIANDO MESA DE CONTROL (MANDO)
echo ==========================================
echo El sistema detectara automaticamente el puerto USB de la placa ESP32.
echo.

set MODE=mando
set COMPORT=
npm start
