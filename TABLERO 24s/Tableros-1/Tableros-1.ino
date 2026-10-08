#include <esp_now.h>
#include <WiFi.h>

// ===============================
// DISPLAY (Pines: a, b, c, d, e, f, g)
// ===============================
int unidades[7] = {5, 2, 0, 4, 16, 17, 15}; 
int decenas[7] = {32, 14, 27, 26, 25, 33, 12}; 

byte numeros[10][7] = {
  { 1, 1, 1, 1, 1, 1, 0 }, // 0
  { 0, 1, 1, 0, 0, 0, 0 }, // 1
  { 1, 1, 0, 1, 1, 0, 1 }, // 2
  { 1, 1, 1, 1, 0, 0, 1 }, // 3
  { 0, 1, 1, 0, 0, 1, 1 }, // 4
  { 1, 0, 1, 1, 0, 1, 1 }, // 5
  { 1, 0, 1, 1, 1, 1, 1 }, // 6
  { 1, 1, 1, 0, 0, 0, 0 }, // 7
  { 1, 1, 1, 1, 1, 1, 1 }, // 8
  { 1, 1, 1, 1, 0, 1, 1 }  // 9
};

// ===============================
// PINES Y LÓGICA DEL RELÉ VISUAL (Pin 18)
// ===============================
const int PIN_LUZ_CERO = 18;
const int RELE_ON  = LOW; // Envía 1 (3.3V) para encender la tira al llegar a 0
const int RELE_OFF = HIGH;  // Envía 0 (0V) para mantener la tira apagada


bool luzEncendida = false;
unsigned long tiempoInicioLuz = 0;
const unsigned long DURACION_LUZ = 2000; // La tira LED brillará por 2 segundos

// Variable para detectar cuándo el reloj acaba de llegar a cero
int tiempoAnteriorRecibido = -1; 

// ===============================
// VARIABLES DE SEGURIDAD (WATCHDOG)
// ===============================
unsigned long ultimaVezRecibido = 0;
const unsigned long TIEMPO_DESCONEXION = 2000; // 2 segundos sin señal = apagar
bool displayEncendido = true;

typedef struct {
  int valorTiempo; 
} mensaje_t;

mensaje_t mensaje;

// ===============================
// FUNCIONES DEL DISPLAY
// ===============================
void mostrarDigito(int n, int pines[]) {
  for (int i = 0; i < 7; i++) {
    digitalWrite(pines[i], numeros[n][i]);
  }
}

void apagarSegmentos(int pines[]) {
  for (int i = 0; i < 7; i++) {
    digitalWrite(pines[i], 0); // 0 apaga el segmento
  }
}

void apagarTodo() {
  apagarSegmentos(decenas);
  apagarSegmentos(unidades);
  displayEncendido = false;

  // Por seguridad, si perdemos conexión, también apagamos la luz roja
  digitalWrite(PIN_LUZ_CERO, RELE_OFF);
  luzEncendida = false;
}

void mostrarNumero(int valor) {
  if (valor < 0) valor = 0;
  if (valor > 99) valor = 99;
  
  displayEncendido = true;

  // AQUÍ ESTÁ EL CAMBIO: Siempre mostramos la decena, para que se vea el "09"
  mostrarDigito(valor / 10, decenas);
  mostrarDigito(valor % 10, unidades);
}

// ===============================
// CALLBACK DE RECEPCIÓN
// ===============================
void onReceive(const esp_now_recv_info *info, const uint8_t *data, int len) {
  memcpy(&mensaje, data, sizeof(mensaje));
  
  // Refrescamos el temporizador de seguridad
  ultimaVezRecibido = millis();

  // LÓGICA DE LA LUZ VISUAL: Si llegó a cero y antes NO era cero
  if (mensaje.valorTiempo == 0 && tiempoAnteriorRecibido != 0) {
    digitalWrite(PIN_LUZ_CERO, RELE_ON);
    luzEncendida = true;
    tiempoInicioLuz = millis();
  } 
  // Si resetean el reloj (a 24 o 14) mientras la luz sigue encendida, la apagamos rápido
  else if (mensaje.valorTiempo > 0 && luzEncendida) {
    digitalWrite(PIN_LUZ_CERO, RELE_OFF);
    luzEncendida = false;
  }

  tiempoAnteriorRecibido = mensaje.valorTiempo;
  
  mostrarNumero(mensaje.valorTiempo);
}

// ===============================
// SETUP
// ===============================
void setup() {
  Serial.begin(115200);

  // Configuramos el Relé de la luz para que no destelle al iniciar
  digitalWrite(PIN_LUZ_CERO, RELE_OFF); 
  pinMode(PIN_LUZ_CERO, OUTPUT);

  WiFi.mode(WIFI_STA);

  if (esp_now_init() != ESP_OK) {
    Serial.println("ERROR INICIALIZANDO ESP-NOW");
    return;
  }
  
  esp_now_register_recv_cb(onReceive);

  for (int i = 0; i < 7; i++) {
    pinMode(decenas[i], OUTPUT);
    pinMode(unidades[i], OUTPUT);
  }

  // Iniciamos apagado hasta que el maestro envíe el primer dato
  apagarTodo(); 
}

// ===============================
// LOOP
// ===============================
void loop() {
  // 1. SISTEMA DE SEGURIDAD: Si pasaron más de 2 segundos sin señal del mando
  if (displayEncendido && (millis() - ultimaVezRecibido > TIEMPO_DESCONEXION)) {
    apagarTodo();
    Serial.println("Señal perdida. Displays apagados.");
  }

  // 2. APAGADO AUTOMÁTICO DE LA LUZ ROJA
  if (luzEncendida) {
    if (millis() - tiempoInicioLuz >= DURACION_LUZ) {
      digitalWrite(PIN_LUZ_CERO, RELE_OFF);
      luzEncendida = false;
    }
  }
}