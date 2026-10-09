#include <esp_now.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include <Preferences.h>

// ===============================
// CONFIGURACIÓN DE PINES
// ===============================
const int PIN_RESET24 = 32;
const int PIN_STOP    = 33;
const int PIN_START   = 26;
const int PIN_RESET14 = 25;
const int PIN_BUZZER  = 17;
const int PIN_SYNC    = 14; // NUEVO BOTÓN PARA VINCULAR AL MANDO
const int LED_STATUS  = 2;  // LED de estado (usaremos el de la placa)

Preferences preferences;
uint8_t mandoPrincipalMAC[6] = {0,0,0,0,0,0};
bool isPairingMode = false;
unsigned long pairingStartTime = 0;
bool hasMando = false;

typedef struct struct_message {
  uint8_t cmd;
  uint8_t team;
  uint8_t player;
  uint8_t value;
  uint8_t checksum;
} struct_message;

struct_message myData;

// Variables de control de tiempo
int contador = 24;
bool corriendo = false;
unsigned long tPrev = 0;
unsigned long ultimoDebounce = 0;
const int delayDebounce = 300;
unsigned long ultimoEnvio = 0;
const unsigned long INTERVALO_LATIDO = 500;

void enviarSincronizacion() {
  if (!hasMando) return; // Si no hay Mando Principal, no envía nada
  
  myData.cmd = 10; // CMD 10 = Reloj de Posesión (24s)
  myData.team = 0;
  myData.player = 0;
  myData.value = (uint8_t)contador;
  myData.checksum = (10 + 0 + 0 + myData.value) & 0xFF;
  
  esp_now_send(mandoPrincipalMAC, (uint8_t *)&myData, 5);
  Serial.printf("Sincronizando 24s con Mando Principal: %d\n", contador);
  ultimoEnvio = millis();
}

void OnDataRecv(const esp_now_recv_info * info, const uint8_t *incomingData, int len) {
  const uint8_t * mac = info->src_addr;
  
  if (isPairingMode && len == 5 && incomingData[0] == 153) {
    // Escuchamos el grito del Mando Principal
    memcpy(mandoPrincipalMAC, mac, 6);
    
    // Guardar en memoria permanente
    preferences.begin("reloj24s", false);
    preferences.putBytes("mando_mac", mandoPrincipalMAC, 6);
    preferences.end();
    
    // Registrar Peer para Unicast
    if (esp_now_is_peer_exist(mandoPrincipalMAC)) {
      esp_now_del_peer(mandoPrincipalMAC);
    }
    esp_now_peer_info_t peerInfo = {};
    memcpy(peerInfo.peer_addr, mandoPrincipalMAC, 6);
    peerInfo.channel = 1;
    peerInfo.encrypt = false;
    esp_now_add_peer(&peerInfo);

    // Responder con ACK Especial 24S (CMD 0x97) para que el Mando sepa que somos un 24s y no una TV
    uint8_t ackData[5] = {0x97, 0, 0, 0, 0x97};
    esp_now_send(mandoPrincipalMAC, ackData, 5);

    isPairingMode = false;
    hasMando = true;
    digitalWrite(LED_STATUS, HIGH);
    Serial.println("¡Vinculado al Mando Principal exitosamente!");
  }
}

void setup() {
  Serial.begin(115200);
  
  pinMode(PIN_RESET24, INPUT_PULLUP);
  pinMode(PIN_STOP,    INPUT_PULLUP);
  pinMode(PIN_START,   INPUT_PULLUP);
  pinMode(PIN_RESET14, INPUT_PULLUP);
  pinMode(PIN_SYNC,    INPUT_PULLUP);
  pinMode(PIN_BUZZER,  OUTPUT);
  pinMode(LED_STATUS,  OUTPUT);
  
  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(LED_STATUS, LOW);

  WiFi.mode(WIFI_STA);
  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(1, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(false);

  if (esp_now_init() != ESP_OK) return;
  esp_now_register_recv_cb(OnDataRecv);
  
  preferences.begin("reloj24s", false);
  size_t len = preferences.getBytes("mando_mac", mandoPrincipalMAC, 6);
  preferences.end();
  
  uint8_t emptyMac[6] = {0};
  if (len == 6 && memcmp(mandoPrincipalMAC, emptyMac, 6) != 0) {
    esp_now_peer_info_t peerInfo = {};
    memcpy(peerInfo.peer_addr, mandoPrincipalMAC, 6);
    peerInfo.channel = 1;
    peerInfo.encrypt = false;
    esp_now_add_peer(&peerInfo);
    hasMando = true;
    digitalWrite(LED_STATUS, HIGH);
    Serial.println("Iniciando vinculado al Mando Principal guardado.");
  } else {
    Serial.println("No hay Mando vinculado. Pulsa SYNC.");
  }
}

void loop() {
  // 1. CHEQUEAR COMBINACIÓN DE SYNC (START + STOP + SYNC a la vez por 2 segundos)
  if (digitalRead(PIN_SYNC) == LOW && digitalRead(PIN_START) == LOW && digitalRead(PIN_STOP) == LOW) {
    delay(2000);
    if (digitalRead(PIN_SYNC) == LOW && digitalRead(PIN_START) == LOW && digitalRead(PIN_STOP) == LOW) {
      Serial.println("Entrando a Modo SYNC. Esperando al Mando Principal...");
      isPairingMode = true;
      pairingStartTime = millis();
      hasMando = false;
      memset(mandoPrincipalMAC, 0, 6);
      preferences.begin("reloj24s", false);
      preferences.remove("mando_mac");
      preferences.end();
      
      // Detener el reloj si estaba corriendo
      corriendo = false;
      
      // Esperar a que suelten los botones para no disparar acciones falsas
      while(digitalRead(PIN_SYNC) == LOW || digitalRead(PIN_START) == LOW || digitalRead(PIN_STOP) == LOW) {
        delay(10);
      }
    }
  }

  if (isPairingMode) {
    digitalWrite(LED_STATUS, (millis() / 200) % 2); // Parpadeo rápido
    if (millis() - pairingStartTime > 30000) {
      isPairingMode = false;
      digitalWrite(LED_STATUS, LOW);
      Serial.println("Fin del tiempo de emparejamiento.");
    }
    return; // Si estamos en emparejamiento, no corre el reloj
  }

  // 2. LÓGICA DEL CONTADOR MAESTRO
  if (corriendo && millis() - tPrev >= 1000) {
    tPrev = millis();
    if (contador > 0) {
      contador--;
      enviarSincronizacion();
      
      if (contador == 0) {
        corriendo = false;
        Serial.println("¡TIEMPO AGOTADO!");
        digitalWrite(PIN_BUZZER, HIGH);
        delay(2000); 
        digitalWrite(PIN_BUZZER, LOW);
      }
    }
  }

  // 3. LÓGICA DE BOTONES FÍSICOS
  if (millis() - ultimoDebounce > delayDebounce) {
    if (digitalRead(PIN_START) == LOW) {
      corriendo = true;
      enviarSincronizacion();
      ultimoDebounce = millis();
    }
    else if (digitalRead(PIN_STOP) == LOW) {
      corriendo = false;
      ultimoDebounce = millis();
    }
    else if (digitalRead(PIN_RESET24) == LOW) {
      contador = 24;
      enviarSincronizacion();
      ultimoDebounce = millis();
    }
    else if (digitalRead(PIN_RESET14) == LOW) {
      contador = 14;
      enviarSincronizacion();
      ultimoDebounce = millis();
    }
  }

  // 4. HEARTBEAT (Refresco)
  if (millis() - ultimoEnvio >= INTERVALO_LATIDO) {
    enviarSincronizacion();
  }
}