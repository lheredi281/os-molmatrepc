const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');

// Habilitar recarga en caliente (Hot Reload)
try {
  require('electron-reload')(__dirname, {
    electron: require(path.join(__dirname, 'node_modules', 'electron'))
  });
} catch (err) {
  console.log('electron-reload no está instalado o falló al cargar.');
}

let mainWindow;
let mandoWindow;
let globalPort = null;

const MODE = process.env.MODE || 'tv'; // Puede ser 'tv', 'mando' o 'ambos'
const COMPORT = process.env.COMPORT || 'COM3';

function createWindow() {
  if (MODE === 'tv' || MODE === 'ambos') {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 720,
      fullscreen: true, 
      kiosk: true,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false 
      }
    });
    mainWindow.loadFile('index.html');
  }

  if (MODE === 'mando' || MODE === 'ambos') {
    mandoWindow = new BrowserWindow({
      width: 1000,
      height: 800,
      x: 50,
      y: 50,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });
    mandoWindow.loadFile('mando.html');
  }
}

async function autoDetectSerialPort() {
  if (process.env.COMPORT) {
    console.log(`Usando puerto forzado por el usuario: ${process.env.COMPORT}`);
    return process.env.COMPORT;
  }
  
  try {
    const ports = await SerialPort.list();
    console.log("Puertos disponibles encontrados:", ports.map(p => p.path).join(", "));
    
    // Buscar puertos que tengan vendorId o contengan la palabra 'COM'
    const espPort = ports.find(p => p.vendorId || p.path.toUpperCase().includes('COM'));
    
    if (espPort) {
      console.log(`[Auto-Detect] Placa USB asignada: ${espPort.path} (${espPort.manufacturer || 'Desconocido'})`);
      return espPort.path;
    }
  } catch (err) {
    console.log("Error buscando puertos:", err);
  }
  
  // Fallback al puerto del entorno o COM3
  return process.env.COMPORT || 'COM3';
}

app.whenReady().then(async () => {
  // Inicializar Puerto Serie con auto-detección primero
  const portToUse = await autoDetectSerialPort();
  initSerialPort(portToUse); 

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0 && globalPort && globalPort.isOpen) createWindow();
  });
  

  ipcMain.on('virtual-command', (event, { cmd, team, player, value }) => {
    
    // 1. Si estamos en modo 'ambos' o 'tv' con el mando local, lo mandamos directo al tablero interno
    if (mainWindow) {
      mainWindow.webContents.send('serial-command', { cmd, team, player, value });
    }
    
    // 2. Si estamos en modo 'mando' o tenemos el hardware TX conectado, escribimos al Serial
    if (globalPort && globalPort.isOpen) {
      const checksum = (cmd + team + player + value) & 0xFF;
      const buf = Buffer.from([cmd, team, player, value, checksum]);
      globalPort.write(buf, (err) => {
        if(err) console.log("Error enviando por Serial:", err);
      });
      console.log(`[Mando Virtual] -> Enviado a USB: CMD:${cmd} T:${team} P:${player} V:${value}`);
    }
  });

  // --- CONTROLADORES WI-FI KIOSCO ---
  const { exec } = require('child_process');
  
  ipcMain.handle('wifi-scan', () => {
    return new Promise((resolve) => {
      exec('nmcli -t -f SSID,SIGNAL dev wifi', (error, stdout) => {
        if (error) {
          console.log("Error escaneando Wi-Fi:", error);
          resolve([]);
          return;
        }
        const networks = stdout.split('\n')
          .filter(line => line.trim() !== '')
          .map(line => {
            const parts = line.split(':');
            return { ssid: parts[0], signal: parseInt(parts[1]) };
          })
          .filter(n => n.ssid); // Filtrar redes sin nombre
          
        // Eliminar duplicados por SSID
        const unique = [];
        const map = new Map();
        for (const item of networks) {
            if(!map.has(item.ssid)){
                map.set(item.ssid, true);
                unique.push(item);
            }
        }
        resolve(unique);
      });
    });
  });

  ipcMain.handle('wifi-connect', (event, ssid, password) => {
    return new Promise((resolve) => {
      const cmd = `nmcli dev wifi connect "${ssid}" password "${password}"`;
      exec(cmd, (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, error: stderr || error.message });
        } else {
          resolve({ success: true });
        }
      });
    });
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Lógica de lectura del puerto Serie
function initSerialPort(portName) {
  try {
    // Siempre abrimos la ventana, haya o no mando.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }

    function connect() {
      globalPort = new SerialPort({ path: portName, baudRate: 115200 }, function (err) {
        if (err) {
          console.log(`[Status] Mando desconectado en ${portName}. Modo Publicidad ACTIVO. Reintentando en 5s...`);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('mando-status', { connected: false });
          }
          setTimeout(connect, 5000);
          return;
        }
        
        console.log(`[Status] Conectado exitosamente a la ESP32 en ${portName}. MODO TABLERO ACTIVO.`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('mando-status', { connected: true });
        }
      });

      globalPort.on('close', () => {
        console.log('[Status] Puerto serie cerrado. Mando desconectado.');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('mando-status', { connected: false });
        }
        setTimeout(connect, 5000);
      });

      let buffer = Buffer.alloc(0);

      globalPort.on('data', (chunk) => {
        // Acumular datos entrantes
        buffer = Buffer.concat([buffer, chunk]);
        
        // Procesar todos los paquetes completos de 5 bytes que tengamos en el buffer
        while (buffer.length >= 5) {
          const cmd = buffer[0];
          const team = buffer[1];
          const player = buffer[2];
          const value = buffer[3];
          const checksum = buffer[4];

          // Validar integridad estructural: suma de los 4 primeros bytes truncada a 8 bits
          const calculatedChecksum = (cmd + team + player + value) & 0xFF;
          
          if (checksum === calculatedChecksum) {
            console.log(`[Hardware ESP32] Comando Recibido -> CMD: ${cmd} | EQUIPO: ${team} | JUGADOR: ${player} | VALOR: ${value}`);
            
            if (mainWindow) {
              // Mandar los datos estructurados al Frontend
              mainWindow.webContents.send('serial-command', { cmd, team, player, value });
            }
            if (mandoWindow) {
              mandoWindow.webContents.send('serial-command', { cmd, team, player, value });
            }
            buffer = buffer.subarray(5); // Paquete válido, avanzamos 5 bytes
          } else {
            console.log(`[Hardware ESP32] ⚠️ ERROR: Checksum inválido (Esperado: ${calculatedChecksum}, Recibido: ${checksum}). Descartando 1 byte para re-sincronizar...`);
            buffer = buffer.subarray(1); // ¡CLAVE! Solo avanzamos 1 byte si falla, para buscar el inicio real del próximo paquete
          }
        }
      });
    }

    connect(); // <-- INICIO DE LA CONEXIÓN
  } catch (error) {
    console.log("Error crítico inicializando el puerto serie:", error);
  }
}
