const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');
const { exec } = require('child_process');
const fs = require('fs');
const os = require('os');

let mainWindow = null;
let mandoWindow = null;
let globalPort = null;

const MODE = process.env.MODE || 'tv'; // 'tv', 'mando' o 'ambos'
const COMPORT = process.env.COMPORT || '';

// ========================================================
// SISTEMA DE REGISTRO DIAGNÓSTICO DETALLADO (LOG PERSISTENTE)
// ========================================================
const logPaths = [
  path.join(__dirname, 'tablero_debug.log'),
  path.join(os.homedir(), 'tablero_debug.log'),
  '/home/vboxuser/tablero_debug.log',
  '/home/chanca/tablero_debug.log'
];

function writeDiagLog(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  console.log(msg);
  for (const p of logPaths) {
    try {
      fs.appendFileSync(p, line);
    } catch(e) {}
  }
}

writeDiagLog(`=== INICIO DE SESIÓN TABLERO KIOSCO === (Plataforma: ${process.platform}, Arch: ${process.arch}, Usuario: ${os.userInfo().username})`);

function createTvWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  let displays = screen.getAllDisplays();
  let externalDisplay = displays.find((display) => {
    return display.bounds.x !== 0 || display.bounds.y !== 0;
  });

  let tvBounds = { x: 0, y: 0, width: 1280, height: 720 };
  if (externalDisplay) {
    console.log('[TV] Pantalla externa detectada, asignando TV a pantalla secundaria.');
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
  mainWindow.webContents.on('did-finish-load', () => {
    const isConnected = !!(globalPort && globalPort.isOpen);
    mainWindow.webContents.send('mando-status', { connected: isConnected, port: globalPort?.path });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function createMandoWindow() {
  if (mandoWindow && !mandoWindow.isDestroyed()) {
    if (!mandoWindow.isVisible()) mandoWindow.show();
    mandoWindow.focus();
    return mandoWindow;
  }

  mandoWindow = new BrowserWindow({
    width: 1100,
    height: 850,
    x: 50,
    y: 50,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mandoWindow.loadFile('mando.html');
  mandoWindow.webContents.on('did-finish-load', () => {
    const isConnected = !!(globalPort && globalPort.isOpen);
    mandoWindow.webContents.send('mando-status', { connected: isConnected, port: globalPort?.path });
  });

  mandoWindow.on('closed', () => {
    mandoWindow = null;
  });

  return mandoWindow;
}

function createWindow() {
  if (MODE === 'tv') {
    createTvWindow();
  } else if (MODE === 'mando') {
    createMandoWindow();
  } else if (MODE === 'ambos') {
    createTvWindow();
    createMandoWindow();
  }
}

async function autoDetectSerialPort() {
  if (COMPORT) {
    writeDiagLog(`[Auto-Detect] Usando puerto forzado por variable de entorno: ${COMPORT}`);
    return COMPORT;
  }

  // 1. En Linux, comprobar primero dispositivos del kernel directos (/dev/ttyUSB*, /dev/ttyACM*)
  if (process.platform === 'linux') {
    const fs = require('fs');
    for (let i = 0; i < 5; i++) {
      const usbPath = `/dev/ttyUSB${i}`;
      if (fs.existsSync(usbPath)) {
        writeDiagLog(`[Auto-Detect Linux] Encontrado puerto serie activo: ${usbPath}`);
        return usbPath;
      }
      const acmPath = `/dev/ttyACM${i}`;
      if (fs.existsSync(acmPath)) {
        writeDiagLog(`[Auto-Detect Linux] Encontrado puerto CDC/ACM activo: ${acmPath}`);
        return acmPath;
      }
    }
  }

  try {
    const ports = await SerialPort.list();
    writeDiagLog(`[Auto-Detect] Puertos serie detectados (${ports.length}): ` + ports.map(p => `${p.path} [VID:${p.vendorId || 'none'} PID:${p.productId || 'none'}] (${p.friendlyName || p.manufacturer || 'Generico'})`).join(", "));

    // Prioridad 1: Chip UART ESP32 (CP210x [10C4], CH340 [1A86], FTDI [0403], Espressif)
    const espPort = ports.find(p => {
      const vId = (p.vendorId || '').toLowerCase();
      const mfg = (p.manufacturer || '').toLowerCase();
      const name = (p.friendlyName || '').toLowerCase();
      return vId === '10c4' || vId === '1a86' || vId === '0403' ||
             mfg.includes('silicon') || mfg.includes('ch340') || mfg.includes('espressif') ||
             name.includes('cp210') || name.includes('ch340') || name.includes('uart') ||
             p.path.includes('ttyUSB') || p.path.includes('ttyACM');
    });

    if (espPort) {
      writeDiagLog(`[Auto-Detect] -> Placa ESP32 identificada en ${espPort.path} (${espPort.friendlyName || espPort.manufacturer})`);
      return espPort.path;
    }

    // Prioridad 2: Cualquier puerto serie con VID que NO sea un vínculo Bluetooth
    const otherUsb = ports.find(p => p.vendorId && !p.friendlyName?.toLowerCase().includes('bluetooth'));
    if (otherUsb) {
      writeDiagLog(`[Auto-Detect] -> Puerto USB alternativo: ${otherUsb.path}`);
      return otherUsb.path;
    }
  } catch (err) {
    writeDiagLog(`[Auto-Detect] Error buscando puertos serie: ${err.message}`);
  }

  if (process.platform === 'linux') {
    const fs = require('fs');
    if (fs.existsSync('/dev/ttyUSB0')) return '/dev/ttyUSB0';
    if (fs.existsSync('/dev/ttyACM0')) return '/dev/ttyACM0';
    return '/dev/ttyUSB0';
  }
  return 'COM3';
}

function notifyStatus(connected, portName) {
  writeDiagLog(`[Notificación Status] Mando: ${connected ? 'CONECTADO' : 'DESCONECTADO'} en ${portName}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mando-status', { connected, port: portName });
  }
  if (mandoWindow && !mandoWindow.isDestroyed()) {
    mandoWindow.webContents.send('mando-status', { connected, port: portName });
  }
}

function broadcastCommand(cmd, team, player, value) {
  writeDiagLog(`[Paquete Rx] cmd=${cmd}, team=${team}, player=${player}, value=${value}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('serial-command', { cmd, team, player, value });
  }
  if (mandoWindow && !mandoWindow.isDestroyed()) {
    mandoWindow.webContents.send('serial-command', { cmd, team, player, value });
  }
}

function initSerialPort(initialPort) {
  try {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }

    let activePortName = initialPort;

    function connect() {
      writeDiagLog(`[Serial] Intentando conectar con ESP32 en ${activePortName}...`);
      
      globalPort = new SerialPort({ path: activePortName, baudRate: 115200 }, function (err) {
        if (err) {
          writeDiagLog(`[Status] Error abriendo ${activePortName}: ${err.message}. Reintentando en 3s...`);
          notifyStatus(false, activePortName);
          setTimeout(async () => {
            activePortName = await autoDetectSerialPort();
            connect();
          }, 3000);
          return;
        }

        writeDiagLog(`[Status] Conectado exitosamente a ESP32 en ${activePortName}. MODO ACTIVO.`);
        notifyStatus(true, activePortName);
      });

      globalPort.on('close', () => {
        writeDiagLog(`[Status] Puerto ${activePortName} desconectado.`);
        notifyStatus(false, activePortName);
        setTimeout(async () => {
          activePortName = await autoDetectSerialPort();
          connect();
        }, 3000);
      });

      globalPort.on('error', (err) => {
        writeDiagLog(`[Status] Error en puerto serie: ${err.message}`);
      });

      let buffer = Buffer.alloc(0);

      globalPort.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);

        // Procesar paquetes completos de 5 bytes
        while (buffer.length >= 5) {
          const cmd = buffer[0];
          const team = buffer[1];
          const player = buffer[2];
          const value = buffer[3];
          const checksum = buffer[4];

          const calculatedChecksum = (cmd + team + player + value) & 0xFF;

          if (checksum === calculatedChecksum) {
            broadcastCommand(cmd, team, player, value);
            buffer = buffer.subarray(5);
          } else {
            console.log(`[ESP32 Serial] Checksum invalido (${checksum} != ${calculatedChecksum}). Descartando 1 byte...`);
            buffer = buffer.subarray(1);
          }
        }
      });
    }

    connect();
  } catch (error) {
    console.log("Error critico inicializando el puerto serie:", error);
  }
}

app.whenReady().then(async () => {
  // HDMI-CEC: Encender TV en Linux
  if (process.platform === 'linux') {
    exec('echo "on 0" | cec-client -s -d 1', () => {
      exec('echo "as" | cec-client -s -d 1');
    });
  }

  const portToUse = await autoDetectSerialPort();
  initSerialPort(portToUse);

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Toggle de la pantalla gigante TV desde la consola de Mando
  ipcMain.on('toggle-tv-window', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    } else {
      createTvWindow();
    }
  });

  ipcMain.on('trigger-sync', () => {
    if (globalPort && globalPort.isOpen) {
      const buf = Buffer.from([155, 155, 155, 155, 155, 155, 155, 155, 155, 155]);
      globalPort.write(buf);
      console.log(`[Virtual] -> Rafaga SYNC (155) enviada a la ESP32`);
    }
  });

  ipcMain.on('virtual-command', (event, { cmd, team, player, value }) => {
    // 1. Mandar al tablero de TV interno si existe
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('serial-command', { cmd, team, player, value });
    }

    // 2. Si hay hardware ESP32 por USB, enviar el paquete crudo de 5 bytes
    if (globalPort && globalPort.isOpen) {
      const checksum = (cmd + team + player + value) & 0xFF;
      const buf = Buffer.from([cmd, team, player, value, checksum]);
      globalPort.write(buf, (err) => {
        if (err) console.log("Error enviando por Serial:", err);
      });
      console.log(`[Mando Virtual] -> USB Serial: CMD:${cmd} T:${team} P:${player} V:${value}`);
    }
  });

  // --- ARCHIVOS Y PUBLICIDADES ---
  const adsFolder = path.join(os.homedir(), 'tablero', 'publicidades');
  if (!fs.existsSync(adsFolder)) {
    fs.mkdirSync(adsFolder, { recursive: true });
  }

  ipcMain.handle('get-ads-folder', () => adsFolder);

  ipcMain.handle('list-usbs', () => {
    const mediaPath = path.join('/media', os.userInfo().username);
    try {
      if (!fs.existsSync(mediaPath)) return [];
      return fs.readdirSync(mediaPath).map(folder => ({
        name: folder,
        path: path.join(mediaPath, folder)
      }));
    } catch (e) { return []; }
  });

  ipcMain.handle('list-files', (event, dirPath) => {
    try {
      if (!fs.existsSync(dirPath)) return [];
      return fs.readdirSync(dirPath)
        .filter(f => f.match(/\.(mp4|jpg|png|jpeg)$/i))
        .map(f => ({ name: f, path: path.join(dirPath, f) }));
    } catch (e) { return []; }
  });

  ipcMain.handle('copy-file', (event, sourcePath, destName) => {
    try {
      const safeDestName = path.basename(destName);
      const destPath = path.join(adsFolder, safeDestName);
      fs.copyFileSync(sourcePath, destPath);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('delete-file', (event, fileName) => {
    try {
      const safeFileName = path.basename(fileName);
      fs.unlinkSync(path.join(adsFolder, safeFileName));
      return { success: true };
    } catch (e) { return { success: false }; }
  });

  // --- WI-FI ---
  ipcMain.handle('wifi-scan', () => {
    return new Promise((resolve) => {
      exec('nmcli -t -f SSID,SIGNAL dev wifi', (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        const networks = stdout.split('\n')
          .filter(line => line.trim() !== '')
          .map(line => {
            const parts = line.split(':');
            return { ssid: parts[0], signal: parseInt(parts[1]) };
          })
          .filter(n => n.ssid);

        const unique = [];
        const map = new Map();
        for (const item of networks) {
          if (!map.has(item.ssid)) {
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
