# CONEXIONES DE HARDWARE Y ENSAMBLAJE
## Sistema Tablero Anotador (ESP32)

Este documento detalla todas las conexiones necesarias para armar el Hardware de tu proyecto. Tienes dos componentes principales: El Mando (Transmisor) y el Receptor (Conectado a la TV y PC G4).

---

### 1. RECEPTOR_RX (El ESP32 que va en la TV/PC)

Este ESP32 va conectado por USB a la Notebook G4. La PC le da energía y se comunican por el puerto Serie.

| Pin ESP32 | Conexión / Componente | Descripción |
| :--- | :--- | :--- |
| **VIN / 5V** | USB de la PC G4 | Alimentación (se da automáticamente al conectar el cable USB a la PC). |
| **GND** | GND de todos los componentes | Tierra común. **IMPORTANTE:** Debe estar conectada al Pin 17 del HDMI. |
| **Pin 15** | Botón (Pulsador) -> GND | **Botón de SYNC manual.** Sirve para forzar el emparejamiento. |
| **Pin 2** | LED + Resistencia 220Ω -> GND | **LED de Estado SYNC.** Parpadea buscando mando, fijo cuando está conectado. |
| **Pin 4** | Relé (Módulo 5V) -> Bocina | **Salida de Bocina.** Activa un relé durante 2 segundos cuando recibe comando 6. |
| **Pin 13** | **Pin 13 del cable HDMI** | **Inyección HDMI-CEC.** Envía la orden universal de encendido a la TV. |

#### ¿Cómo inyectar el CEC en el HDMI?
Para no dañar el puerto de la PC ni de la TV, la forma correcta es:
1. Conseguir un **adaptador "HDMI Breakout"** (Male a Female) o pelar con mucho cuidado la goma de un extensor HDMI corto.
2. Localizar el cablecito que corresponde al **Pin 13 (CEC)** del HDMI y conectarlo directo al **Pin 13 de tu ESP32**.
3. Localizar el cablecito que corresponde al **Pin 17 (DDC/CEC Ground)** del HDMI y conectarlo a un **GND de tu ESP32**.
4. Listo. Ahora el ESP32 inyecta señales eléctricas en el bus CEC sin pasar por la tarjeta gráfica de la Netbook G4.

---

### 2. MANDO_TX (El ESP32 del árbitro/mesa)

Este es el control remoto. Se alimenta con una batería (o un PowerBank USB de 5V) y usa botones para enviar la información. 
*(Asegúrate de revisar el código fuente de tu mando_tx.ino para confirmar tus pines exactos, pero la estructura recomendada es:)*

| Pin ESP32 | Conexión / Componente | Descripción |
| :--- | :--- | :--- |
| **VIN / 5V** | Batería o USB | Alimentación del mando. |
| **GND** | GND de los botones | Tierra común para todos los pulsadores. |
| **Varios Pines** | Botones de Puntos/Faltas -> GND | Cada botón de "Local +1", "Visitante -1", etc., configurados con `INPUT_PULLUP`. |
| **Pin SYNC** | Botón de SYNC / Divorcio | Botón especial para emparejar con un receptor nuevo. |

---

### Notas de Instalación del Receptor en MX Linux
* En el sistema MX Linux de la PC G4, este ESP32 aparecerá como `/dev/ttyUSB0` (o `ttyACM0`).
* Cuando conectes a la corriente todo el sistema, el ESP32 se encenderá, mandará la señal CEC "Power On" y "Active Source" a la tele automáticamente, y la tele cambiará a la entrada HDMI.
