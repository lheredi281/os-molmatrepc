#include <esp_now.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include <WebServer.h>
#include <Preferences.h>

#define BTN_SYNC 15           // Pin físico para botón SYNC en la TV
#define LED_SYNC_STATUS 2     
#define PIN_BOCINA 4          // Pin para el Relé de la Bocina Grande
#define PIN_CEC 13            // Pin para inyectar la señal HDMI-CEC

// Configuración Wi-Fi Punto de Acceso (SoftAP)
const char* AP_SSID = "TABLERO-MONTMARTRE";
const char* AP_PASS = "12345678"; // Mínimo 8 caracteres

WebServer server(80);
Preferences preferences;

unsigned long bocinaEndTime = 0;
uint8_t authorizedMandoMAC[6] = {0x68, 0x09, 0x47, 0x5E, 0xA9, 0xA4}; // MAC por defecto
bool isPairingMode = false;
unsigned long pairingStartTime = 0;

// ==========================================
// PÁGINA WEB DEL MANDO (TÁCTIL PARA CELULAR)
// ==========================================
const char INDEX_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Mando Tablero Montmartre</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; -webkit-user-select: none; touch-action: manipulation; }
  body { background: #0b0f19; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 10px; display: flex; flex-direction: column; min-height: 100vh; }
  .header { text-align: center; padding: 8px 0; font-size: 14px; font-weight: 900; letter-spacing: 2px; color: #38bdf8; text-transform: uppercase; border-bottom: 1px solid #1e293b; margin-bottom: 10px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; flex: 1; }
  .team-panel { background: #111827; border-radius: 12px; padding: 8px; display: flex; flex-direction: column; gap: 8px; border: 2px solid #1f2937; }
  .team-local { border-color: #0284c7; }
  .team-visita { border-color: #dc2626; }
  .team-title { text-align: center; font-size: 16px; font-weight: 900; letter-spacing: 2px; padding: 4px; border-radius: 6px; }
  .team-local .team-title { background: #0284c7; color: #fff; }
  .team-visita .team-title { background: #dc2626; color: #fff; }
  .btn-group { display: flex; flex-direction: column; gap: 6px; }
  .row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
  .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  
  button {
    border: none; border-radius: 8px; font-weight: 900; font-size: 16px; padding: 14px 4px; cursor: pointer; color: white; display: flex; align-items: center; justify-content: center; transition: transform 0.05s, opacity 0.1s; box-shadow: 0 4px 6px rgba(0,0,0,0.3);
  }
  button:active { transform: scale(0.95); opacity: 0.8; }
  
  .btn-pts-local { background: #0284c7; }
  .btn-pts-visita { background: #dc2626; }
  .btn-foul { background: #f59e0b; font-size: 13px; }
  .btn-sub { background: #374151; color: #9ca3af; font-size: 13px; }
  
  .center-panel { grid-column: span 2; background: #111827; border-radius: 12px; padding: 10px; border: 2px solid #374151; display: flex; flex-direction: column; gap: 10px; }
  .btn-clock { font-size: 22px; padding: 18px; border-radius: 10px; letter-spacing: 2px; }
  .btn-start { background: #10b981; }
  .btn-stop { background: #ef4444; }
  .btn-horn { background: #eab308; color: #000; font-size: 20px; font-weight: 900; }
  .btn-period { background: #6366f1; }
  .btn-preset { background: #1f2937; border: 1px solid #4b5563; font-size: 14px; }
  .status-indicator { text-align: center; font-size: 11px; color: #10b981; font-weight: bold; margin-top: 5px; }
</style>
</head>
<body>

<div class="header">TABLERO MONTMARTRE - MANDO WI-FI</div>

<div class="grid">
  <!-- LOCAL -->
  <div class="team-panel team-local">
    <div class="team-title">LOCAL</div>
    <div class="row-3">
      <button class="btn-pts-local" onclick="send(1,1,0,1)">+1</button>
      <button class="btn-pts-local" onclick="send(1,1,0,2)">+2</button>
      <button class="btn-pts-local" onclick="send(1,1,0,3)">+3</button>
    </div>
    <div class="row-2">
      <button class="btn-sub" onclick="send(1,1,0,255)">-1 PUNTO</button>
      <button class="btn-foul" onclick="send(3,1,0,1)">+ FALTA</button>
    </div>
    <button class="btn-sub" onclick="send(3,1,0,255)">- FALTA</button>
  </div>

  <!-- VISITA -->
  <div class="team-panel team-visita">
    <div class="team-title">VISITA</div>
    <div class="row-3">
      <button class="btn-pts-visita" onclick="send(1,2,0,1)">+1</button>
      <button class="btn-pts-visita" onclick="send(1,2,0,2)">+2</button>
      <button class="btn-pts-visita" onclick="send(1,2,0,3)">+3</button>
    </div>
    <div class="row-2">
      <button class="btn-sub" onclick="send(1,2,0,255)">-1 PUNTO</button>
      <button class="btn-foul" onclick="send(3,2,0,1)">+ FALTA</button>
    </div>
    <button class="btn-sub" onclick="send(3,2,0,255)">- FALTA</button>
  </div>

  <!-- CONTROL CENTRAL -->
  <div class="center-panel">
    <div class="row-2">
      <button class="btn-clock btn-start" onclick="send(4,0,0,0)">▶ START / STOP</button>
      <button class="btn-horn" onclick="send(6,0,0,0)">📢 BOCINA</button>
    </div>

    <div class="row-2">
      <button class="btn-period" onclick="send(5,0,0,1)">+1 PERIODO</button>
      <button class="btn-sub" onclick="send(5,0,0,255)">-1 PERIODO</button>
    </div>

    <div class="row-3">
      <button class="btn-preset" onclick="send(8,0,0,1)">+1 MIN</button>
      <button class="btn-preset" onclick="send(8,0,0,255)">-1 MIN</button>
      <button class="btn-preset" onclick="send(7,10,0,0)">10 MIN</button>
    </div>

    <div class="row-2">
      <button class="btn-preset" onclick="send(7,5,0,0)">5 MIN</button>
      <button class="btn-preset" style="background:#b91c1c;" onclick="if(confirm('¿Reiniciar Tablero a 0?')) send(9,0,0,0)">RESET A 0</button>
    </div>
  </div>
</div>

<div id="status" class="status-indicator">● CONECTADO AL TABLERO</div>

<script>
function send(c, t, p, v) {
  if (navigator.vibrate) navigator.vibrate(35);
  fetch('/cmd?c=' + c + '&t=' + t + '&p=' + p + '&v=' + v)
    .then(r => {
      document.getElementById('status').innerText = '● ORDEN ENVIADA';
      setTimeout(() => document.getElementById('status').innerText = '● CONECTADO AL TABLERO', 400);
    })
    .catch(e => {
      document.getElementById('status').innerText = '✕ ERROR DE CONEXION';
    });
}
</script>
</body>
</html>
)rawliteral";

// ==========================================
// MANEJADORES DE RUTAS WEB
// ==========================================
void handleRoot() {
  server.send_P(200, "text/html", INDEX_HTML);
}

void handleCmd() {
  if (server.hasArg("c")) {
    uint8_t c = server.arg("c").toInt();
    uint8_t t = server.hasArg("t") ? server.arg("t").toInt() : 0;
    uint8_t p = server.hasArg("p") ? server.arg("p").toInt() : 0;
    uint8_t v = server.hasArg("v") ? server.arg("v").toInt() : 0;
    uint8_t checksum = (c + t + p + v) & 0xFF;

    // Activar bocina física si el comando es 6
    if (c == 6) {
      digitalWrite(PIN_BOCINA, HIGH);
      bocinaEndTime = millis() + 2000;
    }

    // Inyectar el paquete crudo de 5 bytes por USB a la PC
    uint8_t packet[5] = {c, t, p, v, checksum};
    Serial.write(packet, 5);

    server.sendHeader("Connection", "close");
    server.send(200, "text/plain", "OK");
  } else {
    server.sendHeader("Connection", "close");
    server.send(400, "text/plain", "Bad Request");
  }
}

// ==========================================
// MANEJADOR ESP-NOW (PARA EL MANDO FÍSICO)
// ==========================================
#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0)
void onDataRecv(const esp_now_recv_info * info, const uint8_t *incomingData, int len) {
  const uint8_t * mac = info->src_addr;
#else
void onDataRecv(const uint8_t * mac, const uint8_t *incomingData, int len) {
#endif
  
  if (len == 5) {
    if (incomingData[0] == 6) {
      digitalWrite(PIN_BOCINA, HIGH);
      bocinaEndTime = millis() + 2000;
    }
    // Replicar hacia la PC
    Serial.write(incomingData, 5);
  }
}

void setup() {
  Serial.begin(115200);
  
  pinMode(BTN_SYNC, INPUT_PULLUP);
  pinMode(LED_SYNC_STATUS, OUTPUT);
  pinMode(PIN_BOCINA, OUTPUT);
  pinMode(PIN_CEC, OUTPUT);
  digitalWrite(PIN_BOCINA, LOW);
  digitalWrite(LED_SYNC_STATUS, HIGH);

  // Iniciar Wi-Fi en modo híbrido (Punto de Acceso + Estación para ESP-NOW)
  WiFi.mode(WIFI_AP_STA);
  
  // Configurar Red Wi-Fi propia en Canal 1
  WiFi.softAP(AP_SSID, AP_PASS, 1);
  
  // Forzar canal 1
  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(1, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(false);

  // Iniciar ESP-NOW para mantener compatibilidad con el mando de hardware
  if (esp_now_init() == ESP_OK) {
    esp_now_register_recv_cb(onDataRecv);
  }

  // Rutas Web
  server.on("/", handleRoot);
  server.on("/cmd", handleCmd);
  server.begin();

  Serial.println("\n========================================================");
  Serial.println("[RX] SERVIDOR WI-FI INICIADO CON EXITO");
  Serial.printf("[RX] Red Wi-Fi: %s | Contraseña: %s\n", AP_SSID, AP_PASS);
  Serial.printf("[RX] Dirección IP del Mando Web: http://%s/\n", WiFi.softAPIP().toString().c_str());
  Serial.println("[RX] Conecta tu celular a ese Wi-Fi y abre esa IP en el navegador.");
  Serial.println("========================================================\n");
}

void loop() {
  // Atender peticiones del celular por Wi-Fi
  server.handleClient();

  // Apagar Bocina automáticamente tras 2 segundos
  if (bocinaEndTime > 0 && millis() > bocinaEndTime) {
    digitalWrite(PIN_BOCINA, LOW);
    bocinaEndTime = 0;
  }

  // Si llegan datos desde la PC por USB Serial
  if (Serial.available() >= 5) {
    uint8_t buf[5];
    Serial.readBytes(buf, 5);
  }
}
