import re

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

injection = '''
            const btnSync = document.createElement('div');
            btnSync.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>';
            btnSync.title = "Vincular Mando";
            btnSync.style.cssText = btnStyle + ' border-color: #22c55e;';

            floatMenu.appendChild(btnSync);
'''
content = content.replace('floatMenu.appendChild(btnUsb);', injection + 'floatMenu.appendChild(btnUsb);')

injection2 = '''
            const syncModal = document.createElement('div');
            syncModal.id = 'sync-modal';
            syncModal.style.cssText = 'display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.9); z-index: 20000; flex-direction: column; align-items: center; justify-content: center; font-family: sans-serif;';
            syncModal.innerHTML = \
                <div style="background: #1e293b; padding: 40px; border-radius: 15px; width: 50%; max-width: 500px; text-align: center; border: 2px solid #22c55e;">
                    <h2 style="color: white; margin-top: 0;">Vinculando Mando...</h2>
                    <p style="color: #94a3b8; font-size: 18px;">Por favor, presiona el botón SYNC en el Mando físico ahora para completar la vinculación.</p>
                    <div style="margin: 30px 0;">
                        <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" class="spin-anim"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path><path d="M2 12h20"></path></svg>
                    </div>
                    <button onclick="document.getElementById('sync-modal').style.display='none'" style="background:#ef4444; color:white; border:none; padding:15px 30px; font-size: 16px; border-radius:10px; cursor:pointer; font-weight:bold;">CERRAR</button>
                </div>
                <style>.spin-anim { animation: spin 2s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }</style>
            \;
            document.body.appendChild(syncModal);

            btnSync.onclick = () => {
                syncModal.style.display = 'flex';
                if(window.require) {
                    const { ipcRenderer } = window.require('electron');
                    ipcRenderer.send('trigger-sync');
                }
                setTimeout(() => { syncModal.style.display = 'none'; }, 15000);
            };
'''
content = content.replace('let mouseTimer;', injection2 + '\n            let mouseTimer;')

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)
