const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');
const { exec } = require('child_process');

// app.disableHardwareAcceleration();
// app.commandLine.appendSwitch('disable-software-rasterizer');
// app.commandLine.appendSwitch('disable-gpu');

let mainWindow;
let mandoWindow;
let globalPort = null;

const MODE = process.env.MODE || 'tv'; // Puede ser 'tv', 'mando' o 'ambos'
const COMPORT = process.env.COMPORT || 'COM3';

function createWindow() {
  let displays = screen.getAllDisplays();
  let externalDisplay = displays.find((display) => {
    return display.bounds.x !== 0 || display.bounds.y !== 0;
  });

  if (MODE === 'tv' || MODE === 'ambos') {
    let tvBounds = { x: 0, y: 0, width: 1280, height: 720 };
    if (externalDisplay) {
      console.log('Pantalla externa detectada, asignando TV a esta pantalla.');
      tvBounds.x = externalDisplay.bounds.x;
      tvBounds.y = externalDisplay.bounds.y;
    }

    mainWindow = new BrowserWindow({
      x: tvBounds.x,
      y: tvBounds.y,
      width: 1280,
      height: 720,
      fullscreen: true, 
      kiosk: true,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        webSecurity: false
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
    
    // Buscar puertos que tengan vendorId, o contengan ttyUSB, ttyACM o COM
    const espPort = ports.find(p => p.vendorId || p.path.toUpperCase().includes('COM') || p.path.includes('ttyUSB') || p.path.includes('ttyACM'));
    
    if (espPort) {
      console.log(`[Auto-Detect] Placa USB asignada: ${espPort.path} (${espPort.manufacturer || 'Desconocido'})`);
      return espPort.path;
    }
  
} catch (err) {}

  return process.platform === 'linux' ? '/dev/ttyUSB0' : 'COM3';
}

app.whenReady().then(async () => {
  // HDMI-CEC: Encender TV y forzar fuente HDMI
  if (process.platform === 'linux') {
    console.log("[CEC] Enviando se�al para encender la TV...");
    exec('echo "on 0" | cec-client -s -d 1', () => {
      exec('echo "as" | cec-client -s -d 1');
    });
  }

  // Inicializar Puerto Serie con auto-detecci�n primero
  const portToUse = await autoDetectSerialPort();
  initSerialPort(portToUse); 

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0 && globalPort && globalPort.isOpen) createWindow();
  });
  

  ipcMain.on('trigger-sync', (event) => {
    if (globalPort && globalPort.isOpen) {
      // Enviamos una r�faga de 10 bytes de 155 para garantizar que la placa ESP32
      // lo reciba incluso si se descuadr� leyendo basura del inicio de Linux
      const buf = Buffer.from([155, 155, 155, 155, 155, 155, 155, 155, 155, 155]);
      globalPort.write(buf, (err) => {
        if(err) console.log("Error enviando SYNC por Serial:", err);
      });
      console.log(`[Virtual] -> R�faga de Sincronizaci�n Enviada a la Receptora (155)`);
    } else {
      console.log(`[Virtual] -> Intent� enviar SYNC pero el puerto est� cerrado.`);
    }
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

  // --- CONTROLADORES WI-FI, KIOSCO Y USB ---
  const fs = require('fs');
  const os = require('os');
  
  // Crear carpeta local de publicidades si no existe
  const adsFolder = path.join(os.homedir(), 'tablero', 'publicidades');
  if (!fs.existsSync(adsFolder)) {
    fs.mkdirSync(adsFolder, { recursive: true });
  }

  // --- USB Y ARCHIVOS ---
  ipcMain.handle('get-ads-folder', () => adsFolder);

  ipcMain.handle('list-usbs', () => {
    // En Linux, udiskie monta en /media/<usuario>
    const mediaPath = path.join('/media', os.userInfo().username);
    try {
      if (!fs.existsSync(mediaPath)) return [];
      return fs.readdirSync(mediaPath).map(folder => ({
        name: folder,
        path: path.join(mediaPath, folder)
      }));
    } catch(e) { return []; }
  });

  ipcMain.handle('list-files', (event, dirPath) => {
    try {
      if (!fs.existsSync(dirPath)) return [];
      return fs.readdirSync(dirPath)
        .filter(f => f.match(/\.(mp4|jpg|png|jpeg)$/i))
        .map(f => ({ name: f, path: path.join(dirPath, f) }));
    } catch(e) { return []; }
  });

  ipcMain.handle('copy-file', (event, sourcePath, destName) => {
    try {
      const safeDestName = path.basename(destName);
      const destPath = path.join(adsFolder, safeDestName);
      fs.copyFileSync(sourcePath, destPath);
      return { success: true };
    } catch(e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('delete-file', (event, fileName) => {
    try {
      const safeFileName = path.basename(fileName);
      fs.unlinkSync(path.join(adsFolder, safeFileName));
      return { success: true };
    } catch(e) { return { success: false }; }
  });

  // --- WI-FI ---
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

// L�gica de lectura del puerto Serie
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
            // console.log(`[Hardware ESP32] Comando Recibido -> CMD: ${cmd} | EQUIPO: ${team} | JUGADOR: ${player} | VALOR: ${value}`); // Muted to improve performance and reduce latency
            
            if (mainWindow) {
              // Mandar los datos estructurados al Frontend
              mainWindow.webContents.send('serial-command', { cmd, team, player, value });
            }
            if (mandoWindow) {
              mandoWindow.webContents.send('serial-command', { cmd, team, player, value });
            }
            buffer = buffer.subarray(5); // Paquete v�lido, avanzamos 5 bytes
          } else {
            console.log(`[Hardware ESP32] ?? ERROR: Checksum inv�lido (Esperado: ${calculatedChecksum}, Recibido: ${checksum}). Descartando 1 byte para re-sincronizar...`);
            buffer = buffer.subarray(1); // �CLAVE! Solo avanzamos 1 byte si falla, para buscar el inicio real del pr�ximo paquete
          }
        }
      });
    }

    connect(); // <-- INICIO DE LA CONEXI�N
  } catch (error) {
    console.log("Error cr�tico inicializando el puerto serie:", error);
  }
}



