// Lógica del lado del cliente (Frontend)
const splashScreen = document.getElementById('splash-screen');
const scoreboard = document.getElementById('scoreboard');

const homeScoreEl = document.getElementById('home-score');
const guestScoreEl = document.getElementById('guest-score');
const mainClockEl = document.getElementById('main-clock');

// Estado Global
let isAdMode = true;

// ==========================================
// SISTEMA INTELIGENTE DE AUTO-ESCALADO
// ==========================================
function adjustScale() {
    // Dimensiones originales del diseño base (Full HD perfecto)
    const baseWidth = 1920;
    const baseHeight = 1080;
    
    // Calculamos el factor de escala para mantener la proporción exacta
    const scale = Math.min(window.innerWidth / baseWidth, window.innerHeight / baseHeight);
    
    // Aplicamos la escala al tablero. El translate(-50%, -50%) es porque está centrado absoluto en CSS.
    scoreboard.style.transform = `translate(-50%, -50%) scale(${scale})`;
    
    // Aplicamos escala a la pantalla de carga para que tampoco se deforme
    const logoContainer = document.querySelector('.logo-container');
    if(logoContainer) logoContainer.style.transform = `scale(${scale})`;
}

window.addEventListener('resize', adjustScale);
adjustScale();
// ==========================================

// Simular que el sistema carga y muestra el tablero (Animación)
setTimeout(() => {
    splashScreen.style.opacity = '0';
    setTimeout(() => {
        splashScreen.classList.add('hidden');
        if (!isAdMode) {
            scoreboard.classList.remove('hidden');
            document.getElementById('marquesina-container').style.display = 'block';
        } else {
            const adsContainer = document.getElementById('ads-container');
            if (adsContainer) {
                adsContainer.classList.remove('hidden');
                adsContainer.style.display = 'flex';
                if (typeof fetchAds === 'function') {
                    fetchAds().then(() => { if (typeof playNextAd === 'function') playNextAd(); });
                }
            }
        }
    }, 1500);
}, 2000);

// ==========================================
// ESTADO DEL PARTIDO (Reglas FIBA)
// ==========================================
let savedStateStr = localStorage.getItem('tablero_state');
let state = {
    score: { local: 0, visita: 0 },
    team_fouls: { local: 0, visita: 0 },
    clock: 600, // 10 minutos
    clock_running: false,
    period: 1,
    shot_clock: 24
};

try {
    if (savedStateStr) {
        let parsed = JSON.parse(savedStateStr);
        if (parsed.score) state.score = parsed.score;
        if (parsed.team_fouls) state.team_fouls = parsed.team_fouls;
        if (parsed.clock !== undefined) state.clock = parsed.clock;
        if (parsed.period !== undefined) state.period = parsed.period;
        if (parsed.shot_clock !== undefined) state.shot_clock = parsed.shot_clock;
    }
} catch(e) {}
state.clock_running = false;

// Persistir el estado cada 1 segundo (Para evitar prdida de datos si hay reinicios o cortes de luz)
setInterval(() => {
    localStorage.setItem('tablero_state', JSON.stringify(state));
}, 1000);

let clockInterval = null;

let prevState = { local: 0, visita: 0 };

function updateUI() {
    // Animación Pulse si hay cambio de puntos
    if (state.score.local !== prevState.local) {
        homeScoreEl.classList.remove('pulse-anim');
        void homeScoreEl.offsetWidth; // Forzar reflow
        homeScoreEl.classList.add('pulse-anim');
        prevState.local = state.score.local;
    }
    if (state.score.visita !== prevState.visita) {
        guestScoreEl.classList.remove('pulse-anim');
        void guestScoreEl.offsetWidth; // Forzar reflow
        guestScoreEl.classList.add('pulse-anim');
        prevState.visita = state.score.visita;
    }

    homeScoreEl.innerText = String(state.score.local).padStart(2, '0');
    guestScoreEl.innerText = String(state.score.visita).padStart(2, '0');
    
    // Auto-ajustar tamaño si llegan a 100 puntos
    homeScoreEl.classList.toggle('triple-digit', state.score.local >= 100);
    guestScoreEl.classList.toggle('triple-digit', state.score.visita >= 100);
    
    document.getElementById('home-team-fouls').innerText = state.team_fouls.local;
    document.getElementById('guest-team-fouls').innerText = state.team_fouls.visita;
    
    // Periodo
    document.getElementById('period').innerText = state.period;
    
    // Reloj 24s
    const shotClockEl = document.getElementById('shot-clock');
    if (shotClockEl) {
        shotClockEl.innerText = state.shot_clock;
        if (state.shot_clock <= 5) {
            shotClockEl.style.color = "#ff0000"; // Rojo intenso
            shotClockEl.style.textShadow = "0 0 20px #ff0000";
        } else {
            shotClockEl.style.color = ""; // Color original
            shotClockEl.style.textShadow = "";
        }
    }
    
    // Indicador Bonus
    document.getElementById('home-bonus').classList.toggle('active', state.team_fouls.local >= 5);
    document.getElementById('guest-bonus').classList.toggle('active', state.team_fouls.visita >= 5);
    
    const minutes = Math.floor(state.clock / 60);
    const seconds = state.clock % 60;
    mainClockEl.innerText = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

let targetTime = 0;

// Lógica del Reloj
function toggleClock() {
    state.clock_running = !state.clock_running;
    if (state.clock_running) {
        targetTime = Date.now() + (state.clock * 1000);
        clockInterval = setInterval(() => {
            const now = Date.now();
            if (now >= targetTime) {
                state.clock = 0;
                clearInterval(clockInterval);
                state.clock_running = false;
                // Aquí sonaría la chicharra
            } else {
                state.clock = Math.ceil((targetTime - now) / 1000);
            }
            updateUI();
        }, 100);
    } else {
        clearInterval(clockInterval);
    }
    updateUI();
}

function adjustTargetTime() {
    if (state.clock_running) {
        targetTime = Date.now() + (state.clock * 1000);
    }
}

// Interacción con Reloj y Periodo (Mouse)
function nextPeriod() {
    const CURRENT_MODE = process.env.MODE || 'tv';
    if (CURRENT_MODE === 'tv') return;
    state.period++;
    if (state.period > 4) state.period = 1; // Opcional: manejar Overtime
    
    // Resetear faltas de equipo al cambiar de periodo según FIBA
    state.team_fouls.local = 0;
    state.team_fouls.visita = 0;
    
    // Resetear reloj a 12 minutos
    state.clock = 720; 
    state.clock_running = false;
    clearInterval(clockInterval);
    
    updateUI();
}

function editClock() {
    const CURRENT_MODE = process.env.MODE || 'tv';
    if (CURRENT_MODE === 'tv') return;
    document.getElementById('clock-modal').style.display = 'block';
    document.getElementById('modal-backdrop').style.display = 'block';
    document.getElementById('clock-input').value = (state.clock / 60).toFixed(2);
    document.getElementById('clock-input').focus();
}

function closeClockModal() {
    document.getElementById('clock-modal').style.display = 'none';
    document.getElementById('modal-backdrop').style.display = 'none';
}

function saveClock() {
    const val = parseFloat(document.getElementById('clock-input').value);
    if (!isNaN(val)) {
        state.clock = Math.floor(val * 60);
        adjustTargetTime();
        updateUI();
    }
    closeClockModal();
}

// ==========================================
// CONTROLES DE TECLADO (PC)
// ==========================================
window.addEventListener('keydown', (e) => {
    const CURRENT_MODE = process.env.MODE || 'tv';
    if (CURRENT_MODE === 'tv') return;
    // Reloj
    if (e.code === 'Space') {
        toggleClock();
    }
    
    // Puntos Local (Teclas Q, W, E)
    if (e.key === 'q' || e.key === 'Q') state.score.local += 1;
    if (e.key === 'w' || e.key === 'W') state.score.local += 2;
    if (e.key === 'e' || e.key === 'E') state.score.local += 3;
    
    // Faltas Local (Tecla A)
    if (e.key === 'a' || e.key === 'A') { state.team_fouls.local++; updateUI(); }

    // Puntos Visita (Teclas P, O, I)
    if (e.key === 'p' || e.key === 'P') state.score.visita += 1;
    if (e.key === 'o' || e.key === 'O') state.score.visita += 2;
    if (e.key === 'i' || e.key === 'I') state.score.visita += 3;
    
    // Faltas Visita (Tecla L)
    if (e.key === 'l' || e.key === 'L') { state.team_fouls.visita++; updateUI(); }

    updateUI();
});

// ==========================================
// COMUNICACION CON EL HARDWARE (Mando ESP32)
// ==========================================
if (window.require) {
    const { ipcRenderer } = window.require('electron');
    
    // Escuchar el nuevo evento estructurado desde main.js
    let heartbeatTimeout;

    ipcRenderer.on('serial-command', (event, { cmd, team, player, value }) => {
        // --- 1. DETECCIÓN DE PRESENCIA (LATIDO) ---
        // Despertar tablero si estábamos en publicidad, porque el mando habló
        if (isAdMode) {
            isAdMode = false;
            clearTimeout(adTimeout);
            adVideo.pause();
            adsContainer.classList.add('hidden');
            adsContainer.style.display = 'none';
            scoreboard.classList.remove('hidden');
            document.getElementById('marquesina-container').style.display = 'block';
        }

        // Renovar el tiempo de vida (10 segundos sin señal = Mando apagado/lejos)
        clearTimeout(heartbeatTimeout);
        heartbeatTimeout = setTimeout(async () => {
            if (!isAdMode) {
                isAdMode = true;
                scoreboard.classList.add('hidden');
                document.getElementById('marquesina-container').style.display = 'none';
                adsContainer.classList.remove('hidden');
                adsContainer.style.display = 'flex';
                await fetchAds();
                playNextAd();
            }
        }, 10000);

        if (cmd === 254) return; // Si solo era un latido de presencia, no procesar el switch

        // Mapeo del protocolo de 5 bytes a las funciones que ya creamos
        
        // team: 1 (Local), 2 (Visita)
        const teamName = team === 1 ? 'local' : 'visita';

        // Convertir 'value' de uint8_t a signed int (complemento a 2)
        let signedValue = (value > 127) ? value - 256 : value;
        
        switch (cmd) {
            case 1: // Sumar o Restar Puntos
                state.score[teamName] += signedValue;
                if (state.score[teamName] < 0) state.score[teamName] = 0;
                break;
                
            case 2: // Falta Personal a un Jugador
                // Al estar deshabilitados los paneles de jugadores, solo sumamos equipo
                state.team_fouls[teamName] += signedValue;
                if (state.team_fouls[teamName] < 0) state.team_fouls[teamName] = 0;
                break;
                
            case 3: // Falta Directa de Equipo
                state.team_fouls[teamName] += signedValue;
                if (state.team_fouls[teamName] < 0) state.team_fouls[teamName] = 0;
                break;
                
            case 4: // Iniciar/Detener Reloj
                toggleClock();
                break;
                
            case 5: // Cambiar Periodo (+1 o -1)
                state.period += signedValue;
                if (state.period < 1) state.period = 1;
                if (state.period > 9) state.period = 9;
                break;
                
            case 6: // Chicharra
                console.log("CHICHARRA (Bocina)!");
                break;
                
            case 7: // Set Time (team = minutes, value = seconds)
                state.clock = (team * 60) + value;
                if (state.clock < 0) state.clock = 0;
                adjustTargetTime();
                break;
                
            case 8: // Add/Subtract Time con redondeo
                if (signedValue > 0) {
                    // Sube al siguiente minuto redondo.
                    state.clock = (Math.floor(state.clock / 60) + 1) * 60;
                } else if (signedValue < 0) {
                    // Baja al minuto redondo anterior.
                    state.clock = (Math.ceil(state.clock / 60) - 1) * 60;
                }
                if (state.clock < 0) state.clock = 0;
                adjustTargetTime();
                break;
                
            case 9: // FULL RESET DEL PARTIDO
                state.score.local = 0;
                state.score.visita = 0;
                state.team_fouls.local = 0;
                state.team_fouls.visita = 0;
                state.period = 1;
                state.clock = 600;
                state.clock_running = false;
                state.shot_clock = 24;
                adjustTargetTime();
                break;
                
            case 10: // ACTUALIZACIÓN DE RELOJ DE POSESIÓN (24S)
                state.shot_clock = value;
                break;

            case 200: { // REPORTE DE ESTADO DE CONEXION (Unicast)
                // team = vinculados, player = activos
                const lblVinculadas = document.getElementById('dash-vinculadas');
                const lblOnline = document.getElementById('dash-online');
                const ledStatus = document.getElementById('dash-status-led');
                
                if (lblVinculadas && lblOnline && ledStatus) {
                    lblVinculadas.innerText = `${team}/18`;
                    lblOnline.innerText = player;
                    
                    if (player > 0) {
                        ledStatus.style.background = '#22c55e'; // Verde
                        ledStatus.style.boxShadow = '0 0 8px #22c55e';
                    } else if (team > 0) {
                        ledStatus.style.background = '#ef4444'; // Rojo (desconectado)
                        ledStatus.style.boxShadow = '0 0 8px #ef4444';
                    } else {
                        ledStatus.style.background = '#f59e0b'; // Naranja (ninguno vinculado)
                        ledStatus.style.boxShadow = '0 0 8px #f59e0b';
                    }
                }
                
                // Mostrar u Ocultar Reloj 24s
                const shotClockEl = document.getElementById('shot-clock');
                const shotClockLabel = shotClockEl ? shotClockEl.previousElementSibling : null;
                if (shotClockEl && shotClockLabel) {
                    if (value === 1) { // has_24s
                        shotClockEl.style.display = 'block';
                        shotClockLabel.style.display = 'block';
                    } else {
                        shotClockEl.style.display = 'none';
                        shotClockLabel.style.display = 'none';
                    }
                }
                // Evitamos que updateUI() haga algo extra si es solo status
                return;
            }
                
            default:
                console.log("Comando de Hardware desconocido:", cmd);
                break;
        }
        
        // Refrescar la pantalla
        updateUI();
    });

    // ==========================================
    // MODO PUBLICIDAD Y SUPABASE
    // ==========================================
    const { createClient } = require('@supabase/supabase-js');
    const supabaseUrl = 'https://kvwwrvjlovrmdaizyzcw.supabase.co';
    const supabaseKey = 'sb_publishable_kQIWWdlfNANZ4uqSU1VQ-A_yF_T-Na9';
    const supabase = createClient(supabaseUrl, supabaseKey);

    const adsContainer = document.getElementById('ads-container');
    const adVideo = document.getElementById('ad-video');
    const adImage = document.getElementById('ad-image');
    const adLoading = document.getElementById('ad-loading');
    
    let adsList = [];
    let currentAdIndex = 0;
    let adTimeout = null;

    async function fetchAds() {
        let supabaseAds = [];
        let localAds = [];

        // 1. Obtener de la Nube (Vercel/Supabase)
        if (navigator.onLine) {
            try {
                                                // Traer Sponsors (Marquesina din�mica)
                const { data: setts } = await supabase.from('system_settings').select('marquesina').eq('id', 1).single();
                const isGlobalEnabled = !setts || setts.marquesina !== 'false';
                
                const { data: sponsorsData } = await supabase.from('sponsors').select('*').eq('activo', true).order('orden', { ascending: true });
                const marqContainer = document.getElementById('marquesina-container');
                const marqText = document.getElementById('marquesina-text');
                
                if (sponsorsData && sponsorsData.length > 0 && !isAdMode && isGlobalEnabled) {
                    marqContainer.style.display = 'block';
                    let htmlContent = '';
                    sponsorsData.forEach(s => {
                        htmlContent += '<span class="sponsor-item">';
                        if (s.logo_url) {
                            htmlContent += '<img src="' + s.logo_url + '" class="sponsor-logo" /> ';
                        }
                        htmlContent += '<span class="sponsor-text">' + s.texto + '</span>';
                        htmlContent += '</span><span class="sponsor-separator"> &diams; </span>';
                    });
                    marqText.innerHTML = htmlContent + htmlContent + htmlContent;
                } else {
                    marqContainer.style.display = 'none';
                }

                // Traer Publicidades
                const { data, error } = await supabase
                    .from('publicidad')
                    .select('*')
                    .eq('activo', true)
                    .order('orden', { ascending: true });
                    
                if (!error && data) supabaseAds = data;
            } catch (err) {
                console.error("Error fetching ads:", err);
            }
        } else {
            console.warn("Sin conexión: Saltando Supabase");
        }

        // 2. Obtener locales (Los que copiaste con el USB)
        try {
            const adsFolder = await ipcRenderer.invoke('get-ads-folder');
            const files = await ipcRenderer.invoke('list-files', adsFolder);
            localAds = files.map(f => {
                const isVideo = !!f.name.match(/\.(mp4)$/i);
                return {
                    tipo: isVideo ? 'video' : 'imagen',
                    url_archivo: 'file:///' + f.path.replace(/\\/g, '/'),
                    duracion_segundos: 10
                };
            });
        } catch (err) {
            console.error("Error locales:", err);
        }

        adsList = [...supabaseAds, ...localAds];
    }

    function playNextAd() {
        if (!isAdMode) return;
        if (adsList.length === 0) {
            adLoading.style.display = 'block';
            adVideo.style.opacity = 0;
            adImage.style.opacity = 0;
            adTimeout = setTimeout(() => {
                fetchAds().then(playNextAd);
            }, 5000);
            return;
        }

        adLoading.style.display = 'none';
        const ad = adsList[currentAdIndex];
        currentAdIndex = (currentAdIndex + 1) % adsList.length;

        clearTimeout(adTimeout);
        adVideo.onended = null;
        adVideo.onerror = null;

        // Desvanecer el actual
        adVideo.style.opacity = 0;
        adImage.style.opacity = 0;

        setTimeout(() => {
            if (ad.tipo === 'video') {
                adImage.style.display = 'none';
                adVideo.style.display = 'block';
                adVideo.src = ad.url_archivo;
                
                adVideo.onended = () => playNextAd();
                adVideo.onerror = () => playNextAd();

                adVideo.play().then(() => {
                    adVideo.style.opacity = 1;
                }).catch(e => {
                    console.log("Video auto-play prevenido", e);
                    adTimeout = setTimeout(playNextAd, 5000);
                });
                
            } else {
                adVideo.style.display = 'none';
                adVideo.pause();
                
                adImage.style.display = 'block';
                adImage.src = ad.url_archivo;
                
                // Mostrar solo cuando cargue para que la transición sea limpia
                adImage.onload = () => {
                    adImage.style.opacity = 1;
                };
                
                const durationMs = (ad.duracion_segundos || 10) * 1000;
                adTimeout = setTimeout(playNextAd, durationMs);
            }
        }, 500); // Esperar medio segundo al desvanecimiento antes de cargar la próxima
    }

    ipcRenderer.on('mando-status', async (event, { connected }) => {
        // Solo reaccionamos si se desconecta físicamente el USB
        if (!connected) {
            // MODO PUBLICIDAD (Mando ausente)
            if (!isAdMode) {
                isAdMode = true;
                scoreboard.classList.add('hidden');
                document.getElementById('marquesina-container').style.display = 'none';
                adsContainer.classList.remove('hidden');
                adsContainer.style.display = 'flex';
                await fetchAds();
                playNextAd();
            }
        }
    });

    
    // Auto-actualizar Sponsors cada 30 segundos
    setInterval(async () => {
        if (navigator.onLine) {
            try {
                const { data: sponsorsData } = await supabase.from('sponsors').select('*').eq('activo', true).order('orden', { ascending: true });
                const marqContainer = document.getElementById('marquesina-container');
                const marqText = document.getElementById('marquesina-text');
                
                if (sponsorsData && sponsorsData.length > 0) {
                    marqContainer.style.display = 'block';
                    let htmlContent = '';
                    sponsorsData.forEach(s => {
                        htmlContent += '<span class="sponsor-item">';
                        if (s.logo_url) {
                            htmlContent += '<img src="' + s.logo_url + '" class="sponsor-logo" /> ';
                        }
                        htmlContent += '<span class="sponsor-text">' + s.texto + '</span>';
                        htmlContent += '</span><span class="sponsor-separator"> ♦ </span>';
                    });
                    marqText.innerHTML = htmlContent + htmlContent + htmlContent;
                } else {
                    marqContainer.style.display = 'none';
                }
            } catch(e){}
        }
    }, 30000);

    // Iniciar publicidad si arrancamos en ese modo
    if (isAdMode) {
        fetchAds().then(() => { if (typeof playNextAd === 'function') playNextAd(); });
    }
}

// Configuración visual según el MODO (Mando vs TV)
const appMode = (typeof process !== 'undefined' && process.env && process.env.MODE) ? process.env.MODE : 'tv';
if (appMode === 'mando') {
    const dashboard = document.getElementById('xbox-dashboard');
    if (dashboard) dashboard.classList.remove('hidden');
}

updateUI();




