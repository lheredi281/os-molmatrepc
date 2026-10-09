#include <esp_now.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include <Preferences.h>

// --- LIBRERÍA CEC ---
// NOTA: Para que el protocolo HDMI-CEC funcione, debes instalar una librería en tu Arduino IDE.
// Busca "CEC" o "HDMI-CEC" en el Gestor de Librerías (por ejemplo, la de "Thomas Barth" o "arduino-cec").
// Descomenta las siguientes dos líneas cuando la instales:
// #include "CEC_Device.h"
// CEC_Device cec(13); // Pin 13 es el que conectaremos al Pin 13 del HDMI

#define BTN_SYNC 15           // Pin físico para botón SYNC en la TV
#define LED_SYNC_STATUS 2     
#define PIN_BOCINA 4          // Pin para el Relé de la Bocina Grande
#define PIN_CEC 13            // Pin para inyectar la señal HDMI-CEC

unsigned long bocinaEndTime = 0;

Preferences preferences;

uint8_t authorizedMandoMAC[6] = {0,0,0,0,0,0};
bool isPairingMode = false;
unsigned long pairingStartTime = 0;

// ==========================================
// FUNCION PARA ENCENDER LA TV POR HDMI-CEC
// ==========================================
void encenderTV_CEC() {
  Serial.println("Enviando orden HDMI-CEC para encender TV y poner HDMI...");
  
  // Descomenta esto cuando tengas la librería instalada:
  /*
  // 1. Despertar la TV (Image View On)
  cec.TransmitFrame(0x0F, 0x04); // 0F = Broadcast, 04 = Image View On
  delay(100);
  // 2. Decirle a la TV que somos la fuente activa (Active Source)
  // Dependiendo de tu dispositivo lógico (Playback 1, etc)
  cec.TransmitFrame(0x0F, 0x82, 0x10, 0x00); // 82 = Active Source, 1000 = Physical Address (HDMI 1)
  */
  
  Serial.println("Orden CEC enviada.");
}

void resetTablero() {
  Serial.println("Borrando memoria local...");
  preferences.begin("anotador", false);
  preferences.clear();
  preferences.end();
  
  if (esp_now_is_peer_exist(authorizedMandoMAC)) {
    esp_now_del_peer(authorizedMandoMAC);
  }
  
  memset(authorizedMandoMAC, 0, 6);
  digitalWrite(LED_SYNC_STATUS, LOW); // Vuelvo a estado virgen
}

void onDataRecv(const esp_now_recv_info * info, const uint8_t *incomingData, int len) {
  const uint8_t * mac = info->src_addr;
  
  // 1. MODO EMPAREJAMIENTO
  if (isPairingMode) {
    if (len == 5 && incomingData[0] == 0x99) {
      memcpy(authorizedMandoMAC, mac, 6);
      
      preferences.begin("anotador", false);
      preferences.putBytes("tx_mac", authorizedMandoMAC, 6);
      preferences.end();
      
      // Registrar al Mando como peer para poder responderle en privado
      esp_now_peer_info_t peerInfo = {};
      memcpy(peerInfo.peer_addr, authorizedMandoMAC, 6);
      peerInfo.channel = 1;
      peerInfo.encrypt = false;
      if (!esp_now_is_peer_exist(authorizedMandoMAC)) {
        esp_now_add_peer(&peerInfo);
      }

      // Responder con 0x98 (ACK de Emparejamiento) para que el Mando nos agende en su array
      uint8_t ackData[5] = {0x98, 0, 0, 0, 0x98};
      esp_now_send(authorizedMandoMAC, ackData, 5);

      isPairingMode = false;
      digitalWrite(LED_SYNC_STATUS, HIGH);
      Serial.println("¡Sincronizado! Solo escucharé a este Mando y le avisé que existo.");
    }
    return;
  }

  // 2. MODO JUEGO
  // Permitimos si viene del Mando Autorizado, O si es un paquete de 24s (cmd = 10) de cualquier placa
  bool isFromMando = (memcmp(mac, authorizedMandoMAC, 6) == 0);
  if (!isFromMando && incomingData[0] != 10) return;
  
  if (len == 5) {
    // ¿El mando nos acaba de enviar la "Bomba de Divorcio"?
    if (incomingData[0] == 0x9A) {
      Serial.println("¡Bomba de Divorcio recibida!");
      resetTablero();
      return;
    }

    // Activar Bocina Física si el Mando manda comando 6
    if (incomingData[0] == 6) {
      digitalWrite(PIN_BOCINA, HIGH);
      bocinaEndTime = millis() + 2000; // Sonar por 2 segundos
    }

    // Es un dato de partido normal. Lo pasamos crudo por USB a la PC
    Serial.write(incomingData, 5); 
  }
}

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  
  // Forzar Canal Wi-Fi 1
  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(1, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(false);

  pinMode(BTN_SYNC, INPUT_PULLUP);
  pinMode(LED_SYNC_STATUS, OUTPUT);
  pinMode(PIN_BOCINA, OUTPUT);
  pinMode(PIN_CEC, OUTPUT); // Pin para el cable CEC

  digitalWrite(PIN_BOCINA, LOW);

  // --- Inicializar CEC ---
  // cec.Initialize(CEC_LogicalDevice::CD_PLAYBACK_DEVICE_1);
  
  // ¡DISPARAR CEC AL ENCENDER!
  // Cuando la placa recibe energía de la PC, enciende la TV automáticamente
  encenderTV_CEC();

  if (esp_now_init() != ESP_OK) return;
  esp_now_register_recv_cb(onDataRecv);

  // Cargar Mando Autorizado
  preferences.begin("anotador", false);
  size_t macLen = preferences.getBytes("tx_mac", authorizedMandoMAC, 6);
  preferences.end();

  if (macLen == 6 && (authorizedMandoMAC[0] != 0 || authorizedMandoMAC[1] != 0)) {
    digitalWrite(LED_SYNC_STATUS, HIGH); 
    
    // Lo registramos como Peer por si en el futuro la TV quiere enviarle algo
    esp_now_peer_info_t peerInfo = {};
    memcpy(peerInfo.peer_addr, authorizedMandoMAC, 6);
    peerInfo.channel = 1;
    peerInfo.encrypt = false;
    esp_now_add_peer(&peerInfo);
  } else {
    digitalWrite(LED_SYNC_STATUS, LOW); 
  }
}

void loop() {
  // CHEQUEAR BOTÓN SYNC (Manual en el Tablero físico)
  if (digitalRead(BTN_SYNC) == LOW) {
    delay(3000); 
    if (digitalRead(BTN_SYNC) == LOW) {
      Serial.println("Tablero en Modo SYNC (Físico). Esperando grito del Mando...");
      isPairingMode = true;
      pairingStartTime = millis();
      resetTablero();
    }
  }

  // CHEQUEAR COMANDOS VÍA USB (Desde la PC TV)
  if (Serial.available() >= 5) {
    uint8_t buffer[5];
    Serial.readBytes(buffer, 5);
    
    if (buffer[0] == 155) { // 155 = FORZAR SYNC MODO
      Serial.println("Tablero en Modo SYNC (USB). Esperando grito del Mando...");
      isPairingMode = true;
      pairingStartTime = millis();
      resetTablero();
    } 
    else if (buffer[0] == 156) { // 156 = NUEVO COMANDO: FORZAR ENCENDIDO CEC MANUALMENTE
      Serial.println("Comando desde PC: Encendiendo TV por HDMI-CEC...");
      encenderTV_CEC();
    }
  }

  if (isPairingMode) {
    digitalWrite(LED_SYNC_STATUS, (millis() / 200) % 2); 
    if (millis() - pairingStartTime > 15000) {
      isPairingMode = false;
      digitalWrite(LED_SYNC_STATUS, LOW); 
    }
  }

  // APAGAR BOCINA AUTOMÁTICAMENTE
  if (bocinaEndTime > 0 && millis() > bocinaEndTime) {
    digitalWrite(PIN_BOCINA, LOW);
    bocinaEndTime = 0;
  }
}
