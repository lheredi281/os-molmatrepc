#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <Preferences.h>

#include <Keypad.h>

// ======== MATRIZ DE BOTONES (5x5) ========
const byte ROWS = 5; 
const byte COLS = 5; 
// Mapeo de teclas (del 1 al 25). Cada número representará un botón.
char keys[ROWS][COLS] = {
  {1, 2, 3, 4, 5},
  {6, 7, 8, 9, 10},
  {11, 12, 13, 14, 15},
  {16, 17, 18, 19, 20},
  {21, 22, 23, 24, 25}
};
// Pines de Filas (R1 a R5) - Usamos pines seguros de la ESP32
byte rowPins[ROWS] = {13, 14, 25, 26, 27}; 
// Pines de Columnas (C1 a C5)
byte colPins[COLS] = {32, 33, 21, 22, 23}; 

Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

#define MAX_TVS 18

Preferences preferences;
uint8_t tv_macs[MAX_TVS][6];
bool tv_online[MAX_TVS];

uint8_t mac_24s[6] = {0,0,0,0,0,0};
bool has_24s = false;

uint8_t broadcastAddress[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

bool isPairingMode = false;
unsigned long pairingStartTime = 0;
unsigned long comandoActivadoTime = 0; // Para el combo COMANDO + SYNC

typedef struct struct_message {
  uint8_t cmd;
  uint8_t team;
  uint8_t player;
  uint8_t value;
  uint8_t checksum;
} struct_message;

struct_message myData;


// Callbacks ESP-NOW
#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0)
void OnDataSent(const esp_now_send_info_t *tx_info, esp_now_send_status_t status) {
  const uint8_t *mac_addr = tx_info->des_addr;
#else
void OnDataSent(const uint8_t *mac_addr, esp_now_send_status_t status) {
#endif
  // Buscar a qué slot pertenece esta MAC y actualizar su estado Online/Offline
  for (int i = 0; i < MAX_TVS; i++) {
    if (memcmp(mac_addr, tv_macs[i], 6) == 0) {
      tv_online[i] = (status == ESP_NOW_SEND_SUCCESS);
      break;
    }
  }
}

void OnDataRecv(const esp_now_recv_info *info, const uint8_t *incomingData, int len) {
  const uint8_t *mac = info->src_addr;
  
  // A. MODO EMPAREJAMIENTO: Una TV responde con 0x98 (ACK de SYNC)
  if (isPairingMode && len == 5 && incomingData[0] == 0x98) {
    
    // 1. Chequear si la TV ya existe en nuestra agenda
    bool exists = false;
    for (int i = 0; i < MAX_TVS; i++) {
      if (memcmp(tv_macs[i], mac, 6) == 0) {
        exists = true;
        break;
      }
    }

    if (!exists) {
      // 2. Buscar un slot vacío y guardarla
      for (int i = 0; i < MAX_TVS; i++) {
        uint8_t emptyMac[6] = {0,0,0,0,0,0};
        if (memcmp(tv_macs[i], emptyMac, 6) == 0) {
          memcpy(tv_macs[i], mac, 6);
          
          // Guardar en memoria permanente
          char key[10];
          sprintf(key, "tv_%d", i);
          preferences.putBytes(key, mac, 6);

          // Registrar peer privado
          esp_now_peer_info_t peerInfo = {};
          memcpy(peerInfo.peer_addr, mac, 6);
          peerInfo.channel = 1;
          peerInfo.encrypt = false;
          esp_now_add_peer(&peerInfo);

          Serial.printf("[INFO] Nuevo Tablero %d Guardado!\n", i+1);
          break;
        }
      }
    }
  }
  
  // B. MODO EMPAREJAMIENTO: Un Reloj 24S responde con 0x97 (ACK Especial 24S)
  if (isPairingMode && len == 5 && incomingData[0] == 0x97) {
    memcpy(mac_24s, mac, 6);
    preferences.putBytes("mac_24s", mac, 6);
    has_24s = true;
    
    // Registrarlo como peer para poder hablarle si alguna vez hiciera falta
    esp_now_peer_info_t peerInfo = {};
    memcpy(peerInfo.peer_addr, mac, 6);
    peerInfo.channel = 1;
    peerInfo.encrypt = false;
    if (!esp_now_is_peer_exist(mac)) {
        esp_now_add_peer(&peerInfo);
    }
    Serial.println("[INFO] Tablero 24S Vinculado Exitosamente!");
  }

  // C. MODO JUEGO: Recibimos datos del reloj de 24S
  if (!isPairingMode && len == 5 && incomingData[0] == 10) {
    if (has_24s && memcmp(mac, mac_24s, 6) == 0) {
      // 1. Lo reenviamos a TODAS las TVs vinculadas por Unicast
      enviarATodosUnicast((struct_message *)incomingData);
      
      // 2. Se lo pasamos por USB a la PC para que la TV grande lo dibuje
      Serial.write(incomingData, 5);
    }
  }
}

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);

  pinMode(LED_SYNC_STATUS, OUTPUT);

  if (esp_now_init() != ESP_OK) return;

  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(1, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(false);

  // Registrar Callbacks de recepción (bidireccional) y envío (status)
  esp_now_register_send_cb(OnDataSent);
  esp_now_register_recv_cb(OnDataRecv);

  // Cargar MACs guardadas de las TVs
  preferences.begin("mando_tv", false);
  for (int i = 0; i < MAX_TVS; i++) {
    char key[10];
    sprintf(key, "tv_%d", i);
    size_t len = preferences.getBytes(key, tv_macs[i], 6);
    if (len == 6) {
      uint8_t emptyMac[6] = {0,0,0,0,0,0};
      if (memcmp(tv_macs[i], emptyMac, 6) != 0) {
        esp_now_peer_info_t peerInfo = {};
        memcpy(peerInfo.peer_addr, tv_macs[i], 6);
        peerInfo.channel = 1;
        peerInfo.encrypt = false;
        esp_now_add_peer(&peerInfo);
      }
    } else {
      memset(tv_macs[i], 0, 6);
    }
    tv_online[i] = false; // Arrancan todas apagadas hasta el primer envío
  }

  // Cargar MAC del Reloj 24s
  size_t len24 = preferences.getBytes("mac_24s", mac_24s, 6);
  uint8_t emptyMac[6] = {0,0,0,0,0,0};
  if (len24 == 6 && memcmp(mac_24s, emptyMac, 6) != 0) {
    has_24s = true;
    esp_now_peer_info_t peerInfo = {};
    memcpy(peerInfo.peer_addr, mac_24s, 6);
    peerInfo.channel = 1;
    peerInfo.encrypt = false;
    esp_now_add_peer(&peerInfo);
  } else {
    has_24s = false;
  }

  // Registrar Broadcast para enviar emparejamientos a las que aún no conocemos
  esp_now_peer_info_t bcastInfo = {};
  memcpy(bcastInfo.peer_addr, broadcastAddress, 6);
  bcastInfo.channel = 1;
  bcastInfo.encrypt = false;
  esp_now_add_peer(&bcastInfo);

  digitalWrite(LED_SYNC_STATUS, HIGH);
}

void enviarATodosUnicast(struct_message *data) {
  int vinculados = 0;
  for (int i = 0; i < MAX_TVS; i++) {
    uint8_t emptyMac[6] = {0,0,0,0,0,0};
    if (memcmp(tv_macs[i], emptyMac, 6) != 0) {
      esp_now_send(tv_macs[i], (uint8_t *)data, 5);
      vinculados++;
    }
  }
  
  if (vinculados == 0) {
    Serial.println("No hay ningun Tablero vinculado. Presiona SYNC en la PC o en la placa.");
  }
}

void loop() {

  // 2. MODO EMPAREJAMIENTO
  if (isPairingMode) {
    digitalWrite(LED_SYNC_STATUS, (millis() / 200) % 2);
    myData.cmd = 0x99;
    myData.checksum = 0x99;
    esp_now_send(broadcastAddress, (uint8_t *)&myData, 5); // Gritamos para que escuchen

    delay(500);

    if (millis() - pairingStartTime > 15000) {
      isPairingMode = false;
      digitalWrite(LED_SYNC_STATUS, HIGH);
      Serial.println("Fin del emparejamiento.");
    }
    return;
  }

  // 3. MODO JUEGO: Leer matriz de botones físicos
  char key = keypad.getKey();
  if (key) {
    uint8_t c=0, t=0, p=0, v=0;
    bool valid = true;
    
    switch(key) {
      // LOCAL
      case 1:  c=1; t=1; v=1; break; // +1 PTS
      case 2:  c=1; t=1; v=2; break; // +2 PTS
      case 3:  c=1; t=1; v=3; break; // +3 PTS
      case 4:  c=1; t=1; v=255; break; // -1 PUNTO
      case 5:  c=3; t=1; v=1; break; // + FALTA
      case 6:  c=3; t=1; v=255; break; // - FALTA
      // VISITA
      case 7:  c=1; t=2; v=1; break; // +1 PTS
      case 8:  c=1; t=2; v=2; break; // +2 PTS
      case 9:  c=1; t=2; v=3; break; // +3 PTS
      case 10: c=1; t=2; v=255; break; // -1 PUNTO
      case 11: c=3; t=2; v=1; break; // + FALTA
      case 12: c=3; t=2; v=255; break; // - FALTA
      // CENTRO
      case 13: c=4; break; // START/STOP
      case 14: c=6; break; // BOCINA
      case 15: c=7; t=1; break; // 1 MIN
      case 16: c=7; t=5; break; // 5 MIN
      case 17: c=7; t=10; break; // 10 MIN
      case 18: c=8; v=1; break; // +1 MINUTO
      case 19: c=8; v=255; break; // -1 MINUTO
      case 20: c=5; v=1; break; // +1 PERIODO
      case 21: c=5; v=255; break; // -1 PERIODO
      case 22: // EDIT/RESET (COMANDO)
        c=9; 
        comandoActivadoTime = millis(); // Iniciar ventana de 3 segundos para combo
        break; 
      
      // SYNC Y UNPAIR (Combo)
      case 23: // SYNC o UNPAIR
        if (comandoActivadoTime > 0 && (millis() - comandoActivadoTime < 3000)) {
          // Si apretaron COMANDO hace menos de 3 segundos, es un UNPAIR (BOMBA DE DIVORCIO)
          Serial.println("¡BOMBA DE DIVORCIO! Borrando TODAS las TVs y el Reloj 24s...");
          for (int i = 0; i < MAX_TVS; i++) {
            char prefKey[10];
            sprintf(prefKey, "tv_%d", i);
            preferences.remove(prefKey);
            memset(tv_macs[i], 0, 6);
          }
          preferences.remove("mac_24s");
          memset(mac_24s, 0, 6);
          has_24s = false;
          c=154; // Enviar UNPAIR a PC también
          valid = true;
          comandoActivadoTime = 0; // Resetear
        } else {
          // Si NO apretaron comando antes, es un SYNC NORMAL
          Serial.println("Entrando a Modo Emparejamiento. Buscando Tableros...");
          isPairingMode = true;
          pairingStartTime = millis();
          valid = false;
        }
        break;
      default: valid = false; break;
    }

    if (valid) {
      myData.cmd = c; myData.team = t; myData.player = p; myData.value = v;
      myData.checksum = (c + t + p + v) & 0xFF;
      enviarATodosUnicast(&myData);
      
      // Replicar a la PC por Serial para que la interfaz gráfica del Mando también reaccione
      uint8_t bufferOut[5] = {c, t, p, v, myData.checksum};
      Serial.write(bufferOut, 5);
    }
  }

  // 4. MODO JUEGO: Leer puerto serie (PC -> ESP32 TX)
  if (Serial.available() >= 5) {
    uint8_t buffer[5];
    Serial.readBytes(buffer, 5);

    uint8_t cmd = buffer[0];
    uint8_t team = buffer[1];
    uint8_t player = buffer[2];
    uint8_t value = buffer[3];
    uint8_t checksum = buffer[4];
    uint8_t calc_checksum = (cmd + team + player + value) & 0xFF;

    if (checksum == calc_checksum) {
      if (cmd == 153) {
        Serial.println("Entrando a Modo Emparejamiento (Via USB)... Buscando Tableros");
        isPairingMode = true;
        pairingStartTime = millis();
        return;
      }

      myData.cmd = cmd;
      myData.team = team;
      myData.player = player;
      myData.value = value;
      myData.checksum = checksum;

      // ENVIAR POR UNICAST A LOS 18 (o menos) TABLEROS GUARDADOS
      enviarATodosUnicast(&myData);
    }
  }

  // 5. REPORTE CONSTANTE A LA PC DEL ESTADO DE CONEXION (Cada 2 segundos)
  static unsigned long lastStatusReport = 0;
  if (millis() - lastStatusReport > 2000) {
     lastStatusReport = millis();
     uint8_t activos = 0, vinculados = 0;
     for(int i=0; i<MAX_TVS; i++){
        uint8_t emptyMac[6] = {0,0,0,0,0,0};
        if(memcmp(tv_macs[i], emptyMac, 6) != 0) {
           vinculados++;
           if (tv_online[i]) activos++;
        }
     }
     
     // Enviar paquete 5-bytes especial a la PC (CMD: 200)
     uint8_t statusBuf[5];
     statusBuf[0] = 200;       // CMD de Estado
     statusBuf[1] = vinculados;
     statusBuf[2] = activos;
     statusBuf[3] = has_24s ? 1 : 0;
     statusBuf[4] = (200 + vinculados + activos + statusBuf[3]) & 0xFF; // Checksum
     Serial.write(statusBuf, 5);
  }
}
