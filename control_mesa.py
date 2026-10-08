import serial
import time
import struct

# Configuración del puerto COM donde esté conectado el MANDO ESP32 en la 2da PC
# (Cambiar 'COM4' por el puerto real que asigne Windows a la placa ESP32 del Mando)
PUERTO_COM = 'COM4' 
BAUD_RATE = 115200

try:
    ser = serial.Serial(PUERTO_COM, BAUD_RATE, timeout=1)
    print(f"Conectado exitosamente a la Mesa de Control (Mando ESP32) en {PUERTO_COM}")
except Exception as e:
    print(f"No se pudo conectar al puerto {PUERTO_COM}. Error: {e}")
    exit()

def enviar_comando(cmd, team, player, value):
    """ Empaqueta y envía el protocolo exacto de 5 bytes """
    checksum = (cmd + team + player + value) & 0xFF
    # Usamos struct.pack para forzar que se envíen como bytes binarios puros 'B' (unsigned char)
    paquete = struct.pack('BBBBB', cmd, team, player, value, checksum)
    ser.write(paquete)
    print(f"Enviado -> CMD:{cmd} TEAM:{team} PLAYER:{player} VAL:{value}")

print("\n--- SISTEMA REMOTO DE MESA DE CONTROL ---")
print("Puedes ingresar comandos numéricos separados por espacio.")
print("Formato: [COMANDO] [EQUIPO] [JUGADOR] [VALOR]")
print("Ejemplo para Sumar 2 Puntos al Local (Jugador 4): 1 1 0 2")
print("Comandos disponibles: 1=Puntos, 2=Falta Personal, 3=Falta Equipo, 4=Reloj, 5=Periodo")
print("Equipos: 1=Local, 2=Visita\n")

while True:
    comando_str = input("MESA > ")
    if comando_str.lower() == 'salir':
        break
        
    partes = comando_str.strip().split()
    if len(partes) == 4:
        try:
            c = int(partes[0])
            t = int(partes[1])
            p = int(partes[2])
            v = int(partes[3])
            enviar_comando(c, t, p, v)
        except ValueError:
            print("Por favor, ingresa solo números.")
    else:
        print("Error: Debes ingresar exactamente 4 números. (Ej: 1 1 0 2)")
