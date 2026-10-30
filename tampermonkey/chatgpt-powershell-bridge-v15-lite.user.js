// ==UserScript==
// @name         ChatGPT PowerShell Bridge — v15 Lite Multi-Conversation
// @namespace    apexscorpio.local
// @version      2026.10.30.15.5.19
// @description  Execução autónoma de jobs PowerShell (PSB_JOB_V3 + auto-detetor) diretamente no chat, sem downloads manuais nem copy-paste.
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @noframes
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @connect      127.0.0.1
// @connect      chatgpt.com
// @connect      chat.openai.com
// @connect      raw.githubusercontent.com
// @connect      oaiusercontent.com
// @connect      files.oaiusercontent.com
// @connect      *
// @downloadURL  https://raw.githubusercontent.com/ApexScorpio/lpx-powershell-runtime/main/tampermonkey/chatgpt-powershell-bridge-v15-lite.user.js
// @updateURL    https://raw.githubusercontent.com/ApexScorpio/lpx-powershell-runtime/main/tampermonkey/chatgpt-powershell-bridge-v15-lite.user.js
// ==/UserScript==

(() => {
    'use strict';

    if (window.top !== window.self) {
        return;
    }


    const VERSION = '15.5.19';
    const BRIDGE_URL = 'http://127.0.0.1:17351';
    const TOKEN_KEY = 'lpxPsb15:token';
    const CLAIMS_KEY = 'lpxPsb15:claims';
    const HANDLED_PREFIX = 'lpxPsb15:handled:';
    const TAB_ID_KEY = 'lpxPsb15:tabId';
    const ENABLED_KEY = 'lpxPsb15:enabled';
    const BOUND_CONVERSATION_KEY = 'lpxPsb15:conversation';
    const PROMPT_SENT_PREFIX = 'lpxPsb15:protocolPrompt:';
    const PANEL_GEOMETRY_KEY = 'lpxPsb15:panelGeometry';
    const PANEL_COLLAPSED_KEY = 'lpxPsb15:panelCollapsed';
    const FILEID_HANDSHAKE_PREFIX = 'lpxPsb15:fileIdHandshake:';
    const CLAIM_TTL_MS = 10 * 60 * 1000;
    const INFLIGHT_PREFIX = 'lpxPsb15:inflight:';
    const UNRESOLVED_PREFIX = 'lpxPsb15:unresolved:';
    const POLL_MS = 750;
    const SETTLE_MS = 900;
    const HEARTBEAT_VISIBLE_MS = 7000;
    const HEARTBEAT_HIDDEN_MS = 18000;
    const PUBLISH_WAIT_MS = 90 * 1000;

    let candidateAssistant = null;
    let settleTimer = 0;
    let activeJobId = '';
    let activeManifest = null;
    let sendingMessage = false;
    let deliveryRecoveryTimer = 0;
    let deliveryRecoveryBusy = false;
    let lastAttachmentDiagnostic = '';
    let observer = null;
    let observerRoot = null;
    let lastStatus = 'A iniciar…';
    const processingJobIds = new Set();
    let apiProbeTimer = 0;
    let apiProbeDeadline = 0;
    let apiProbeStartedAt = 0;
    let apiProbeConversation = '';
    let apiProbeBusy = false;
    let apiProbeEpoch = 0;
    let heartbeatTimer = 0;
    let heartbeatBusy = false;

    function randomId() {
        return globalThis.crypto?.randomUUID?.()
            || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }

    function tabId() {
        let value = sessionStorage.getItem(TAB_ID_KEY);

        if (!value) {
            value = `tab-${randomId()}`;
            sessionStorage.setItem(TAB_ID_KEY, value);
        }

        return value;
    }

    const TAB_ID = tabId();
    const INSTANCE_ID = `instance-${randomId()}`;

    const RUNTIME_MARKER_ID =
        'lpx-psb15-runtime-owner';

    const existingRuntimeMarker =
        document.getElementById(
            RUNTIME_MARKER_ID
        );

    if (existingRuntimeMarker) {
        console.info(
            '[LPX PSB] Duplicate runtime ignored. Owner: ' +
            String(
                existingRuntimeMarker.dataset.instanceId ||
                'unknown'
            )
        );

        return;
    }

    const runtimeMarker =
        document.createElement('meta');

    runtimeMarker.id = RUNTIME_MARKER_ID;
    runtimeMarker.dataset.instanceId =
        INSTANCE_ID;
    runtimeMarker.dataset.version =
        VERSION;

    (
        document.head ||
        document.documentElement
    ).appendChild(runtimeMarker);

    const startupClaims = GM_getValue(
        CLAIMS_KEY,
        {}
    );

    if (
        startupClaims &&
        typeof startupClaims === 'object'
    ) {
        const startupConversation =
            conversationId();

        const startupNow =
            Date.now();

        let claimsChanged = false;

        for (
            const [jobId, claimValue] of
            Object.entries(startupClaims)
        ) {
            if (!claimValue) {
                delete startupClaims[jobId];
                claimsChanged = true;
                continue;
            }

            const sameTab =
                claimValue.tabId === TAB_ID;

            const sameConversation =
                claimValue.conversation ===
                startupConversation;

            const claimedAt =
                Number(
                    claimValue.claimedAt || 0
                );

            const orphanedSameConversation =
                sameConversation &&
                (
                    claimedAt <= 0 ||
                    startupNow - claimedAt >
                        5000
                );

            if (
                sameTab ||
                orphanedSameConversation
            ) {
                delete startupClaims[jobId];
                claimsChanged = true;
            }
        }

        if (claimsChanged) {
            GM_setValue(
                CLAIMS_KEY,
                startupClaims
            );
        }
    }


    function conversationId() {
        const path = location.pathname.replace(/\/+$/, '') || '/';
        const direct = path.match(/(?:^|\/)c\/([A-Za-z0-9-]+)/);

        if (direct) {
            return `c:${direct[1]}`;
        }

        const project = path.match(/(?:^|\/)g\/([^/]+)(?:\/c\/([^/]+))?/);

        if (project) {
            return project[2]
                ? `g:${project[1]}:c:${project[2]}`
                : `g:${project[1]}:${path}`;
        }

        return `path:${path}`;
    }

    function simpleHash(text) {
        let hash = 2166136261;

        for (let index = 0; index < text.length; index++) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }

        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    function handledKey() {
        return `${HANDLED_PREFIX}${simpleHash(conversationId())}`;
    }

    function handledSet() {
        const value = GM_getValue(handledKey(), []);
        return new Set(Array.isArray(value) ? value : []);
    }

    function markHandled(id) {
        const set = handledSet();
        set.add(id);
        GM_setValue(handledKey(), [...set].slice(-200));
    }

    function isHandled(id) {
        return handledSet().has(id);
    }

    function cleanClaims() {
        const now = Date.now();
        const current = GM_getValue(CLAIMS_KEY, {});
        const clean = {};

        if (current && typeof current === 'object') {
            for (const [key, value] of Object.entries(current)) {
                if (value && Number(value.expiresAt) > now) {
                    clean[key] = value;
                }
            }
        }

        GM_setValue(CLAIMS_KEY, clean);
        return clean;
    }

    function inflightKey() {
        return INFLIGHT_PREFIX + simpleHash(conversationId());
    }

    function getInflight() {
        const value = GM_getValue(inflightKey(), null);
        return value && typeof value === 'object' && value.conversation === conversationId()
            ? value : null;
    }

    function saveInflight(id, manifest, phase = 'submitted') {
        GM_setValue(inflightKey(), {
            jobId: String(id),
            conversation: conversationId(),
            manifest: {
                protocol: String(manifest?.protocol || 'PSB_JOB_V3'),
                jobId: String(manifest?.jobId || id),
                purpose: String(manifest?.purpose || '')
            },
            phase,
            updatedAt: Date.now()
        });
    }

    function updateDeliveryState(id, phase, patch = {}) {
        const prior = getInflight();
        if (!prior || prior.jobId !== String(id)) return;
        GM_setValue(inflightKey(), {
            ...prior,
            ...patch,
            phase,
            updatedAt: Date.now()
        });
    }

    function clearInflight(id) {
        const value = getInflight();
        if (value && value.jobId === String(id)) {
            GM_deleteValue(inflightKey());
        }
    }


    function unresolvedKey() {
        return UNRESOLVED_PREFIX + simpleHash(conversationId());
    }

    function unresolvedJobs() {
        const saved = GM_getValue(unresolvedKey(), []);
        return Array.isArray(saved) ? saved : [];
    }

    function archiveUnresolvedJob(id, reason, httpStatus) {
        const jobId = String(id || '').trim();
        if (!jobId) return;
        const records = unresolvedJobs();
        if (records.some(row => row?.jobId === jobId)) return;
        const saved = getInflight();
        // Guardar apenas metadados, sem comandos, credenciais ou tokens.
        records.push({
            jobId,
            conversation: conversationId(),
            purpose: String(saved?.manifest?.purpose || ''),
            previousPhase: String(saved?.phase || ''),
            reason: String(reason),
            httpStatus: Number(httpStatus || 0),
            archivedAt: new Date().toISOString(),
            resultJsonUrl: String(saved?.resultJsonUrl || '')
        });
        GM_setValue(unresolvedKey(), records);
    }

    function stopMissingJob(id) {
        archiveUnresolvedJob(id, 'server_job_not_found_after_retries', 404);
        // Marca apenas como não-reexecutável pela automatização.
        // NÃO declarar execução/conclusão do comando.
        markHandled(id);
        releaseClaim(id);
        clearInflight(id);
        if (activeJobId === id) {
            activeJobId = '';
            activeManifest = null;
        }
        setStatus(`Job ${id}: HTTP 404 confirmado. Servidor não conhece este job. Referência preservada; sem reexecução.`);
    }

    async function confirmsMissingJob(id, repeats = 2) {
        // A primeira resposta 404 veio da chamada original. Exigir mais
        // leituras independentes evita confundir falha transitória com perda.
        for (let attempt = 0; attempt < repeats; attempt++) {
            await wait(1200 * (attempt + 1));
            let response;
            try {
                response = await request({
                    method: 'GET',
                    url: `${BRIDGE_URL}/job/${encodeURIComponent(id)}?metadata=1&_=${Date.now()}`,
                    headers: { 'X-Bridge-Token': token(), 'Cache-Control': 'no-cache' },
                    timeout: 8000
                });
            } catch {
                return false;
            }
            if (Number(response.status) !== 404) return false;
        }
        return true;
    }

    function claim(id) {
        const claims = cleanClaims();
        const existing = claims[id];
        const now = Date.now();
        // Não roubar um job a outra aba, mesmo que seja da mesma conversa.
        if (existing && existing.instanceId !== INSTANCE_ID) {
            return false;
        }
        claims[id] = {
            tabId: TAB_ID,
            instanceId: INSTANCE_ID,
            conversation: conversationId(),
            claimedAt: existing?.claimedAt || now,
            expiresAt: now + CLAIM_TTL_MS
        };
        GM_setValue(CLAIMS_KEY, claims);
        return true;
    }

    function renewClaim(id) {
        const claims = cleanClaims();
        if (claims[id]?.instanceId === INSTANCE_ID) {
            claims[id].expiresAt = Date.now() + CLAIM_TTL_MS;
            GM_setValue(CLAIMS_KEY, claims);
        }
    }

    function releaseClaim(id) {
        const claims = cleanClaims();
        const existing = claims[id];

        if (
            existing?.instanceId === INSTANCE_ID ||
            (
                !existing?.instanceId &&
                existing?.tabId === TAB_ID
            )
        ) {
            delete claims[id];
            GM_setValue(CLAIMS_KEY, claims);
        }
    }

    function enabled() {
        return sessionStorage.getItem(ENABLED_KEY) === '1'
            && sessionStorage.getItem(BOUND_CONVERSATION_KEY) === conversationId();
    }

    function setEnabled(value) {
        sessionStorage.setItem(ENABLED_KEY, value ? '1' : '0');

        if (value) {
            sessionStorage.setItem(BOUND_CONVERSATION_KEY, conversationId());
        } else {
            sessionStorage.removeItem(BOUND_CONVERSATION_KEY);
        }

        if (!value) stopApiProbe();
        if (value) {
            scheduleHeartbeat(1200);
            if (getInflight()) scheduleDeliveryRecovery(2000);
        } else {
            clearTimeout(heartbeatTimer);
            heartbeatTimer = 0;
        }
        render();
    }

    function protocolPromptKey() {
        return `${PROMPT_SENT_PREFIX}${simpleHash(conversationId())}`;
    }

    function protocolPromptText() {
        return [
            'LPX_POWERSHELL_BRIDGE_PROTOCOL_V15_5_7',
            '',
            `Esta conversa está ligada à LPX PowerShell Bridge v${VERSION}.`,
            '',
            'Sempre que for necessário executar PowerShell, coloca o comando completo no chat dentro de um bloco de código powershell com o formato autónomo PSB_JOB_V3:',
            '',
            '```powershell',
            '# PSB_JOB_V3',
            '# jobId: PSB-AAAAMMDD-HHMM-DESCRICAO-001',
            '# purpose: objetivo claro e curto',
            '# O teu script PowerShell completo aqui...',
            '```',
            '',
            'REGRAS OBRIGATÓRIAS:',
            '1. O comando PowerShell tem de estar completo dentro do bloco de código powershell com o cabeçalho # PSB_JOB_V3.',
            '2. Nunca cries ficheiros para download, anexos nem links de download. A execução é 100% autónoma.',
            '3. Não uses Base64 nem SHA-256 no chat. O código PowerShell deve estar legível e diretamente no bloco.',
            '4. Usa sempre um jobId real e único no formato PSB-AAAAMMDD-HHMM-DESCRICAO-001, substituindo AAAAMMDD, HHMM e DESCRICAO por valores reais.',
            '5. A bridge deteta o job no chat automaticamente, executa-o no PowerShell local da máquina e envia o resultado de volta de forma 100% autónoma.',
            '6. Quando receberes PSBRIDGE_RESULT_V2, lê primeiro o URL result e continua o desenvolvimento ou diagnóstico autonomamente.',
            '7. NUNCA peças ao utilizador para copiar ou colar comandos no terminal. O utilizador não executa nada manualmente; a bridge executa o bloco automaticamente.',
            '',
            'Confirma estas regras silenciosamente e gera os próximos jobs estritamente em PSB_JOB_V3 sem downloads nem instruções para copiar.'
        ].join('\n');
    }

    function composerText() {
        const editor = composer();

        if (!editor) {
            return '';
        }

        if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
            return String(editor.value || '').trim();
        }

        return String(editor.innerText || editor.textContent || '').trim();
    }

    async function sendProtocolPrompt(force = false) {
        const key = protocolPromptKey();

        if (!force && GM_getValue(key, false)) {
            setStatus('Ativa. O protocolo v15 já foi enviado ao ChatGPT nesta conversa.');
            return;
        }

        if (composerText()) {
            setStatus('Protocolo pendente: a caixa de mensagem contém texto. Limpa-a e carrega em Enviar protocolo.');
            return;
        }

        setStatus('A enviar ao ChatGPT o protocolo autónomo PSB_JOB_V3…');
        await sendMessage(protocolPromptText());
        GM_setValue(key, true);
        setStatus('Protocolo PSB_JOB_V3 enviado. A bridge está pronta e autónoma.');
    }
    function token() {
        return String(GM_getValue(TOKEN_KEY, '')).trim();
    }

    function authHeaders() {
        return {
            'X-Bridge-Token': token(),
            'Content-Type': 'application/json; charset=UTF-8',
            'Cache-Control': 'no-cache'
        };
    }

    function request(options) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                ...options,
                onload: resolve,
                onerror: () => reject(new Error('Não foi possível contactar o endereço pedido.')),
                ontimeout: () => reject(new Error('O pedido expirou.'))
            });
        });
    }

    function parseJson(response) {
        try {
            return JSON.parse(response.responseText || '{}');
        } catch {
            return {
                ok: false,
                error: response.responseText || `HTTP ${response.status}`
            };
        }
    }

    function setStatus(text) {
        lastStatus = String(text);
        const node = document.querySelector('#lpx-psb15-status');

        if (node) {
            node.textContent = lastStatus;
        }
    }

    const style = document.createElement('style');
    style.textContent = `
        #lpx-psb15 {
            position: fixed;
            right: 16px;
            bottom: 16px;
            z-index: 2147483647;
            width: 380px;
            min-width: 300px;
            min-height: 118px;
            max-width: calc(100vw - 20px);
            max-height: calc(100vh - 20px);
            padding: 10px;
            resize: both;
            overflow: auto;
            border: 1px solid #46505c;
            border-radius: 10px;
            background: #11151a;
            color: #f1f5f9;
            box-shadow: 0 12px 36px rgba(0,0,0,.5);
            font: 12px/1.35 Arial, sans-serif;
        }

        #lpx-psb15-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
            cursor: move;
            user-select: none;
            touch-action: none;
        }

        #lpx-psb15-title {
            flex: 1;
            font-weight: 700;
        }

        #lpx-psb15-window-actions {
            display: flex;
            gap: 4px;
        }

        #lpx-psb15-window-actions button {
            width: 25px;
            height: 25px;
            padding: 0;
            font-size: 14px;
        }

        #lpx-psb15.collapsed {
            height: auto !important;
            min-height: 0;
            resize: none;
            overflow: hidden;
        }

        #lpx-psb15.collapsed #lpx-psb15-status,
        #lpx-psb15.collapsed #lpx-psb15-actions {
            display: none;
        }

        #lpx-psb15-status {
            min-height: 34px;
            color: #b9d8f5;
            overflow-wrap: anywhere;
        }

        #lpx-psb15-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            margin-top: 8px;
        }

        #lpx-psb15 button {
            padding: 6px 8px;
            border: 0;
            border-radius: 6px;
            cursor: pointer;
            background: #dbe5ef;
            color: #111;
            font-size: 11px;
            font-weight: 700;
        }

        #lpx-psb15 button.primary { background: #8ee59f; }
        #lpx-psb15 button.danger { background: #ff9696; }
        #lpx-psb15 button.warning { background: #ffd166; }
        #lpx-psb15 button.admin { background: #d3a7ff; }
    `;
    document.documentElement.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'lpx-psb15';
    document.documentElement.appendChild(panel);

    function button(label, handler, className = '') {
        const node = document.createElement('button');
        node.type = 'button';
        node.textContent = label;
        node.className = className;
        node.addEventListener('click', handler);
        return node;
    }


    function panelIsCollapsed() {
        return Boolean(GM_getValue(PANEL_COLLAPSED_KEY, false));
    }

    function applyPanelCollapsedState() {
        panel.classList.toggle('collapsed', panelIsCollapsed());

        const buttonNode = panel.querySelector('#lpx-psb15-collapse');
        if (buttonNode) {
            buttonNode.textContent = panelIsCollapsed() ? '+' : '−';
            buttonNode.title = panelIsCollapsed() ? 'Expandir' : 'Minimizar';
        }
    }

    function togglePanelCollapsed() {
        GM_setValue(PANEL_COLLAPSED_KEY, !panelIsCollapsed());
        render();
    }

    function panelGeometry() {
        const value = GM_getValue(PANEL_GEOMETRY_KEY, null);
        return value && typeof value === 'object' ? value : {};
    }

    function savePanelGeometry() {
        if (panelIsCollapsed()) {
            return;
        }

        const rectangle = panel.getBoundingClientRect();
        GM_setValue(PANEL_GEOMETRY_KEY, {
            left: rectangle.left,
            top: rectangle.top,
            width: rectangle.width,
            height: rectangle.height
        });
    }

    function applyPanelGeometry() {
        const value = panelGeometry();

        if (Number.isFinite(value.width)) {
            panel.style.width = Math.max(300, value.width) + 'px';
        }

        if (Number.isFinite(value.height)) {
            panel.style.height = Math.max(118, value.height) + 'px';
        }

        if (Number.isFinite(value.left) && Number.isFinite(value.top)) {
            const maximumLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
            const maximumTop = Math.max(0, window.innerHeight - panel.offsetHeight);

            panel.style.left = Math.min(Math.max(0, value.left), maximumLeft) + 'px';
            panel.style.top = Math.min(Math.max(0, value.top), maximumTop) + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        }
    }

    function installPanelInteractions() {
        applyPanelGeometry();

        panel.addEventListener('pointerdown', event => {
            const header = event.target.closest('#lpx-psb15-header');

            if (!header || event.target.closest('button')) {
                return;
            }

            event.preventDefault();

            const rectangle = panel.getBoundingClientRect();
            const offsetX = event.clientX - rectangle.left;
            const offsetY = event.clientY - rectangle.top;

            panel.style.left = rectangle.left + 'px';
            panel.style.top = rectangle.top + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';

            const move = moveEvent => {
                const maximumLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
                const maximumTop = Math.max(0, window.innerHeight - panel.offsetHeight);

                panel.style.left = Math.min(
                    Math.max(0, moveEvent.clientX - offsetX),
                    maximumLeft
                ) + 'px';

                panel.style.top = Math.min(
                    Math.max(0, moveEvent.clientY - offsetY),
                    maximumTop
                ) + 'px';
            };

            const finish = () => {
                window.removeEventListener('pointermove', move, true);
                window.removeEventListener('pointerup', finish, true);
                window.removeEventListener('pointercancel', finish, true);
                savePanelGeometry();
            };

            window.addEventListener('pointermove', move, true);
            window.addEventListener('pointerup', finish, true);
            window.addEventListener('pointercancel', finish, true);
        }, true);

        if (globalThis.ResizeObserver) {
            const resizeObserver = new ResizeObserver(() => {
                window.clearTimeout(panel.__lpxResizeTimer);
                panel.__lpxResizeTimer = window.setTimeout(savePanelGeometry, 250);
            });

            resizeObserver.observe(panel);
        }

        window.addEventListener('resize', () => {
            applyPanelGeometry();
            savePanelGeometry();
        });
    }

    function render() {
        panel.replaceChildren();

        const title = document.createElement('div');
        title.id = 'lpx-psb15-title';
        title.textContent = `PowerShell Bridge v${VERSION} · ${enabled() ? 'ATIVA' : 'PARADA'}`;

        const header = document.createElement('div');
        header.id = 'lpx-psb15-header';

        const windowActions = document.createElement('div');
        windowActions.id = 'lpx-psb15-window-actions';

        const collapseButton = button(panelIsCollapsed() ? '+' : '−', togglePanelCollapsed);
        collapseButton.id = 'lpx-psb15-collapse';
        collapseButton.title = panelIsCollapsed() ? 'Expandir' : 'Minimizar';

        const closeButton = button('×', () => {
            void shutdownBridge();
        }, 'danger');
        closeButton.title = 'Fechar e desligar a bridge';

        windowActions.append(collapseButton, closeButton);
        header.append(title, windowActions);

        const status = document.createElement('div');
        status.id = 'lpx-psb15-status';
        status.textContent = lastStatus;

        const actions = document.createElement('div');
        actions.id = 'lpx-psb15-actions';

        actions.append(
            enabled()
                ? button('Parar nesta aba', () => {
                    setEnabled(false);
                    setStatus('Autonomia parada nesta aba.');
                }, 'danger')
                : button('Ativar nesta aba', async () => {
                    if (!token()) {
                        configureToken();
                    }

                    if (!token()) {
                        return;
                    }

                    baselineCurrentAssistant();
                    setEnabled(true);
                    setStatus('Bridge ativa. Protocolo existente preservado; sem reenvio automático.');
                    scheduleDeliveryRecovery(1200);
                }, 'primary'),

            button('Executar último', () => {
                void inspectCandidate(true);
            }, 'warning'),

            button('Enviar protocolo', () => {
                void sendProtocolPrompt(true);
            }),

            button('Token', configureToken),

            button('Testar', () => {
                void healthCheck(false);
            }),

            button('Cancelar', () => {
                void cancelActive();
            }, 'danger'),

            button('ADMIN', () => {
                void setAdmin();
            }, 'admin'),

            button('Mostrar PowerShell', () => {
                void showPowerShell();
            })
        );

        panel.append(header, status, actions);
        applyPanelCollapsedState();
    }

    function configureToken() {
        const value = window.prompt('Cola o token da PowerShell Bridge:', token());

        if (value === null) {
            return;
        }

        const clean = value.trim();

        if (!/^[A-Fa-f0-9]{64}$/.test(clean)) {
            window.alert('O token deve ter 64 caracteres hexadecimais.');
            return;
        }

        GM_setValue(TOKEN_KEY, clean);
        setStatus('Token guardado.');
        void healthCheck(false);
    }

    async function healthCheck(quiet = true) {
        try {
            const response = await request({
                method: 'GET',
                url: `${BRIDGE_URL}/health?_=${Date.now()}`,
                timeout: 5000
            });

            const data = parseJson(response);

            if (!data.ok) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }

            if (!quiet) {
                setStatus(
                    `Bridge pronta · protocolo ${data.protocol} · modo ${String(data.mode || '').toUpperCase()} · ` +
                    `${data.runningJobs || 0}/${data.maxConcurrentJobs || 1} jobs · GitHub ${data.githubConfigured ? 'OK' : 'não configurado'}.`
                );
            }

            return data;
        } catch (error) {
            if (!quiet) {
                setStatus(`Bridge indisponível: ${error.message}`);
            }

            throw error;
        }
    }


    async function rememberConversation() {
        if (!token()) {
            return;
        }

        try {
            await request({
                method: 'POST',
                url: BRIDGE_URL + '/remember-conversation',
                headers: authHeaders(),
                data: JSON.stringify({ url: location.href }),
                timeout: 5000
            });
        } catch {
            // Best effort.
        }
    }

    async function showPowerShell() {
        try {
            const response = await request({
                method: 'POST',
                url: BRIDGE_URL + '/show-console',
                headers: authHeaders(),
                data: '{}',
                timeout: 8000
            });

            const data = parseJson(response);

            if (!data.ok) {
                throw new Error(data.error || ('HTTP ' + response.status));
            }

            setStatus('Janela PowerShell aberta. Os comandos e resultados locais serão mostrados em tempo real.');
        } catch (error) {
            setStatus('Não foi possível abrir o PowerShell: ' + error.message);
        }
    }

    async function shutdownBridge() {
        if (!window.confirm('Fechar o painel e desligar completamente a PowerShell Bridge?')) {
            return;
        }

        try {
            setEnabled(false);

            const response = await request({
                method: 'POST',
                url: BRIDGE_URL + '/shutdown',
                headers: authHeaders(),
                data: '{}',
                timeout: 8000
            });

            const data = parseJson(response);

            if (!data.ok) {
                throw new Error(data.error || ('HTTP ' + response.status));
            }

            setStatus('Bridge desligada.');
            window.setTimeout(() => panel.remove(), 350);
        } catch (error) {
            setStatus('Falha ao desligar a bridge: ' + error.message);
        }
    }

    function assistantWriting() {
        return Boolean(
            document.querySelector(
                '[data-testid="stop-button"], ' +
                'button[aria-label*="Stop generating"], ' +
                'button[aria-label*="Parar de gerar"], ' +
                'button[aria-label*="Parar resposta"]'
            )
        );
    }

    function isUserTurn(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) {
            return false;
        }

        if (
            element.getAttribute('data-message-author-role') === 'user' ||
            element.getAttribute('data-author-role') === 'user' ||
            element.matches('[data-testid*="user-message"]') ||
            element.matches('[data-testid*="user_message"]')
        ) {
            return true;
        }

        if (
            element.querySelector(
                '[data-message-author-role="user"], [data-author-role="user"], [data-testid*="user-message"], [data-testid*="user_message"], [data-message-id*="user"]'
            )
        ) {
            return true;
        }

        return false;
    }

    function closestAssistant(node) {
        const element = node?.nodeType === Node.ELEMENT_NODE
            ? node
            : node?.parentElement;

        if (!element) {
            return null;
        }

        const direct = element.closest(
            '[data-message-author-role="assistant"], ' +
            '[data-author-role="assistant"], ' +
            '[data-testid*="assistant"], ' +
            '[data-testid*="agent"], ' +
            '.agent-turn'
        );

        if (direct) {
            return direct;
        }

        const turn = element.closest(
            '[data-testid^="conversation-turn-"], article, [data-message-id]'
        );

        if (turn && !isUserTurn(turn)) {
            return turn;
        }

        return null;
    }

    function latestAssistantFallback() {
        const directNodes = document.querySelectorAll(
            '[data-message-author-role="assistant"], ' +
            '[data-author-role="assistant"], ' +
            '[data-testid*="assistant"], ' +
            '[data-testid*="agent"], ' +
            '.agent-turn'
        );

        if (directNodes.length) {
            return directNodes[directNodes.length - 1];
        }

        const turns = Array.from(document.querySelectorAll(
            '[data-testid^="conversation-turn-"], article, [data-message-id]'
        ));

        for (let index = turns.length - 1; index >= 0; index--) {
            const turn = turns[index];

            if (!isUserTurn(turn)) {
                const text = String(turn.textContent || '').trim();
                if (text.length > 0) {
                    return turn;
                }
            }
        }

        const probeNodes = Array.from(document.querySelectorAll('main div, #__next div, [role="presentation"] div'));

        for (let index = probeNodes.length - 1; index >= 0; index--) {
            const node = probeNodes[index];
            const text = String(node.textContent || '');

            if (
                text.includes('PSB_JOB_FILE_V1') ||
                text.includes('PSB_JOB_V3') ||
                text.includes('PSB_JOB_V2') ||
                text.includes('PSB_LEARN_V1')
            ) {
                const turn = node.closest('[data-testid^="conversation-turn-"], article, [data-message-id]');
                return turn || node;
            }
        }

        return null;
    }

    function baselineCurrentAssistant() {
        const latest = latestAssistantFallback();

        if (!latest) {
            return;
        }

        const manifests = manifestsIn(latest);
        if (manifests.length > 0) {
            GM_setValue(protocolPromptKey(), true);
        }

        for (const manifest of manifests) {
            if (['PSB_JOB_FILE_V1', 'PSB_JOB_V2', 'PSB_JOB_V3'].includes(manifest.protocol) && manifest.jobId) {
                if (getInflight()?.jobId !== String(manifest.jobId)) {
                    markHandled(String(manifest.jobId));
                }
            }

            if (manifest.protocol === 'PSB_LEARN_V1' && manifest.id) {
                markHandled(`learn:${manifest.id}`);
            }
        }
    }

    function assistantInsideAddedNode(node) {
        const direct = closestAssistant(node);
        if (direct) return direct;
        if (node?.nodeType !== Node.ELEMENT_NODE) return null;

        // Uma resposta pode chegar como subárvore inteira: procurar só dentro
        // do nó recentemente inserido, nunca no histórico todo.
        const descendants = node.querySelectorAll(
            '[data-message-author-role="assistant"], [data-author-role="assistant"], ' +
            '[data-testid^="conversation-turn-"], .agent-turn'
        );
        for (let i = descendants.length - 1; i >= 0; i--) {
            const candidate = descendants[i];
            if (!isUserTurn(candidate)) return candidate;
        }
        return null;
    }

    function containsNewUserTurn(node) {
        if (node?.nodeType !== Node.ELEMENT_NODE) return false;
        const userSelector = '[data-message-author-role="user"], [data-author-role="user"], [data-testid*="user-message"]';
        return node.matches(userSelector) || Boolean(node.querySelector(userSelector));
    }

    function scheduleCandidate(node) {
        if (!enabled()) return;
        const assistant = assistantInsideAddedNode(node);
        if (!assistant && node !== document.body) return;
        if (assistant) {
            candidateAssistant = assistant;
        }
        clearTimeout(settleTimer);
        settleTimer = window.setTimeout(() => {
            void inspectCandidate(false);
        }, SETTLE_MS);
    }

    function installObserver() {
        // A raíz principal do ChatGPT pode ser substituída por navegação SPA.
        // O body é estável mesmo quando o React recria o main.
        const root = document.body;
        if (observerRoot === root) return;
        observer?.disconnect();
        observerRoot = root;
        observer = new MutationObserver(records => {
            for (const record of records) {
                // Alterações de texto são observadas dentro da resposta atual.
                if (record.type === 'characterData') {
                    scheduleCandidate(record.target);
                    continue;
                }

                const targetAssistant = closestAssistant(record.target);
                if (targetAssistant) scheduleCandidate(record.target);

                for (const added of record.addedNodes) {
                    if (containsNewUserTurn(added)) {
                        candidateAssistant = null;
                        // Uma mensagem antiga também pode ser montada por virtualização;
                        // só eventos reais de envio iniciam a consulta autenticada.
                    }
                    // Descobre novos turnos mesmo que cheguem como subárvores.
                    scheduleCandidate(added);
                }
            }
        });
        observer.observe(root, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    function scheduleHeartbeat(delay = null) {
        clearTimeout(heartbeatTimer);
        heartbeatTimer = 0;
        if (!enabled()) return;
        const period = document.hidden ? HEARTBEAT_HIDDEN_MS : HEARTBEAT_VISIBLE_MS;
        heartbeatTimer = window.setTimeout(() => {
            heartbeatTimer = 0;
            void backgroundHeartbeat().finally(() => {
                // O foco NUNCA é pré-requisito; tempos podem ser adiados pelo Chrome.
                scheduleHeartbeat();
            });
        }, delay == null ? period : delay);
    }

    async function backgroundHeartbeat() {
        if (!enabled() || heartbeatBusy) return;
        heartbeatBusy = true;
        try {
            installObserver();
            if (activeJobId || deliveryRecoveryBusy || sendingMessage) return;

            if (getInflight()) {
                // Não reexecutar o job: apenas recuperar a entrega ou consulta.
                if (!deliveryRecoveryTimer) scheduleDeliveryRecovery(1200);
                return;
            }
            // Se o React não emitiu mutações observadas, encontrar a resposta
            // mais recente sem clicar, fazer scroll ou ativar a janela.
            if (assistantWriting()) return;
            const newest = latestAssistantFallback();
            if (newest) candidateAssistant = newest;
            await inspectCandidate(false);
        } catch (error) {
            console.warn('[LPX PSB] Heartbeat independente do foco:', error?.message || error);
        } finally {
            heartbeatBusy = false;
        }
    }

    function generateAutoJobId(codeText) {
        const d = new Date();
        const pad = n => String(n).padStart(2, '0');
        const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
        const hm = `${pad(d.getHours())}${pad(d.getMinutes())}`;
        const hash = simpleHash(String(codeText || '')).slice(0, 6).toUpperCase();
        return `PSB-${ymd}-${hm}-AUTO-${hash}`;
    }

    function parseV3PowerShellBlock(text) {
        const normalized = String(text || '')
            .replace(/\r\n?/g, '\n')
            .replace(/^\uFEFF/, '');

        const lines = normalized.split('\n');
        const markerIndex = lines.findIndex(line => /^\s*#\s*PSB_JOB_V3\s*$/i.test(line));

        if (markerIndex < 0) {
            return null;
        }

        let jobId = '';
        let purpose = '';
        let commandStart = markerIndex + 1;

        for (let index = markerIndex + 1; index < lines.length; index++) {
            const line = lines[index];
            const jobMatch = line.match(/^\s*#\s*(?:jobId|job_id|job)\s*[:=]\s*(.+?)\s*$/i);
            const purposeMatch = line.match(/^\s*#\s*(?:purpose|objetivo)\s*[:=]\s*(.*?)\s*$/i);

            if (jobMatch) {
                jobId = jobMatch[1].trim();
                commandStart = index + 1;
                continue;
            }

            if (purposeMatch) {
                purpose = purposeMatch[1].trim();
                commandStart = index + 1;
                continue;
            }

            if (!line.trim() || /^\s*#/.test(line)) {
                commandStart = index + 1;
                continue;
            }

            break;
        }

        const command = lines
            .slice(commandStart)
            .join('\n')
            .replace(/^\n+/, '');

        if (!command.trim()) {
            return null;
        }

        if (!jobId) {
            jobId = generateAutoJobId(command);
        }

        return {
            protocol: 'PSB_JOB_V3',
            jobId,
            purpose: purpose || 'Execução PSB_JOB_V3',
            command
        };
    }

    function manifestLooksLikePlaceholder(manifest) {
        if (!manifest || typeof manifest !== 'object') {
            return true;
        }

        const protocol = String(manifest.protocol || '').trim();
        const jobId = String(manifest.jobId || '').trim();
        const fileName = String(manifest.file || '').trim();

        if (
            /AAAAMMDD|HHMM|DESCRICAO|\.\.\./i.test(jobId) ||
            /nome-unico-do-comando|\.\.\./i.test(fileName)
        ) {
            return true;
        }

        if (protocol === 'PSB_JOB_FILE_V1') {
            if (!/^PSB-\d{8}-\d{4}-[A-Z0-9][A-Z0-9-]*-\d{3}$/i.test(jobId)) {
                return true;
            }

            if (!/\.ps1$/i.test(fileName)) {
                return true;
            }
        }

        return false;
    }

    function parseBalancedJsonManifests(text) {
        const source = String(text || '');
        const supported = new Set([
            'PSB_JOB_FILE_V1',
            'PSB_JOB_V2',
            'PSB_JOB_V3',
            'PSB_LEARN_V1'
        ]);
        const found = [];

        for (let start = 0; start < source.length; start++) {
            if (source[start] !== '{') {
                continue;
            }

            let depth = 0;
            let inString = false;
            let escaped = false;

            for (let index = start; index < source.length; index++) {
                const char = source[index];

                if (inString) {
                    if (escaped) {
                        escaped = false;
                    } else if (char === '\\') {
                        escaped = true;
                    } else if (char === '"') {
                        inString = false;
                    }

                    continue;
                }

                if (char === '"') {
                    inString = true;
                    continue;
                }

                if (char === '{') {
                    depth++;
                    continue;
                }

                if (char === '}') {
                    depth--;

                    if (depth !== 0) {
                        continue;
                    }

                    try {
                        const value = JSON.parse(
                            source.slice(start, index + 1)
                        );

                        if (
                            value &&
                            typeof value === 'object' &&
                            supported.has(String(value.protocol || '')) &&
                            !manifestLooksLikePlaceholder(value)
                        ) {
                            found.push(value);
                        }
                    } catch {
                        // Continua a procurar o próximo objeto JSON balanceado.
                    }

                    break;
                }
            }
        }

        return found;
    }

    function manifestsIn(assistant) {
        const manifests = [];
        const seenManifestKeys = new Set();
        const seenTexts = new Set();
        const root = turnContainer(assistant);

        function addManifest(value) {
            if (!value || typeof value !== 'object' || !value.protocol) {
                return;
            }

            if (manifestLooksLikePlaceholder(value)) {
                return;
            }

            const key = [
                String(value.protocol || ''),
                String(value.jobId || value.id || ''),
                String(value.fileId || ''),
                String(value.file || '')
            ].join('|');

            if (seenManifestKeys.has(key)) {
                return;
            }

            seenManifestKeys.add(key);
            manifests.push(value);
        }

        function inspectText(rawText) {
            const text = String(rawText || '').trim();

            if (!text || seenTexts.has(text)) {
                return;
            }

            seenTexts.add(text);

            if (text.includes('PSB_JOB_V3')) {
                const value = parseV3PowerShellBlock(text);

                if (value && !manifestLooksLikePlaceholder(value)) {
                    addManifest(value);
                }
            }

            if (
                !text.includes('PSB_JOB_FILE_V1') &&
                !text.includes('PSB_JOB_V2') &&
                !text.includes('PSB_JOB_V3') &&
                !text.includes('PSB_LEARN_V1')
            ) {
                return;
            }

            for (const value of parseBalancedJsonManifests(text)) {
                addManifest(value);
            }
        }

        const selector = [
            'pre',
            'code',
            '.cm-content',
            '[data-testid*="code"]',
            '[data-testid*="Code"]',
            '[class*="code-block"]',
            '[class*="codeBlock"]',
            '[class*="CodeBlock"]'
        ].join(', ');

        for (const node of root.querySelectorAll(selector)) {
            inspectText(
                node.innerText ||
                node.textContent ||
                ''
            );
        }

        inspectText(
            root.innerText ||
            root.textContent ||
            ''
        );

        if (manifests.length === 0) {
            for (const node of root.querySelectorAll(selector)) {
                if (node.tagName === 'PRE' && node.querySelector('code')) {
                    continue;
                }

                const raw = String(node.innerText || node.textContent || '').trim();
                if (!raw || raw.length < 6) {
                    continue;
                }

                if (raw.startsWith('{') || raw.startsWith('LPX_') || raw.includes('PSB_JOB_')) {
                    continue;
                }

                const className = String(node.className || '') + ' ' + String(node.parentElement?.className || '');
                const isExplicitPs = /powershell|pwsh|language-ps/i.test(className);
                const hasPsKeywords = /(?:Get-|Set-|New-|Start-|Stop-|Invoke-|Test-|Remove-|Select-Object|Where-Object|Write-Host|Write-Output|\$env:|\$[A-Za-z_][A-Za-z0-9_]*\s*=|npm\s+|node\s+|git\s+|cd\s+)/i.test(raw);

                if (isExplicitPs || hasPsKeywords) {
                    const fallbackJobId = generateAutoJobId(raw);
                    addManifest({
                        protocol: 'PSB_JOB_V3',
                        jobId: fallbackJobId,
                        purpose: 'Execução autónoma de bloco PowerShell detetado na resposta',
                        command: raw
                    });
                    break;
                }
            }
        }

        return manifests;
    }

    async function inspectCandidate(forced) {
        if (!enabled() && !forced) {
            return;
        }

        if (activeJobId) {
            return;
        }

        if (assistantWriting()) {
            clearTimeout(settleTimer);
            settleTimer = window.setTimeout(() => void inspectCandidate(false), SETTLE_MS);
            return;
        }

        const assistant = forced
            ? latestAssistantFallback()
            : (candidateAssistant?.isConnected
                ? candidateAssistant
                : latestAssistantFallback());

        if (!assistant) {
            if (forced) setStatus('Não foi encontrada uma resposta do assistente.');
            return;
        }

        const manifests = manifestsIn(assistant);

        if (!manifests.length) {
            if (forced) {
                setStatus('O último turno não contém PSB_JOB_FILE_V1, PSB_JOB_V3, PSB_JOB_V2 nem PSB_LEARN_V1.');
            }
            return;
        }

        for (const manifest of manifests) {
            if (manifest.protocol === 'PSB_JOB_FILE_V1' || manifest.protocol === 'PSB_JOB_V3' || manifest.protocol === 'PSB_JOB_V2') {
                await processJobManifest(assistant, manifest, forced);
            } else if (manifest.protocol === 'PSB_LEARN_V1') {
                await processKnowledgeManifest(manifest, forced);
            }
        }
    }

    function turnContainer(assistant) {
        return assistant.closest(
            '[data-testid^="conversation-turn-"], article, [data-message-id]'
        ) || assistant;
    }

    function extractAttachmentUrlInPageWorld(root, fileName) {
        if (!(root instanceof Element)) {
            return '';
        }

        const markerName = 'data-lpx-psb15-probe';
        const resultName = 'data-lpx-psb15-result';
        const diagnosticName = 'data-lpx-psb15-diagnostic';
        const marker = `probe-${randomId()}`;
        const wanted = String(fileName || '').trim().toLowerCase();

        lastAttachmentDiagnostic = '';

        root.setAttribute(markerName, marker);
        root.removeAttribute(resultName);
        root.removeAttribute(diagnosticName);

        function scanPage(probeMarker, wantedName) {
            const markerName = 'data-lpx-psb15-probe';
            const resultName = 'data-lpx-psb15-result';
            const diagnosticName = 'data-lpx-psb15-diagnostic';

            const probeRoot = [
                ...document.querySelectorAll(`[${markerName}]`)
            ].find(node =>
                node.getAttribute(markerName) === probeMarker
            );

            if (!probeRoot) {
                return;
            }

            const candidates = [];
            const seen = new WeakSet();

            let visited = 0;
            let reactRoots = 0;
            let filenameNodes = 0;
            let sandboxNodes = 0;

            function addCandidate(rawValue, key = '', context = '') {
                let value = String(rawValue || '')
                    .trim()
                    .replace(/\\u0026/gi, '&')
                    .replace(/\\\//g, '/')
                    .replace(/&amp;/gi, '&');

                if (!value) {
                    return;
                }

                if (/^sandbox:/i.test(value)) {
                    sandboxNodes++;
                    return;
                }

                if (/^file-service:\/\//i.test(value)) {
                    const fileId = value.replace(
                        /^file-service:\/\//i,
                        ''
                    );

                    if (fileId) {
                        value =
                            location.origin +
                            '/backend-api/files/' +
                            encodeURIComponent(fileId) +
                            '/download';
                    }
                }

                if (/^file[_-][A-Za-z0-9_-]{8,}$/.test(value)) {
                    value =
                        location.origin +
                        '/backend-api/files/' +
                        encodeURIComponent(value) +
                        '/download';
                }

                if (value.startsWith('/')) {
                    try {
                        value = new URL(value, location.origin).href;
                    } catch {
                        return;
                    }
                }

                if (!/^(?:https?:|blob:)/i.test(value)) {
                    return;
                }

                const lower = value.toLowerCase();

                if (
                    lower.includes('github.com/') ||
                    lower.includes('raw.githubusercontent.com')
                ) {
                    return;
                }

                let score = 0;

                const source = [
                    value,
                    key,
                    context
                ].join(' ').toLowerCase();

                if (
                    wantedName &&
                    (
                        source.includes(wantedName) ||
                        source.includes(
                            encodeURIComponent(wantedName)
                                .toLowerCase()
                        )
                    )
                ) {
                    score += 3000;
                }

                if (/files\.oaiusercontent\.com/i.test(value)) {
                    score += 2200;
                } else if (/oaiusercontent\.com/i.test(value)) {
                    score += 1900;
                }

                if (/\/backend-api\/files\//i.test(value)) {
                    score += 2100;
                } else if (/\/backend-api\//i.test(value)) {
                    score += 1500;
                }

                if (/^blob:/i.test(value)) {
                    score += 1100;
                }

                if (
                    /url|href|download|attachment|asset|content|file|pointer/i
                        .test(key)
                ) {
                    score += 450;
                }

                if (score <= 0) {
                    return;
                }

                const existing = candidates.find(
                    candidate => candidate.url === value
                );

                if (existing) {
                    existing.score = Math.max(
                        existing.score,
                        score
                    );
                } else {
                    candidates.push({
                        url: value,
                        score
                    });
                }
            }

            function inspectString(rawValue, key = '', context = '') {
                const text = String(rawValue || '')
                    .replace(/\\u0026/gi, '&')
                    .replace(/\\\//g, '/')
                    .replace(/&amp;/gi, '&');

                const decodedValues = [text];

                try {
                    const decoded = decodeURIComponent(text);

                    if (decoded !== text) {
                        decodedValues.push(decoded);
                    }
                } catch {
                    // Continua apenas com o valor original.
                }

                for (const inspected of decodedValues) {
                    const matches = inspected.match(
                        /(?:https?:\/\/|blob:https?:\/\/|\/backend-api\/)[^\s"'<>\\]+|file-service:\/\/[A-Za-z0-9_-]+|file[_-][A-Za-z0-9_-]{8,}/gi
                    ) || [];

                    for (const match of matches) {
                        addCandidate(
                            match,
                            key,
                            context || inspected
                        );
                    }
                }
            }

            function walk(value, depth = 0, key = '') {
                if (
                    depth > 12 ||
                    visited > 12000 ||
                    candidates.length > 300
                ) {
                    return;
                }

                if (typeof value === 'string') {
                    inspectString(value, key);
                    return;
                }

                if (
                    !value ||
                    (
                        typeof value !== 'object' &&
                        typeof value !== 'function'
                    )
                ) {
                    return;
                }

                try {
                    if (seen.has(value)) {
                        return;
                    }

                    seen.add(value);
                } catch {
                    return;
                }

                visited++;

                let keys = [];

                try {
                    keys = Object.getOwnPropertyNames(value);
                } catch {
                    return;
                }

                keys.sort((left, right) => {
                    const important =
                        /url|href|download|attachment|asset|content|file|pointer|id/i;

                    return Number(important.test(right)) -
                        Number(important.test(left));
                });

                for (const childKey of keys.slice(0, 240)) {
                    if (
                        childKey === 'ownerDocument' ||
                        childKey === 'parentNode' ||
                        childKey === 'parentElement' ||
                        childKey === 'children' ||
                        childKey === 'childNodes'
                    ) {
                        continue;
                    }

                    try {
                        walk(
                            value[childKey],
                            depth + 1,
                            `${key}.${childKey}`
                        );
                    } catch {
                        // Continua a pesquisa.
                    }
                }
            }

            const allNodes = [
                ...document.querySelectorAll('*')
            ];

            const selectedNodes = new Set([
                probeRoot,
                ...probeRoot.querySelectorAll('*'),
                ...allNodes.slice(-12000)
            ]);

            for (const node of allNodes) {
                if (!(node instanceof Element)) {
                    continue;
                }

                const href = node.getAttribute('href') || '';

                const label = [
                    node.textContent || '',
                    href,
                    node.getAttribute('aria-label') || '',
                    node.getAttribute('title') || '',
                    node.getAttribute('download') || '',
                    node.getAttribute('data-testid') || ''
                ].join(' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .toLowerCase();

                const filenameMatch =
                    wantedName &&
                    label.includes(wantedName);

                const sandboxMatch = /^sandbox:/i.test(href);

                const attachmentMatch =
                    /download|attachment|anexo|ficheiro|file/i.test(
                        node.getAttribute('data-testid') || ''
                    );

                if (
                    !filenameMatch &&
                    !sandboxMatch &&
                    !attachmentMatch
                ) {
                    continue;
                }

                if (filenameMatch) {
                    filenameNodes++;
                }

                if (sandboxMatch) {
                    sandboxNodes++;
                }

                selectedNodes.add(node);

                let current = node;

                for (
                    let depth = 0;
                    current && depth < 16;
                    depth++, current = current.parentElement
                ) {
                    selectedNodes.add(current);

                    for (
                        const child of [
                            ...current.querySelectorAll('*')
                        ].slice(0, 350)
                    ) {
                        selectedNodes.add(child);
                    }
                }
            }

            const nodes = [...selectedNodes].slice(0, 16000);

            for (const node of nodes) {
                if (!(node instanceof Element)) {
                    continue;
                }

                for (const attribute of node.getAttributeNames()) {
                    inspectString(
                        node.getAttribute(attribute),
                        `attribute.${attribute}`,
                        node.textContent || ''
                    );
                }

                let ownKeys = [];

                try {
                    ownKeys = Object.getOwnPropertyNames(node);
                } catch {
                    ownKeys = [];
                }

                for (const key of ownKeys) {
                    if (
                        key.startsWith('__reactProps$') ||
                        key.startsWith('__reactFiber$') ||
                        key.startsWith('__reactContainer$')
                    ) {
                        reactRoots++;

                        try {
                            walk(node[key], 0, key);
                        } catch {
                            // Continua.
                        }
                    }
                }
            }

            candidates.sort(
                (left, right) => right.score - left.score
            );

            probeRoot.setAttribute(
                diagnosticName,
                encodeURIComponent([
                    `allNodes=${allNodes.length}`,
                    `selectedNodes=${nodes.length}`,
                    `filenameNodes=${filenameNodes}`,
                    `sandboxNodes=${sandboxNodes}`,
                    `reactRoots=${reactRoots}`,
                    `visited=${visited}`,
                    `candidates=${candidates.length}`
                ].join(';'))
            );

            probeRoot.setAttribute(
                resultName,
                candidates.length
                    ? encodeURIComponent(candidates[0].url)
                    : ''
            );
        }

        const source =
            `(${scanPage.toString()})` +
            `(${JSON.stringify(marker)},${JSON.stringify(wanted)});`;

        try {
            if (
                typeof unsafeWindow !== 'undefined' &&
                typeof unsafeWindow.Function === 'function'
            ) {
                unsafeWindow.Function(source)();
            } else {
                const script = document.createElement('script');
                script.textContent = source;

                (document.head || document.documentElement)
                    .appendChild(script);

                script.remove();
            }
        } catch {
            try {
                const script = document.createElement('script');
                script.textContent = source;

                (document.head || document.documentElement)
                    .appendChild(script);

                script.remove();
            } catch {
                // Sem acesso ao contexto real da pagina.
            }
        }

        const encoded = root.getAttribute(resultName) || '';

        const encodedDiagnostic =
            root.getAttribute(diagnosticName) || '';

        try {
            lastAttachmentDiagnostic = encodedDiagnostic
                ? decodeURIComponent(encodedDiagnostic)
                : 'diagnostic=unavailable';
        } catch {
            lastAttachmentDiagnostic =
                'diagnostic=decode-failed';
        }

        root.removeAttribute(markerName);
        root.removeAttribute(resultName);
        root.removeAttribute(diagnosticName);

        if (!encoded) {
            return '';
        }

        try {
            return decodeURIComponent(encoded);
        } catch {
            return '';
        }
    }
    function findAttachmentLink(assistant, fileName) {
        const wanted = String(fileName || '').trim().toLowerCase();
        const turn = turnContainer(assistant);
        const candidates = [];
        const seen = new WeakSet();
        let visited = 0;

        function cleanUrl(value) {
            let text = String(value || '')
                .trim()
                .replace(/\\u0026/gi, '&')
                .replace(/\\\//g, '/')
                .replace(/&amp;/gi, '&');

            if (!text || /^sandbox:/i.test(text)) {
                return '';
            }

            const match = text.match(
                /(?:https?:\/\/|blob:https?:\/\/|\/backend-api\/)[^\s"'<>\\]+/i
            );

            if (match) {
                text = match[0];
            }

            if (text.startsWith('/')) {
                try {
                    text = new URL(text, location.origin).href;
                } catch {
                    return '';
                }
            }

            return /^(?:https?:|blob:)/i.test(text) ? text : '';
        }

        function add(value, key = '') {
            const url = cleanUrl(value);

            if (!url) {
                return;
            }

            const lower = url.toLowerCase();

            if (
                lower.includes('raw.githubusercontent.com') ||
                lower.includes('github.com/')
            ) {
                return;
            }

            let score = 0;

            if (wanted && lower.includes(wanted)) {
                score += 2000;
            }

            try {
                if (
                    wanted &&
                    lower.includes(encodeURIComponent(wanted).toLowerCase())
                ) {
                    score += 1800;
                }
            } catch {
                // Best effort.
            }

            if (/files\.oaiusercontent\.com/i.test(url)) {
                score += 1200;
            } else if (/oaiusercontent\.com/i.test(url)) {
                score += 1000;
            }

            if (/\/backend-api\//i.test(url)) {
                score += 1100;
            }

            if (/download|attachment|asset|content|file/i.test(lower)) {
                score += 250;
            }

            if (/url|href|download|attachment|asset|content|file/i.test(key)) {
                score += 180;
            }

            if (score > 0 && !candidates.some(item => item.url === url)) {
                candidates.push({ url, score });
            }
        }

        function walk(value, depth = 0, key = '') {
            if (depth > 8 || visited > 2500) {
                return;
            }

            if (typeof value === 'string') {
                add(value, key);
                return;
            }

            if (
                !value ||
                (
                    typeof value !== 'object' &&
                    typeof value !== 'function'
                )
            ) {
                return;
            }

            try {
                if (seen.has(value)) {
                    return;
                }

                seen.add(value);
            } catch {
                return;
            }

            visited++;

            let keys;

            try {
                keys = Object.keys(value).slice(0, 120);
            } catch {
                return;
            }

            keys.sort((a, b) => {
                const important =
                    /url|href|download|attachment|asset|content|file/i;

                return Number(important.test(b)) -
                    Number(important.test(a));
            });

            for (const childKey of keys) {
                if (
                    childKey === 'ownerDocument' ||
                    childKey === 'parentNode' ||
                    childKey === 'parentElement' ||
                    childKey === 'children' ||
                    childKey === 'childNodes'
                ) {
                    continue;
                }

                try {
                    walk(
                        value[childKey],
                        depth + 1,
                        `${key}.${childKey}`
                    );
                } catch {
                    // Continua.
                }
            }
        }

        for (const anchor of turn.querySelectorAll('a[href]')) {
            const label = [
                anchor.textContent || '',
                anchor.getAttribute('download') || '',
                anchor.getAttribute('aria-label') || '',
                anchor.getAttribute('title') || '',
                anchor.getAttribute('href') || ''
            ].join(' ').toLowerCase();

            if (wanted && label.includes(wanted)) {
                const href = cleanUrl(
                    anchor.getAttribute('href') || anchor.href
                );

                if (href) {
                    return { href };
                }
            }
        }

        const controls = findAttachmentControls(
            assistant,
            fileName
        );

        const nodes = new Set([
            turn,
            assistant,
            ...controls
        ]);

        for (const control of controls) {
            let current = control;

            for (
                let depth = 0;
                current && depth < 9;
                depth++, current = current.parentElement
            ) {
                nodes.add(current);
            }
        }

        for (const node of nodes) {
            if (!(node instanceof Element)) {
                continue;
            }

            for (const attribute of [
                'href',
                'src',
                'data-url',
                'data-href',
                'data-download-url',
                'data-file-url'
            ]) {
                add(
                    node.getAttribute(attribute),
                    `attribute.${attribute}`
                );
            }

            let keys = [];

            try {
                keys = Object.keys(node);
            } catch {
                keys = [];
            }

            for (const key of keys) {
                if (
                    key.startsWith('__reactProps$') ||
                    key.startsWith('__reactFiber$') ||
                    key.startsWith('__reactContainer$')
                ) {
                    try {
                        walk(node[key], 0, key);
                    } catch {
                        // Continua.
                    }
                }
            }
        }

        candidates.sort((a, b) => b.score - a.score);

        if (candidates.length) {
            return {
                href: candidates[0].url
            };
        }

        const pageWorldHref = extractAttachmentUrlInPageWorld(
            turn,
            fileName
        );

        return pageWorldHref
            ? { href: pageWorldHref }
            : null;
    }

    function attachmentControlLabel(node) {
        if (!(node instanceof Element)) {
            return '';
        }

        return [
            node.textContent || '',
            node.getAttribute('aria-label') || '',
            node.getAttribute('title') || '',
            node.getAttribute('download') || '',
            node.getAttribute('data-testid') || '',
            node.getAttribute('href') || ''
        ].join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function findAttachmentControls(assistant, fileName) {
        const wanted = String(fileName || '').trim().toLowerCase();
        const turn = turnContainer(assistant);
        const found = [];
        const seenControls = new Set();

        if (!wanted || !(turn instanceof Element)) {
            return [];
        }

        function labelOf(node) {
            if (!(node instanceof Element)) {
                return '';
            }

            return [
                node.textContent || '',
                node.getAttribute('aria-label') || '',
                node.getAttribute('title') || '',
                node.getAttribute('download') || '',
                node.getAttribute('href') || '',
                node.getAttribute('data-testid') || '',
                node.getAttribute('data-file-id') || '',
                node.getAttribute('data-id') || ''
            ].join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
        }

        function interactive(node) {
            if (!(node instanceof Element)) {
                return null;
            }

            let current = node;

            for (let depth = 0; current && depth < 10; depth++, current = current.parentElement) {
                if (!turn.contains(current)) {
                    break;
                }

                if (current.matches('a, button, [role="button"], [role="link"], [tabindex], [data-testid*="download"], [data-testid*="attachment"], [data-testid*="file"]')) {
                    return current;
                }
            }

            return node instanceof HTMLElement ? node : null;
        }

        function add(node, source, score = 0) {
            const control = interactive(node);

            if (!(control instanceof HTMLElement) || seenControls.has(control) || !turn.contains(control) || control.closest('pre, code')) {
                return;
            }

            const label = labelOf(control);
            let total = Number(score || 0);

            if (label.includes(wanted)) {
                total += 4000;
            }

            if (control.matches('a[href]')) {
                total += 900;
            }

            if (control.matches('button, [role="button"], [role="link"]')) {
                total += 700;
            }

            if (/download|descarregar|transferir|attachment|anexo|file|ficheiro/.test(label)) {
                total += 500;
            }

            seenControls.add(control);
            found.push({ node: control, source, score: total, label: label.slice(0, 500) });
        }

        function nearbyStateNodes(fiber) {
            const nodes = [];
            const seen = new Set();

            function push(value) {
                if (!(value instanceof HTMLElement) || !turn.contains(value) || seen.has(value)) {
                    return;
                }

                seen.add(value);
                nodes.push(value);
            }

            function inspect(start) {
                let current = start;

                for (let depth = 0; current && depth < 12; depth++, current = current.return) {
                    push(current.stateNode);
                    push(current.child && current.child.stateNode);
                    push(current.sibling && current.sibling.stateNode);
                    push(current.alternate && current.alternate.stateNode);
                }
            }

            inspect(fiber);
            inspect(fiber && fiber.alternate);

            return nodes;
        }

        const all = [turn, ...turn.querySelectorAll('*')].slice(0, 1800);

        for (const node of all) {
            const label = labelOf(node);

            if (!label.includes(wanted)) {
                continue;
            }

            add(node, 'dom-exact', 7000);

            for (const child of node.querySelectorAll('a, button, [role="button"], [role="link"], [tabindex]')) {
                add(child, 'dom-descendant', 6200);
            }

            let sibling = node.previousElementSibling;

            for (let index = 0; sibling && index < 3; index++, sibling = sibling.previousElementSibling) {
                add(sibling, 'dom-previous-sibling', 3500);
            }

            sibling = node.nextElementSibling;

            for (let index = 0; sibling && index < 3; index++, sibling = sibling.nextElementSibling) {
                add(sibling, 'dom-next-sibling', 3500);
            }
        }

        const seenObjects = new WeakSet();
        let visited = 0;

        function walk(value, ownerNode, path, depth, activeFiber) {
            if (depth > 20 || visited > 70000) {
                return;
            }

            if (typeof value === 'string') {
                let decoded = value.toLowerCase();

                try {
                    decoded = decodeURIComponent(value).toLowerCase();
                } catch {
                    // Keep original.
                }

                if (decoded.includes(wanted) || (/sandbox:\/mnt\/data\//i.test(value) && decoded.includes(wanted))) {
                    for (const node of nearbyStateNodes(activeFiber)) {
                        add(node, 'react-string:' + path, 8000);
                    }

                    add(ownerNode, 'react-owner:' + path, 6500);
                }

                return;
            }

            if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
                return;
            }

            try {
                if (seenObjects.has(value)) {
                    return;
                }

                seenObjects.add(value);
            } catch {
                return;
            }

            visited++;

            const looksLikeFiber =
                Object.prototype.hasOwnProperty.call(value, 'pendingProps') ||
                Object.prototype.hasOwnProperty.call(value, 'memoizedProps') ||
                Object.prototype.hasOwnProperty.call(value, 'stateNode');

            const fiber = looksLikeFiber ? value : activeFiber;
            const stateNode = value.stateNode instanceof HTMLElement ? value.stateNode : ownerNode;

            for (const propsName of ['pendingProps', 'memoizedProps', 'props']) {
                const props = value[propsName];

                if (!props || typeof props !== 'object') {
                    continue;
                }

                const propsValues = [
                    props.href,
                    props.url,
                    props.downloadUrl,
                    props.download_url,
                    props.fileId,
                    props.file_id,
                    props.asset_pointer,
                    props.assetPointer,
                    typeof props.children === 'string' ? props.children : ''
                ];

                const relevant = propsValues.some(item => {
                    if (!item) {
                        return false;
                    }

                    let candidate = String(item).toLowerCase();

                    try {
                        candidate = decodeURIComponent(String(item)).toLowerCase();
                    } catch {
                        // Keep original.
                    }

                    return candidate.includes(wanted);
                });

                if (relevant) {
                    for (const node of nearbyStateNodes(fiber)) {
                        add(node, 'react-props:' + path + '.' + propsName, 9000);
                    }

                    add(stateNode, 'react-state:' + path + '.' + propsName, 8500);
                }

                if (typeof props.onClick === 'function') {
                    const stateLabel = labelOf(stateNode);
                    const childText = typeof props.children === 'string' ? props.children.toLowerCase() : '';

                    if (stateLabel.includes(wanted) || childText.includes(wanted)) {
                        add(stateNode, 'react-onclick:' + path + '.' + propsName, 9500);
                    }
                }
            }

            let entries = [];

            try {
                entries = Object.entries(value);
            } catch {
                return;
            }

            entries.sort(([left], [right]) => {
                const important = /pendingProps|memoizedProps|props|href|url|file|asset|pointer|download|stateNode|child|return|alternate|sibling/i;
                return Number(important.test(right)) - Number(important.test(left));
            });

            for (const [key, child] of entries.slice(0, 220)) {
                walk(child, stateNode, path + '.' + key, depth + 1, fiber);
            }
        }

        for (let index = 0; index < all.length; index++) {
            const node = all[index];
            let keys = [];

            try {
                keys = Object.keys(node);
            } catch {
                keys = [];
            }

            for (const key of keys) {
                if (!key.startsWith('__reactFiber$') && !key.startsWith('__reactProps$') && !key.startsWith('__reactContainer$')) {
                    continue;
                }

                walk(node[key], node, 'node[' + index + '].' + key, 0, null);
            }
        }

        found.sort((left, right) => right.score - left.score);

        lastAttachmentDiagnostic = [
            'unifiedControls=' + found.length,
            'reactVisited=' + visited,
            'top=' + found.slice(0, 6).map(item => item.source + ':' + item.score).join('|')
        ].join(';');

        return found.slice(0, 12).map(item => item.node);
    }

    function invokeReactAttachmentClick(control) {
        let current = control;

        for (
            let depth = 0;
            current && depth < 9;
            depth++, current = current.parentElement
        ) {
            for (const key of Object.keys(current)) {
                if (!key.startsWith('__reactProps$')) {
                    continue;
                }

                const props = current[key];

                if (!props || typeof props.onClick !== 'function') {
                    continue;
                }

                try {
                    const nativeEvent = new MouseEvent('click', {
                        bubbles: true,
                        cancelable: true,
                        composed: true,
                        view: window
                    });

                    props.onClick({
                        type: 'click',
                        target: current,
                        currentTarget: current,
                        nativeEvent,
                        button: 0,
                        buttons: 0,
                        detail: 1,
                        defaultPrevented: false,
                        preventDefault() {},
                        stopPropagation() {},
                        persist() {}
                    });

                    return true;
                } catch {
                    // Continua a tentar os restantes elementos.
                }
            }
        }

        return false;
    }

    function fireAttachmentControl(control) {
        if (!(control instanceof HTMLElement)) {
            return false;
        }

        try {
            control.scrollIntoView({
                block: 'center',
                inline: 'nearest'
            });
        } catch {
            // Best effort.
        }

        try {
            control.focus({
                preventScroll: true
            });
        } catch {
            // O elemento pode não aceitar foco.
        }

        const rectangle = control.getBoundingClientRect();
        const clientX = rectangle.left + Math.max(1, rectangle.width / 2);
        const clientY = rectangle.top + Math.max(1, rectangle.height / 2);

        const down = {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            clientX,
            clientY,
            button: 0,
            buttons: 1
        };

        const up = {
            ...down,
            buttons: 0
        };

        let attempted = false;

        try {
            if (globalThis.PointerEvent) {
                control.dispatchEvent(
                    new PointerEvent('pointerdown', down)
                );

                control.dispatchEvent(
                    new PointerEvent('pointerup', up)
                );
            }

            control.dispatchEvent(
                new MouseEvent('mousedown', down)
            );

            control.dispatchEvent(
                new MouseEvent('mouseup', up)
            );

            control.dispatchEvent(
                new MouseEvent('click', {
                    ...up,
                    detail: 1
                })
            );

            attempted = true;
        } catch {
            // Tenta os métodos seguintes.
        }

        try {
            HTMLElement.prototype.click.call(control);
            attempted = true;
        } catch {
            // Alguns elementos não expõem click nativo.
        }

        try {
            control.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    bubbles: true,
                    cancelable: true,
                    composed: true
                })
            );

            control.dispatchEvent(
                new KeyboardEvent('keyup', {
                    key: 'Enter',
                    code: 'Enter',
                    bubbles: true,
                    cancelable: true,
                    composed: true
                })
            );

            attempted = true;
        } catch {
            // Best effort.
        }

        return invokeReactAttachmentClick(control) || attempted;
    }


    function findExactSandboxAttachmentControl(
        assistant,
        fileName
    ) {
        const wanted =
            String(fileName || '')
                .trim()
                .toLowerCase();

        const turn =
            turnContainer(assistant);

        if (
            !wanted ||
            !(turn instanceof Element)
        ) {
            return null;
        }

        const candidates = [];
        const candidateKeys =
            new Set();

        function normalizedHref(value) {
            const href =
                String(value || '')
                    .trim()
                    .replace(/\\u0026/gi, '&')
                    .replace(/\\\//g, '/');

            if (
                !/^sandbox:\/mnt\/data\//i
                    .test(href)
            ) {
                return '';
            }

            let decoded = href;

            try {
                decoded =
                    decodeURIComponent(href);
            } catch {
                // Usa o valor original.
            }

            return decoded
                .toLowerCase()
                .includes(wanted)
                ? href
                : '';
        }

        function labelOf(node) {
            if (!(node instanceof Element)) {
                return '';
            }

            return [
                node.textContent || '',
                node.getAttribute(
                    'aria-label'
                ) || '',
                node.getAttribute(
                    'title'
                ) || '',
                node.getAttribute(
                    'download'
                ) || '',
                node.getAttribute(
                    'href'
                ) || ''
            ]
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();
        }

        function add(
            control,
            href,
            source,
            score = 0
        ) {
            const cleanHref =
                normalizedHref(href);

            if (!cleanHref) {
                return;
            }

            let usableControl =
                control instanceof HTMLElement
                    ? control
                    : null;

            if (
                usableControl &&
                !turn.contains(usableControl)
            ) {
                usableControl = null;
            }

            if (!usableControl) {
                return;
            }

            const key =
                cleanHref +
                '|' +
                source +
                '|' +
                String(
                    usableControl.tagName ||
                    ''
                );

            if (candidateKeys.has(key)) {
                return;
            }

            candidateKeys.add(key);

            let total =
                Number(score || 0);

            if (
                usableControl.matches(
                    'a, button, [role="button"], [role="link"]'
                )
            ) {
                total += 800;
            }

            if (
                usableControl.matches('a')
            ) {
                total += 600;
            }

            if (
                labelOf(usableControl)
                    .includes(wanted)
            ) {
                total += 1000;
            }

            candidates.push({
                control:
                    usableControl,
                href:
                    cleanHref,
                source,
                score:
                    total
            });
        }

        for (
            const anchor of
            turn.querySelectorAll(
                'a[href]'
            )
        ) {
            add(
                anchor,
                anchor.getAttribute(
                    'href'
                ) || '',
                'dom-anchor',
                3000
            );
        }

        const nodes = [
            turn,
            ...turn.querySelectorAll('*')
        ];

        let visitedObjects = 0;
        const globallySeen =
            new WeakSet();

        function walkReact(
            value,
            ownerNode,
            path,
            depth
        ) {
            if (
                depth > 16 ||
                visitedObjects > 30000
            ) {
                return;
            }

            if (
                !value ||
                (
                    typeof value !==
                    'object' &&
                    typeof value !==
                    'function'
                )
            ) {
                return;
            }

            try {
                if (globallySeen.has(value)) {
                    return;
                }

                globallySeen.add(value);
            } catch {
                return;
            }

            visitedObjects++;

            const stateNode =
                value.stateNode instanceof
                    HTMLElement
                    ? value.stateNode
                    : ownerNode;

            for (
                const propsName of
                [
                    'pendingProps',
                    'memoizedProps',
                    'props'
                ]
            ) {
                const props =
                    value[propsName];

                if (
                    props &&
                    typeof props ===
                        'object'
                ) {
                    add(
                        stateNode,
                        props.href,
                        path +
                        '.' +
                        propsName +
                        '.href',
                        5000
                    );

                    add(
                        stateNode,
                        props.downloadUrl,
                        path +
                        '.' +
                        propsName +
                        '.downloadUrl',
                        4500
                    );

                    add(
                        stateNode,
                        props.url,
                        path +
                        '.' +
                        propsName +
                        '.url',
                        4000
                    );
                }
            }

            let entries = [];

            try {
                entries =
                    Object.entries(value);
            } catch {
                return;
            }

            entries.sort(
                ([left], [right]) => {
                    const important =
                        /pendingProps|memoizedProps|props|href|url|stateNode|child|return|alternate/i;

                    return (
                        Number(
                            important.test(right)
                        ) -
                        Number(
                            important.test(left)
                        )
                    );
                }
            );

            for (
                const [key, child] of
                entries.slice(0, 160)
            ) {
                if (
                    typeof child ===
                        'string' &&
                    /href|url|download|attachment|file/i
                        .test(key)
                ) {
                    add(
                        stateNode,
                        child,
                        path + '.' + key,
                        3500
                    );
                }

                walkReact(
                    child,
                    stateNode,
                    path + '.' + key,
                    depth + 1
                );
            }
        }

        for (
            let index = 0;
            index < nodes.length;
            index++
        ) {
            const node =
                nodes[index];

            if (!(node instanceof Element)) {
                continue;
            }

            let keys = [];

            try {
                keys =
                    Object.keys(node);
            } catch {
                keys = [];
            }

            for (const key of keys) {
                if (
                    !key.startsWith(
                        '__reactFiber$'
                    ) &&
                    !key.startsWith(
                        '__reactProps$'
                    ) &&
                    !key.startsWith(
                        '__reactContainer$'
                    )
                ) {
                    continue;
                }

                try {
                    walkReact(
                        node[key],
                        node,
                        'node[' +
                            index +
                            '].' +
                            key,
                        0
                    );
                } catch {
                    // Continua.
                }
            }
        }

        candidates.sort(
            (left, right) =>
                right.score -
                left.score
        );

        return candidates.length
            ? candidates[0]
            : null;
    }

    async function queueExactSandboxFileJob(
        assistant,
        manifest,
        fileName,
        jobId,
        protocol
    ) {
        const resolved =
            findExactSandboxAttachmentControl(
                assistant,
                fileName
            );

        if (
            !resolved ||
            !(resolved.control instanceof HTMLElement) ||
            !resolved.href
        ) {
            throw new Error(
                'O React Fiber da mensagem exata não expôs um controlo utilizável para ' +
                fileName +
                '.'
            );
        }

        const control =
            resolved.control;

        const href =
            String(
                resolved.href || ''
            ).trim();

        if (
            !/^sandbox:\/mnt\/data\//i
                .test(href)
        ) {
            throw new Error(
                'O link encontrado não corresponde ao anexo sandbox exato.'
            );
        }

        setStatus(
            'Watcher preparado. A acionar uma única vez o link sandbox exato de ' +
            fileName +
            '…'
        );

        const startedAt =
            Date.now();

        const requestPromise =
            request({
                method: 'POST',
                url:
                    BRIDGE_URL +
                    '/run-file',
                headers:
                    authHeaders(),
                data:
                    JSON.stringify({
                        file:
                            fileName,
                        downloadStartedAt:
                            startedAt - 3000,
                        sourceProtocol:
                            protocol,
                        jobId,
                        commandKey:
                            jobId,
                        signature:
                            jobId,
                        purpose:
                            String(
                                manifest.purpose ||
                                ''
                            ),
                        clientId:
                            TAB_ID,
                        tabId:
                            TAB_ID,
                        conversationId:
                            conversationId(),
                        clientVersion:
                            VERSION
                    }),
                timeout:
                    125000
            });

        await wait(200);

        let fired =
            false;

        try {
            fired =
                invokeReactAttachmentClick(
                    control
                );
        } catch {
            fired =
                false;
        }

        if (
            !fired &&
            control.matches('a')
        ) {
            try {
                if (
                    !control.getAttribute(
                        'href'
                    )
                ) {
                    control.setAttribute(
                        'href',
                        href
                    );
                }

                HTMLElement.prototype
                    .click
                    .call(control);

                fired = true;
            } catch {
                fired =
                    false;
            }
        }

        if (!fired) {
            try {
                control.dispatchEvent(
                    new MouseEvent(
                        'click',
                        {
                            bubbles:
                                true,
                            cancelable:
                                true,
                            composed:
                                true,
                            view:
                                window,
                            button:
                                0,
                            buttons:
                                0,
                            detail:
                                1
                        }
                    )
                );

                fired = true;
            } catch {
                fired =
                    false;
            }
        }

        if (!fired) {
            throw new Error(
                'Não foi possível acionar o link sandbox exato.'
            );
        }

        setStatus(
            'Link sandbox exato acionado uma vez. A aguardar o ficheiro local…'
        );

        const response =
            await requestPromise;

        const data =
            parseJson(response);

        if (
            ![200, 202].includes(
                Number(response.status)
            ) ||
            !data.jobId
        ) {
            throw new Error(
                data.error ||
                (
                    'A bridge rejeitou o ficheiro descarregado: HTTP ' +
                    response.status +
                    '.'
                )
            );
        }

        activeJobId =
            String(data.jobId);

        activeManifest =
            manifest;

        setStatus(
            'Job ' +
            activeJobId +
            ' em execução a partir do anexo sandbox exato.'
        );

        await monitorActiveJob();
    }


    async function lpxUnifiedPageWorldClick(assistant, fileName) {
        const turn = turnContainer(assistant);
        const messageId = turn && turn.getAttribute('data-message-id');

        if (!messageId) {
            return {
                ok: false,
                error: 'message-id-missing'
            };
        }

        const marker = 'data-lpx-unified-' + simpleHash(messageId + fileName + String(Date.now()) + String(Math.random()));
        const script = document.createElement('script');
        const payload = {
            messageId,
            fileName,
            marker
        };

        script.textContent = '(' + function pageWorldClick(input) {
            const root = document.querySelector('[data-message-id="' + CSS.escape(input.messageId) + '"]');
            const report = {
                ok: Boolean(root),
                exactNodes: 0,
                reactObjects: 0,
                clickAttempts: 0,
                clickSuccesses: 0,
                errors: []
            };
            const wanted = String(input.fileName || '').toLowerCase();

            function labelOf(node) {
                if (!(node instanceof Element)) {
                    return '';
                }

                return [
                    node.textContent || '',
                    node.getAttribute('aria-label') || '',
                    node.getAttribute('title') || '',
                    node.getAttribute('download') || '',
                    node.getAttribute('href') || ''
                ].join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
            }

            function strongClick(node) {
                if (!(node instanceof HTMLElement)) {
                    return;
                }

                report.clickAttempts++;
                let clicked = false;
                let current = node;

                for (let depth = 0; current && depth < 10; depth++, current = current.parentElement) {
                    for (const key of Object.keys(current)) {
                        if (!key.startsWith('__reactProps$')) {
                            continue;
                        }

                        const props = current[key];

                        if (!props || typeof props.onClick !== 'function') {
                            continue;
                        }

                        try {
                            props.onClick({
                                type: 'click',
                                target: current,
                                currentTarget: current,
                                nativeEvent: new MouseEvent('click', {
                                    bubbles: true,
                                    cancelable: true,
                                    composed: true,
                                    view: window
                                }),
                                button: 0,
                                buttons: 0,
                                detail: 1,
                                preventDefault() {},
                                stopPropagation() {},
                                persist() {}
                            });

                            clicked = true;
                        } catch (error) {
                            report.errors.push(String(error && error.message || error).slice(0, 300));
                        }
                    }

                    if (current.matches('a, button, [role="button"], [role="link"], [tabindex]')) {
                        try {
                            current.click();
                            clicked = true;
                        } catch (error) {
                            report.errors.push(String(error && error.message || error).slice(0, 300));
                        }
                    }
                }

                if (clicked) {
                    report.clickSuccesses++;
                }
            }

            if (root) {
                const nodes = [root, ...root.querySelectorAll('*')].slice(0, 1800);

                for (const node of nodes) {
                    if (wanted && labelOf(node).includes(wanted)) {
                        report.exactNodes++;
                        strongClick(node);
                    }
                }

                const seen = new WeakSet();
                let visited = 0;

                function nearby(fiber) {
                    const nodes = [];
                    const unique = new Set();

                    function add(value) {
                        if (!(value instanceof HTMLElement) || !root.contains(value) || unique.has(value)) {
                            return;
                        }

                        unique.add(value);
                        nodes.push(value);
                    }

                    let current = fiber;

                    for (let depth = 0; current && depth < 12; depth++, current = current.return) {
                        add(current.stateNode);
                        add(current.child && current.child.stateNode);
                        add(current.sibling && current.sibling.stateNode);
                        add(current.alternate && current.alternate.stateNode);
                    }

                    return nodes;
                }

                function walk(value, owner, depth, activeFiber) {
                    if (depth > 20 || visited > 70000) {
                        return;
                    }

                    if (typeof value === 'string') {
                        let decoded = value.toLowerCase();

                        try {
                            decoded = decodeURIComponent(value).toLowerCase();
                        } catch {
                            // Keep original.
                        }

                        if (wanted && decoded.includes(wanted)) {
                            for (const node of nearby(activeFiber)) {
                                strongClick(node);
                            }

                            strongClick(owner);
                        }

                        return;
                    }

                    if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
                        return;
                    }

                    try {
                        if (seen.has(value)) {
                            return;
                        }

                        seen.add(value);
                    } catch {
                        return;
                    }

                    visited++;
                    report.reactObjects++;

                    const looksLikeFiber =
                        Object.prototype.hasOwnProperty.call(value, 'pendingProps') ||
                        Object.prototype.hasOwnProperty.call(value, 'memoizedProps') ||
                        Object.prototype.hasOwnProperty.call(value, 'stateNode');

                    const fiber = looksLikeFiber ? value : activeFiber;
                    const stateNode = value.stateNode instanceof HTMLElement ? value.stateNode : owner;

                    for (const propsName of ['pendingProps', 'memoizedProps', 'props']) {
                        const props = value[propsName];

                        if (!props || typeof props !== 'object') {
                            continue;
                        }

                        const values = [
                            props.href,
                            props.url,
                            props.downloadUrl,
                            props.fileId,
                            props.file_id,
                            props.asset_pointer,
                            typeof props.children === 'string' ? props.children : ''
                        ];

                        const relevant = values.some(item => {
                            if (!item) {
                                return false;
                            }

                            let candidate = String(item).toLowerCase();

                            try {
                                candidate = decodeURIComponent(String(item)).toLowerCase();
                            } catch {
                                // Keep original.
                            }

                            return wanted && candidate.includes(wanted);
                        });

                        if (relevant) {
                            for (const node of nearby(fiber)) {
                                strongClick(node);
                            }

                            strongClick(stateNode);
                        }
                    }

                    let entries = [];

                    try {
                        entries = Object.entries(value);
                    } catch {
                        return;
                    }

                    entries.sort(([left], [right]) => {
                        const important = /pendingProps|memoizedProps|props|href|url|file|asset|pointer|download|stateNode|child|return|alternate|sibling/i;
                        return Number(important.test(right)) - Number(important.test(left));
                    });

                    for (const [, child] of entries.slice(0, 220)) {
                        walk(child, stateNode, depth + 1, fiber);
                    }
                }

                for (const node of nodes) {
                    for (const key of Object.keys(node)) {
                        if (key.startsWith('__reactFiber$') || key.startsWith('__reactProps$') || key.startsWith('__reactContainer$')) {
                            walk(node[key], node, 0, null);
                        }
                    }
                }
            }

            document.documentElement.setAttribute(input.marker, encodeURIComponent(JSON.stringify(report)));
        } + ')(' + JSON.stringify(payload) + ');';

        (document.head || document.documentElement).appendChild(script);
        script.remove();

        await wait(180);

        const encoded = document.documentElement.getAttribute(marker);
        document.documentElement.removeAttribute(marker);

        if (!encoded) {
            return {
                ok: false,
                error: 'page-world-no-result'
            };
        }

        try {
            return JSON.parse(decodeURIComponent(encoded));
        } catch (error) {
            return {
                ok: false,
                error: 'page-world-invalid-result:' + String(error && error.message || error)
            };
        }
    }

    async function queueDownloadedFileJob(
        assistant,
        manifest,
        fileName,
        jobId,
        protocol
    ) {
        const controls = findAttachmentControls(
            assistant,
            fileName
        );

        if (!controls.length) {
            throw new Error(
                'Não foi encontrado nenhum elemento acionável no cartão do anexo ' +
                fileName +
                '.'
            );
        }

        setStatus(
            'Watcher local preparado. A tentar ' +
            controls.length +
            ' elementos do cartão de ' +
            fileName +
            '…'
        );

        let requestFinished = false;
        let requestResult = null;
        let requestError = null;

        const requestPromise = request({
            method: 'POST',
            url: BRIDGE_URL + '/run-file',
            headers: authHeaders(),
            data: JSON.stringify({
                file: fileName,
                downloadStartedAt: Date.now() - 5000,
                sourceProtocol: protocol,
                jobId,
                commandKey: jobId,
                signature: jobId,
                purpose: String(manifest.purpose || ''),
                clientId: TAB_ID,
                tabId: TAB_ID,
                conversationId: conversationId(),
                clientVersion: VERSION
            }),
            timeout: 125000
        }).then(response => {
            requestFinished = true;
            requestResult = response;
            return response;
        }, error => {
            requestFinished = true;
            requestError = error;
            return null;
        });

        let attempts = 0;

        for (const control of controls) {
            attempts++;

            setStatus(
                'A acionar o cartão do anexo · tentativa ' +
                attempts +
                '/' +
                controls.length +
                '…'
            );

            fireAttachmentControl(control);

            for (let waitIndex = 0; waitIndex < 6; waitIndex++) {
                if (requestFinished) {
                    break;
                }

                await wait(175);
            }

            if (requestFinished) {
                break;
            }
        }

        if (!requestFinished) {
            setStatus(
                'Os controlos do DOM/React não concluíram o download. A repetir no contexto real da página…'
            );

            const pageWorld = await lpxUnifiedPageWorldClick(
                assistant,
                fileName
            );

            lastAttachmentDiagnostic = [
                lastAttachmentDiagnostic,
                'pageWorld=' + JSON.stringify(pageWorld)
            ].filter(Boolean).join(';');

            for (let waitIndex = 0; waitIndex < 30 && !requestFinished; waitIndex++) {
                await wait(200);
            }
        }

        if (!requestFinished) {
            setStatus(
                'Todas as estratégias exatas foram acionadas. A aguardar o watcher local…'
            );
        }

        await requestPromise;

        if (requestError) {
            throw new Error(
                String(
                    requestError &&
                    requestError.message ||
                    requestError
                ) +
                '. Diagnóstico consolidado: ' +
                (
                    lastAttachmentDiagnostic ||
                    'indisponível'
                )
            );
        }

        const response = requestResult;
        const data = parseJson(response);

        if (
            ![200, 202].includes(Number(response.status)) ||
            !data.jobId
        ) {
            throw new Error(
                data.error ||
                (
                    'A bridge rejeitou o ficheiro: HTTP ' +
                    response.status +
                    '.'
                )
            );
        }

        activeJobId = String(data.jobId);
        activeManifest = manifest;

        setStatus(
            'Job ' +
            activeJobId +
            ' em execução a partir do ficheiro descarregado localmente.'
        );

        await monitorActiveJob();
    }


    const CHATGPT_FETCH_TIMEOUT_MS =
        12 * 1000;

    async function fetchWithTimeout(
        url,
        init = {},
        timeoutMs = CHATGPT_FETCH_TIMEOUT_MS
    ) {
        const controller =
            new AbortController();

        const timer =
            setTimeout(
                () => controller.abort(),
                timeoutMs
            );

        try {
            return await fetch(
                url,
                {
                    ...init,
                    signal: controller.signal
                }
            );
        } catch (error) {
            if (controller.signal.aborted) {
                throw new Error(
                    'Timeout ao consultar ' +
                    String(url) +
                    ' após ' +
                    timeoutMs +
                    ' ms.'
                );
            }

            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    let chatgptAccessTokenCache = '';

    function rawConversationUuid() {
        const match = location.pathname.match(
            /(?:^|\/)c\/([A-Za-z0-9-]+)(?:\/|$)/
        );

        return match ? match[1] : '';
    }

    async function getChatgptAccessToken(forceRefresh = false) {
        if (forceRefresh) {
            chatgptAccessTokenCache = '';
        }

        if (chatgptAccessTokenCache) {
            return chatgptAccessTokenCache;
        }

        const response = await fetchWithTimeout(
            '/api/auth/session',
            {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store',
                headers: {
                    Accept: 'application/json'
                }
            }
        );

        if (!response.ok) {
            throw new Error(
                'Sessão ChatGPT indisponível: HTTP ' +
                response.status +
                '.'
            );
        }

        const data = await response.json();

        const accessToken = String(
            data && (
                data.accessToken ||
                data.access_token
            ) || ''
        ).trim();

        if (!accessToken) {
            throw new Error(
                'A sessão do ChatGPT não devolveu um accessToken.'
            );
        }

        chatgptAccessTokenCache = accessToken;
        return accessToken;
    }

    async function chatgptApiFetch(url, init = {}) {
        let response = null;

        for (let attempt = 0; attempt < 2; attempt++) {
            const accessToken =
                await getChatgptAccessToken(
                    attempt > 0
                );

            const headers = new Headers(
                init.headers || {}
            );

            headers.set(
                'Authorization',
                'Bearer ' + accessToken
            );

            if (!headers.has('Accept')) {
                headers.set('Accept', '*/*');
            }

            response = await fetchWithTimeout(
                url,
                {
                    ...init,
                    headers,
                    credentials: 'include',
                    cache: 'no-store'
                }
            );

            if (
                ![401, 403].includes(
                    Number(response.status)
                )
            ) {
                return response;
            }

            chatgptAccessTokenCache = '';
        }

        return response;
    }

    function attachmentUrlsFromValue(value) {
        let raw = String(value || '')
            .trim()
            .replace(/\\u0026/gi, '&')
            .replace(/\\\//g, '/')
            .replace(/&amp;/gi, '&');

        const urls = [];

        function add(candidate) {
            const clean = String(candidate || '').trim();

            if (
                clean &&
                !urls.includes(clean)
            ) {
                urls.push(clean);
            }
        }

        if (!raw || /^sandbox:/i.test(raw)) {
            return urls;
        }

        try {
            raw = decodeURIComponent(raw);
        } catch {
            // Mantém o valor original.
        }

        if (/^https?:\/\//i.test(raw)) {
            add(raw);
            return urls;
        }

        if (/^\/backend-api\//i.test(raw)) {
            try {
                add(new URL(raw, location.origin).href);
            } catch {
                // URL inválido.
            }

            return urls;
        }

        if (/^file-service:\/\//i.test(raw)) {
            raw = raw.replace(
                /^file-service:\/\//i,
                ''
            );
        }

        if (
            /^file[_-][A-Za-z0-9_-]{8,}$/.test(raw)
        ) {
            const encoded = encodeURIComponent(raw);

            add(
                location.origin +
                '/backend-api/files/' +
                encoded +
                '/download'
            );
        }

        return urls;
    }

    function collectConversationFileCandidates(
        root,
        fileName,
        jobId,
        suppliedFileId
    ) {
        const wantedFile = String(
            fileName || ''
        ).trim().toLowerCase();

        const wantedJob = String(
            jobId || ''
        ).trim().toLowerCase();

        const candidates = new Map();
        const seen = new WeakSet();

        let visited = 0;

        function add(rawValue, score, path, context) {
            const raw = String(rawValue || '').trim();

            if (!raw) {
                return;
            }

            const values = [raw];

            const matches = raw.match(
                /https?:\/\/[^\s"'<>\\]+|\/backend-api\/[^\s"'<>\\]+|file-service:\/\/[A-Za-z0-9_-]+|file[_-][A-Za-z0-9_-]{8,}/gi
            ) || [];

            values.push(...matches);

            for (const value of values) {
                const urls =
                    attachmentUrlsFromValue(value);

                for (const url of urls) {
                    const haystack = [
                        value,
                        path,
                        context
                    ].join(' ').toLowerCase();

                    let finalScore = score;

                    if (
                        wantedFile &&
                        haystack.includes(wantedFile)
                    ) {
                        finalScore += 3500;
                    }

                    if (
                        wantedJob &&
                        haystack.includes(wantedJob)
                    ) {
                        finalScore += 4000;
                    }

                    if (
                        /asset_pointer|file_id|fileId|download_url|downloadUrl|attachment|url|href/i
                            .test(path)
                    ) {
                        finalScore += 1500;
                    }

                    if (
                        /files\.oaiusercontent\.com/i
                            .test(url)
                    ) {
                        finalScore += 2200;
                    }

                    if (
                        /\/backend-api\/files\//i
                            .test(url)
                    ) {
                        finalScore += 1800;
                    }

                    if (
                        /file-service:\/\//i
                            .test(value)
                    ) {
                        finalScore += 1600;
                    }

                    const current =
                        candidates.get(url);

                    if (
                        !current ||
                        finalScore > current.score
                    ) {
                        candidates.set(
                            url,
                            {
                                url,
                                score: finalScore,
                                source: path
                            }
                        );
                    }
                }
            }
        }

        function walk(
            value,
            depth = 0,
            path = '',
            score = 0,
            context = ''
        ) {
            if (
                depth > 28 ||
                visited > 60000 ||
                candidates.size > 600
            ) {
                return;
            }

            if (typeof value === 'string') {
                add(
                    value,
                    score,
                    path,
                    context
                );

                return;
            }

            if (
                !value ||
                (
                    typeof value !== 'object' &&
                    typeof value !== 'function'
                )
            ) {
                return;
            }

            try {
                if (seen.has(value)) {
                    return;
                }

                seen.add(value);
            } catch {
                return;
            }

            visited++;

            let shallow = '';

            try {
                shallow = Object.entries(value)
                    .filter(([, child]) =>
                        typeof child === 'string'
                    )
                    .slice(0, 60)
                    .map(([key, child]) =>
                        key + ':' + child
                    )
                    .join(' ')
                    .toLowerCase();
            } catch {
                shallow = '';
            }

            let localScore = score;

            if (
                wantedFile &&
                shallow.includes(wantedFile)
            ) {
                localScore += 3000;
            }

            if (
                wantedJob &&
                shallow.includes(wantedJob)
            ) {
                localScore += 3500;
            }

            for (const key of [
                'asset_pointer',
                'file_id',
                'fileId',
                'download_url',
                'downloadUrl',
                'url',
                'href'
            ]) {
                if (
                    typeof value[key] === 'string'
                ) {
                    add(
                        value[key],
                        localScore + 2500,
                        path + '.' + key,
                        shallow
                    );
                }
            }

            let entries = [];

            try {
                entries = Object.entries(value);
            } catch {
                return;
            }

            entries.sort(
                ([left], [right]) => {
                    const important =
                        /asset|pointer|file|attachment|download|url|href|metadata|content|message/i;

                    return (
                        Number(important.test(right)) -
                        Number(important.test(left))
                    );
                }
            );

            for (const [key, child] of entries) {
                walk(
                    child,
                    depth + 1,
                    path
                        ? path + '.' + key
                        : key,
                    localScore,
                    shallow
                );
            }
        }

        if (suppliedFileId) {
            add(
                suppliedFileId,
                20000,
                'manifest.fileId',
                fileName + ' ' + jobId
            );
        }

        const hasConversationMapping =
            Boolean(
                root &&
                root.mapping &&
                typeof root.mapping === 'object'
            );

        let matchedMessages = [];

        if (hasConversationMapping) {
            matchedMessages = Object.values(
                root.mapping
            )
                .map(node =>
                    node && node.message
                )
                .filter(Boolean)
                .filter(message => {
                    try {
                        const serialized =
                            JSON.stringify(message)
                                .toLowerCase();

                        return Boolean(
                            (
                                wantedFile &&
                                serialized.includes(
                                    wantedFile
                                )
                            ) ||
                            (
                                wantedJob &&
                                serialized.includes(
                                    wantedJob
                                )
                            )
                        );
                    } catch {
                        return false;
                    }
                });

            for (const message of matchedMessages) {
                walk(
                    message,
                    0,
                    'matchedMessage',
                    6000,
                    wantedFile + ' ' + wantedJob
                );
            }
        } else {
            walk(
                root,
                0,
                'metadata',
                0,
                ''
            );
        }

        return {
            candidates: [
                ...candidates.values()
            ].sort(
                (left, right) =>
                    right.score - left.score
            ),
            visited,
            matchedMessages:
                matchedMessages.length
        };
    }


    function attachmentPayloadRejection(
        value,
        contentType = ''
    ) {
        const body = String(value || '')
            .replace(/^\uFEFF/, '')
            .trim();

        const type = String(
            contentType || ''
        ).toLowerCase();

        if (!body) {
            return 'empty';
        }

        if (
            type.includes('text/html') ||
            type.includes('application/xhtml')
        ) {
            return 'html-content-type';
        }

        const beginning =
            body.slice(0, 12000);

        if (
            /^(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i
                .test(beginning)
        ) {
            return 'html-document';
        }

        if (
            /<script\b[\s>]/i.test(beginning) &&
            (
                /\bwindow\./i.test(beginning) ||
                /\bdocument\./i.test(beginning) ||
                /\bvar\s+_paq\b/i.test(beginning)
            )
        ) {
            return 'html-script';
        }

        if (
            /chrome\.userScripts/i.test(beginning) ||
            (
                /schema\.org/i.test(beginning) &&
                /<title\b/i.test(beginning)
            )
        ) {
            return 'web-page';
        }

        if (/^<\?xml\b/i.test(beginning)) {
            return 'xml-document';
        }

        return '';
    }

    function usablePowerShellPayload(
        value,
        contentType = ''
    ) {
        return !attachmentPayloadRejection(
            value,
            contentType
        );
    }

    async function gmDownloadText(url) {
        try {
            const response = await request({
                method: 'GET',
                url,
                responseType: 'arraybuffer',
                timeout: 30000
            });

            if (
                Number(response.status) < 200 ||
                Number(response.status) >= 400
            ) {
                return {
                    ok: false,
                    status: Number(response.status),
                    text: ''
                };
            }

            const bytes =
                response.response instanceof ArrayBuffer
                    ? new Uint8Array(
                        response.response
                    )
                    : new TextEncoder().encode(
                        String(
                            response.responseText || ''
                        )
                    );

            return {
                ok: true,
                status: Number(response.status),
                text:
                    new TextDecoder('utf-8')
                        .decode(bytes)
            };
        } catch {
            return {
                ok: false,
                status: 0,
                text: ''
            };
        }
    }


    async function resolveExplicitFileId(
        fileId,
        fileName,
        jobId
    ) {
        const queue =
            attachmentUrlsFromValue(fileId)
                .map(url => ({
                    url,
                    source: 'manifest.fileId'
                }));

        const attempted =
            new Set();

        const statuses = [];

        for (
            let index = 0;
            index < queue.length &&
            index < 12;
            index++
        ) {
            const candidate =
                queue[index];

            if (
                !candidate ||
                !candidate.url ||
                attempted.has(candidate.url)
            ) {
                continue;
            }

            attempted.add(candidate.url);

            setStatus(
                'A resolver diretamente o fileId do anexo ' +
                (index + 1) +
                '/' +
                queue.length +
                '…'
            );

            let response = null;

            try {
                response =
                    await chatgptApiFetch(
                        candidate.url,
                        {
                            method: 'GET',
                            redirect: 'follow'
                        }
                    );
            } catch (error) {
                statuses.push(
                    'fetch-error:' +
                    String(
                        error &&
                        error.message ||
                        error
                    )
                );
            }

            if (
                response &&
                response.ok
            ) {
                const contentType =
                    String(
                        response.headers.get(
                            'content-type'
                        ) || ''
                    ).toLowerCase();

                if (
                    contentType.includes(
                        'application/json'
                    )
                ) {
                    try {
                        const metadata =
                            await response.json();

                        const nested =
                            collectConversationFileCandidates(
                                metadata,
                                fileName,
                                jobId,
                                ''
                            ).candidates;

                        for (const item of nested) {
                            if (
                                item &&
                                item.url &&
                                !attempted.has(item.url) &&
                                !queue.some(
                                    queued =>
                                        queued.url ===
                                        item.url
                                )
                            ) {
                                queue.push(item);
                            }
                        }

                        statuses.push(
                            String(response.status) +
                            'j'
                        );
                    } catch (error) {
                        statuses.push(
                            String(response.status) +
                            '-json-error:' +
                            String(
                                error &&
                                error.message ||
                                error
                            )
                        );
                    }
                } else {
                    const body =
                        await response.text();

                    if (
                        usablePowerShellPayload(
                            body,
                            contentType
                        )
                    ) {
                        lastAttachmentDiagnostic = [
                            'explicitFileId=ok',
                            'transport=fetch',
                            'selected=' +
                                (index + 1),
                            'HTTP=' +
                                response.status
                        ].join(';');

                        return body;
                    }

                    statuses.push(
                        String(response.status) +
                        '-rejected-' +
                        attachmentPayloadRejection(
                            body,
                            contentType
                        )
                    );
                }
            } else {
                statuses.push(
                    'HTTP=' +
                    Number(
                        response &&
                        response.status ||
                        0
                    )
                );
            }

            const gmResult =
                await gmDownloadText(
                    candidate.url
                );

            if (
                gmResult.ok &&
                usablePowerShellPayload(
                    gmResult.text,
                    ''
                )
            ) {
                lastAttachmentDiagnostic = [
                    'explicitFileId=ok',
                    'transport=GM',
                    'selected=' +
                        (index + 1),
                    'HTTP=' +
                        gmResult.status
                ].join(';');

                return gmResult.text;
            }

            if (gmResult.ok) {
                statuses.push(
                    String(gmResult.status) +
                    '-gm-rejected-' +
                    attachmentPayloadRejection(
                        gmResult.text,
                        ''
                    )
                );
            }
        }

        lastAttachmentDiagnostic = [
            'explicitFileId=failed',
            'fileId=' + fileId,
            'attempts=' +
                statuses
                    .slice(0, 20)
                    .join(',')
        ].join(';');

        return '';
    }


    function lpxDiagnosticClean(value, limit = 320) {
        let output = String(value || '')
            .replace(/\s+/g, ' ')
            .trim();

        output = output
            .replace(
                /(Bearer\s+)[A-Za-z0-9._~-]+/gi,
                '$1[REDACTED]'
            )
            .replace(
                /([?&](?:token|access_token|sig|signature|auth|authorization|key)=)[^&\s]+/gi,
                '$1[REDACTED]'
            )
            .replace(
                /(https?:\/\/[^?\s]+)\?[^\s]+/gi,
                '$1?[REDACTED]'
            );

        return output.slice(0, limit);
    }

    function lpxCaptureAttachmentReality(
        assistant,
        fileName,
        jobId
    ) {
        const turn = turnContainer(assistant);

        const report = {
            protocol:
                'PSBRIDGE_ATTACHMENT_DIAGNOSTIC_V2',
            jobId,
            fileName,
            bridgeVersion: VERSION,
            pathname: location.pathname,
            capturedAt:
                new Date().toISOString(),
            turnFound:
                turn instanceof Element,
            matches: [],
            reactFindings: []
        };

        if (!(turn instanceof Element)) {
            return report;
        }

        report.turn = {
            tag:
                String(
                    turn.tagName || ''
                ).toLowerCase(),
            messageId:
                lpxDiagnosticClean(
                    turn.getAttribute(
                        'data-message-id'
                    ) || ''
                ),
            testId:
                lpxDiagnosticClean(
                    turn.getAttribute(
                        'data-testid'
                    ) || ''
                ),
            authorRole:
                lpxDiagnosticClean(
                    turn.getAttribute(
                        'data-message-author-role'
                    ) || ''
                )
        };

        const wantedFile =
            String(fileName || '')
                .toLowerCase();

        const wantedJob =
            String(jobId || '')
                .toLowerCase();

        const selector = [
            'a[href]',
            'button',
            '[role="button"]',
            '[role="link"]',
            '[download]',
            '[data-testid]',
            '[data-file-id]',
            '[data-id]'
        ].join(', ');

        const all =
            [...turn.querySelectorAll('*')];

        const matchedNodes = [];

        for (
            let index = 0;
            index < all.length;
            index++
        ) {
            const node = all[index];

            const textValue =
                String(
                    node.innerText ||
                    node.textContent ||
                    ''
                )
                    .replace(/\s+/g, ' ')
                    .trim();

            const href =
                String(
                    node.getAttribute &&
                    node.getAttribute('href') ||
                    ''
                );

            const haystack =
                (
                    textValue +
                    ' ' +
                    href
                ).toLowerCase();

            const relevant =
                (
                    wantedFile &&
                    haystack.includes(
                        wantedFile
                    )
                ) ||
                (
                    wantedJob &&
                    haystack.includes(
                        wantedJob
                    )
                ) ||
                node.matches?.(selector);

            if (!relevant) {
                continue;
            }

            matchedNodes.push(node);

            if (report.matches.length >= 8) {
                continue;
            }

            const attributes = {};

            for (
                const attributeName of [
                    'href',
                    'download',
                    'role',
                    'aria-label',
                    'title',
                    'data-testid',
                    'data-file-id',
                    'data-id',
                    'data-state'
                ]
            ) {
                if (
                    node.hasAttribute &&
                    node.hasAttribute(
                        attributeName
                    )
                ) {
                    attributes[attributeName] =
                        lpxDiagnosticClean(
                            node.getAttribute(
                                attributeName
                            )
                        );
                }
            }

            report.matches.push({
                index,
                tag:
                    String(
                        node.tagName || ''
                    ).toLowerCase(),
                text:
                    lpxDiagnosticClean(
                        textValue,
                        260
                    ),
                attributes,
                datasetKeys:
                    node.dataset
                        ? Object.keys(
                            node.dataset
                        ).slice(0, 20)
                        : [],
                ownProperties:
                    Object.getOwnPropertyNames(
                        node
                    )
                        .filter(
                            name =>
                                /^__react/i.test(
                                    name
                                )
                        )
                        .slice(0, 20),
                html:
                    lpxDiagnosticClean(
                        node.outerHTML || '',
                        600
                    )
            });
        }

        const seen = new WeakSet();
        let inspected = 0;

        function inspect(
            value,
            path,
            depth
        ) {
            if (
                depth > 7 ||
                inspected > 6000 ||
                report.reactFindings.length >= 30
            ) {
                return;
            }

            inspected++;

            if (
                typeof value === 'string'
            ) {
                const lower =
                    value.toLowerCase();

                if (
                    (
                        wantedFile &&
                        lower.includes(
                            wantedFile
                        )
                    ) ||
                    (
                        wantedJob &&
                        lower.includes(
                            wantedJob
                        )
                    ) ||
                    /file-service:\/\/|file[_-][A-Za-z0-9_-]{8,}|\/backend-api\/files\/|oaiusercontent\.com|sandbox:\/mnt\/data\//i
                        .test(value)
                ) {
                    report.reactFindings.push({
                        path:
                            lpxDiagnosticClean(
                                path,
                                240
                            ),
                        value:
                            lpxDiagnosticClean(
                                value,
                                420
                            )
                    });
                }

                return;
            }

            if (
                value === null ||
                value === undefined ||
                (
                    typeof value !== 'object' &&
                    typeof value !== 'function'
                )
            ) {
                return;
            }

            if (seen.has(value)) {
                return;
            }

            seen.add(value);

            let keys = [];

            try {
                keys =
                    Object.keys(value)
                        .slice(0, 140);
            } catch {
                return;
            }

            for (const key of keys) {
                let child;

                try {
                    child = value[key];
                } catch {
                    continue;
                }

                inspect(
                    child,
                    path + '.' + key,
                    depth + 1
                );
            }
        }

        const reactNodes = [
            turn,
            assistant,
            ...matchedNodes.slice(0, 30)
        ].filter(
            node =>
                node instanceof Element
        );

        for (
            let nodeIndex = 0;
            nodeIndex < reactNodes.length;
            nodeIndex++
        ) {
            const node =
                reactNodes[nodeIndex];

            let properties = [];

            try {
                properties =
                    Object.getOwnPropertyNames(
                        node
                    );
            } catch {
                properties = [];
            }

            for (
                const propertyName of
                properties
            ) {
                if (
                    !/^__react/i.test(
                        propertyName
                    )
                ) {
                    continue;
                }

                let value;

                try {
                    value =
                        node[propertyName];
                } catch {
                    continue;
                }

                inspect(
                    value,
                    'node[' +
                    nodeIndex +
                    '].' +
                    propertyName,
                    0
                );
            }
        }

        report.inspectedElements =
            all.length;

        report.matchedElements =
            matchedNodes.length;

        report.inspectedReactValues =
            inspected;

        return report;
    }

    async function lpxSendAttachmentReality(
        assistant,
        fileName,
        jobId
    ) {
        const diagnostic =
            lpxCaptureAttachmentReality(
                assistant,
                fileName,
                jobId
            );

        const sentKey =
            'lpxPsb15:realAttachmentDiagnostic:' +
            simpleHash(jobId);

        if (GM_getValue(sentKey, false)) {
            return;
        }

        GM_setValue(sentKey, true);

        const message = [
            'PSBRIDGE_ATTACHMENT_DIAGNOSTIC_V2',
            'job: ' + jobId,
            'file: ' + fileName,
            'data:',
            JSON.stringify(
                diagnostic,
                null,
                2
            ),
            'instruction: analisa estes dados reais do cartão e das propriedades React. Não repitas qualquer tentativa de download antes de corrigires com base nestes dados.'
        ].join('\n');

        setStatus(
            'Diagnóstico real capturado. A enviar os dados automaticamente para a conversa…'
        );

        await sendMessage(message);
    }


    function lpxAssistantMessageId(
        assistant
    ) {
        const turn =
            turnContainer(assistant);

        if (!(turn instanceof Element)) {
            return '';
        }

        const direct =
            turn.getAttribute('data-message-id') ||
            assistant?.getAttribute?.('data-message-id');

        if (direct) {
            return String(direct).trim();
        }

        const inner =
            turn.querySelector?.('[data-message-id]') ||
            assistant?.querySelector?.('[data-message-id]');

        if (inner) {
            return String(inner.getAttribute('data-message-id') || '').trim();
        }

        return '';
    }

    function lpxCollectRelevantApiFields(
        root,
        fileName,
        jobId
    ) {
        const findings = [];
        const seen = new WeakSet();
        let visited = 0;

        const wantedFile =
            String(fileName || '')
                .toLowerCase();

        const wantedJob =
            String(jobId || '')
                .toLowerCase();

        function walk(
            value,
            path,
            depth
        ) {
            if (
                depth > 16 ||
                visited > 50000 ||
                findings.length >= 500
            ) {
                return;
            }

            if (
                typeof value ===
                'string'
            ) {
                const lower =
                    value.toLowerCase();

                const relevantPath =
                    /asset|pointer|file|attachment|download|url|href|reference|metadata|content|part|message/i
                        .test(path);

                const relevantValue =
                    (
                        wantedFile &&
                        lower.includes(
                            wantedFile
                        )
                    ) ||
                    (
                        wantedJob &&
                        lower.includes(
                            wantedJob
                        )
                    ) ||
                    /file-service:\/\/|file[_-][A-Za-z0-9_-]{8,}|\/backend-api\/files\/|oaiusercontent\.com|sandbox:\/mnt\/data\//i
                        .test(value);

                if (
                    relevantPath ||
                    relevantValue
                ) {
                    findings.push({
                        path:
                            lpxDiagnosticClean(
                                path,
                                320
                            ),
                        value:
                            lpxDiagnosticClean(
                                value,
                                900
                            )
                    });
                }

                return;
            }

            if (
                value === null ||
                value === undefined ||
                (
                    typeof value !==
                    'object' &&
                    typeof value !==
                    'function'
                )
            ) {
                return;
            }

            if (seen.has(value)) {
                return;
            }

            seen.add(value);
            visited++;

            let entries = [];

            try {
                entries =
                    Object.entries(value);
            } catch {
                return;
            }

            entries.sort(
                ([left], [right]) => {
                    const important =
                        /asset|pointer|file|attachment|download|url|href|reference|metadata|content|part|message/i;

                    return (
                        Number(
                            important.test(right)
                        ) -
                        Number(
                            important.test(left)
                        )
                    );
                }
            );

            for (
                const [key, child] of
                entries
            ) {
                walk(
                    child,
                    path
                        ? path + '.' + key
                        : key,
                    depth + 1
                );
            }
        }

        walk(
            root,
            'exactMessageNode',
            0
        );

        return {
            visited,
            findings
        };
    }

    async function lpxSendExactApiDiagnostic(
        fileName,
        jobId,
        messageId,
        exactNode,
        extraction,
        statuses
    ) {
        const sentKey =
            'lpxPsb15:exactApiDiagnostic:' +
            simpleHash(jobId);

        if (GM_getValue(sentKey, false)) {
            return;
        }

        GM_setValue(sentKey, true);

        const relevant =
            lpxCollectRelevantApiFields(
                exactNode,
                fileName,
                jobId
            );

        const report = {
            protocol:
                'PSBRIDGE_EXACT_MESSAGE_API_DIAGNOSTIC_V1',
            jobId,
            fileName,
            bridgeVersion:
                VERSION,
            messageId,
            exactNodeFound:
                Boolean(exactNode),
            nodeKeys:
                exactNode &&
                typeof exactNode ===
                    'object'
                    ? Object.keys(
                        exactNode
                    ).slice(0, 100)
                    : [],
            messageKeys:
                exactNode &&
                exactNode.message &&
                typeof exactNode.message ===
                    'object'
                    ? Object.keys(
                        exactNode.message
                    ).slice(0, 100)
                    : [],
            candidateCount:
                extraction &&
                extraction.candidates
                    ? extraction.candidates.length
                    : 0,
            candidates:
                extraction &&
                extraction.candidates
                    ? extraction.candidates
                        .slice(0, 40)
                        .map(item => ({
                            url:
                                lpxDiagnosticClean(
                                    item.url,
                                    600
                                ),
                            source:
                                lpxDiagnosticClean(
                                    item.source,
                                    320
                                ),
                            score:
                                item.score
                        }))
                    : [],
            statuses:
                Array.isArray(statuses)
                    ? statuses.slice(0, 60)
                    : [],
            relevantFields:
                relevant.findings,
            visitedApiValues:
                relevant.visited,
            capturedAt:
                new Date().toISOString()
        };

        const message = [
            'PSBRIDGE_EXACT_MESSAGE_API_DIAGNOSTIC_V1',
            'job: ' + jobId,
            'file: ' + fileName,
            'data:',
            JSON.stringify(
                report,
                null,
                2
            ),
            'instruction: usa exclusivamente estes dados da mensagem exata. Não voltes a clicar no cartão nem a procurar anexos noutras mensagens.'
        ].join('\n');

        setStatus(
            'A mensagem exata não expôs um ficheiro utilizável. A enviar o diagnóstico preciso da API…'
        );

        await sendMessage(message);
    }

    async function lpxResolveExactMessageAttachment(
        assistant,
        fileName,
        jobId,
        suppliedFileId
    ) {
        if (suppliedFileId) {
            return await resolveExplicitFileId(
                suppliedFileId,
                fileName,
                jobId
            );
        }

        const messageId =
            lpxAssistantMessageId(
                assistant
            );

        const conversationUuid =
            rawConversationUuid();

        if (!conversationUuid) {
            throw new Error(
                'Não foi possível obter o UUID da conversa.'
            );
        }

        setStatus(
            'A consultar a conversa na API autenticada…'
        );

        const response =
            await chatgptApiFetch(
                '/backend-api/conversation/' +
                encodeURIComponent(
                    conversationUuid
                ),
                {
                    method: 'GET',
                    headers: {
                        Accept:
                            'application/json'
                    }
                }
            );

        if (
            !response ||
            !response.ok
        ) {
            throw new Error(
                'A API da conversa devolveu HTTP ' +
                Number(
                    response &&
                    response.status ||
                    0
                ) +
                '.'
            );
        }

        const conversation =
            await response.json();

        const mapping =
            conversation &&
            conversation.mapping &&
            typeof conversation.mapping ===
                'object'
                ? conversation.mapping
                : {};

        let exactNode =
            (messageId && mapping[messageId]) ||
            null;

        if (!exactNode && messageId) {
            exactNode =
                Object.values(mapping)
                    .find(
                        node =>
                            String(
                                node &&
                                node.message &&
                                node.message.id ||
                                ''
                            ) ===
                            messageId
                    ) ||
                null;
        }

        if (!exactNode) {
            exactNode =
                Object.values(mapping)
                    .reverse()
                    .find(node => {
                        const str = JSON.stringify(node || '');
                        return str.includes(jobId) || (fileName && str.includes(fileName));
                    }) ||
                null;
        }

        if (!exactNode) {
            await lpxSendExactApiDiagnostic(
                fileName,
                jobId,
                messageId,
                null,
                null,
                [
                    'exact-message-node-missing'
                ]
            );

            return '';
        }

        const effectiveMsgId =
            String(exactNode?.message?.id || messageId || 'msg');

        const exactRoot = {
            mapping: {
                [effectiveMsgId]:
                    exactNode
            }
        };

        const extraction =
            collectConversationFileCandidates(
                exactRoot,
                fileName,
                jobId,
                ''
            );

        const queue =
            extraction.candidates
                .slice(0, 40);

        const attempted =
            new Set();

        const statuses = [];

        for (
            let index = 0;
            index < queue.length &&
            index < 40;
            index++
        ) {
            const candidate =
                queue[index];

            if (
                !candidate ||
                !candidate.url ||
                attempted.has(
                    candidate.url
                )
            ) {
                continue;
            }

            attempted.add(
                candidate.url
            );

            setStatus(
                'A testar referência ' +
                (index + 1) +
                '/' +
                queue.length +
                ' encontrada exclusivamente na mensagem exata…'
            );

            let candidateResponse =
                null;

            try {
                candidateResponse =
                    await chatgptApiFetch(
                        candidate.url,
                        {
                            method:
                                'GET',
                            redirect:
                                'follow'
                        }
                    );
            } catch (error) {
                statuses.push(
                    'fetch-error:' +
                    lpxDiagnosticClean(
                        error &&
                        error.message ||
                        error,
                        240
                    )
                );
            }

            if (
                candidateResponse &&
                candidateResponse.ok
            ) {
                const contentType =
                    String(
                        candidateResponse
                            .headers
                            .get(
                                'content-type'
                            ) || ''
                    ).toLowerCase();

                if (
                    contentType.includes(
                        'application/json'
                    )
                ) {
                    try {
                        const metadata =
                            await candidateResponse
                                .json();

                        const nested =
                            collectConversationFileCandidates(
                                metadata,
                                fileName,
                                jobId,
                                ''
                            ).candidates;

                        for (
                            const item of
                            nested
                        ) {
                            if (
                                item &&
                                item.url &&
                                !attempted.has(
                                    item.url
                                ) &&
                                !queue.some(
                                    queued =>
                                        queued.url ===
                                        item.url
                                )
                            ) {
                                queue.push(item);
                            }
                        }

                        statuses.push(
                            String(
                                candidateResponse
                                    .status
                            ) +
                            'j'
                        );
                    } catch {
                        statuses.push(
                            String(
                                candidateResponse
                                    .status
                            ) +
                            '-json-error'
                        );
                    }
                } else {
                    const body =
                        await candidateResponse
                            .text();

                    if (
                        usablePowerShellPayload(
                            body,
                            contentType
                        )
                    ) {
                        lastAttachmentDiagnostic = [
                            'exactMessageApi=ok',
                            'messageId=' +
                                messageId,
                            'selected=' +
                                (index + 1),
                            'HTTP=' +
                                candidateResponse
                                    .status
                        ].join(';');

                        return body;
                    }

                    statuses.push(
                        String(
                            candidateResponse
                                .status
                        ) +
                        '-rejected-' +
                        attachmentPayloadRejection(
                            body,
                            contentType
                        )
                    );
                }
            } else {
                statuses.push(
                    'HTTP=' +
                    Number(
                        candidateResponse &&
                        candidateResponse.status ||
                        0
                    )
                );
            }

            const gmResult =
                await gmDownloadText(
                    candidate.url
                );

            if (
                gmResult.ok &&
                usablePowerShellPayload(
                    gmResult.text,
                    ''
                )
            ) {
                lastAttachmentDiagnostic = [
                    'exactMessageApi=ok',
                    'messageId=' +
                        messageId,
                    'transport=GM',
                    'HTTP=' +
                        gmResult.status
                ].join(';');

                return gmResult.text;
            }

            if (gmResult.ok) {
                statuses.push(
                    String(
                        gmResult.status
                    ) +
                    '-gm-rejected-' +
                    attachmentPayloadRejection(
                        gmResult.text,
                        ''
                    )
                );
            }
        }

        lastAttachmentDiagnostic = [
            'exactMessageApi=no-file-reference',
            'messageId=' +
                messageId,
            'candidates=' +
                extraction.candidates.length,
            'statuses=' +
                statuses.slice(0, 20).join(',')
        ].join(';');

        return '';
    }

    async function resolveAttachmentFromConversationApi(
        fileName,
        jobId,
        suppliedFileId
    ) {
        if (suppliedFileId) {
            return await resolveExplicitFileId(
                suppliedFileId,
                fileName,
                jobId
            );
        }

        const conversationId =
            rawConversationUuid();

        if (!conversationId) {
            lastAttachmentDiagnostic =
                'conversationId=missing';

            return '';
        }

        let conversationResponse;

        try {
            conversationResponse =
                await chatgptApiFetch(
                    '/backend-api/conversation/' +
                    encodeURIComponent(
                        conversationId
                    ),
                    {
                        method: 'GET',
                        headers: {
                            Accept: 'application/json'
                        }
                    }
                );
        } catch (error) {
            lastAttachmentDiagnostic =
                'conversationFetch=error:' +
                String(
                    error &&
                    error.message ||
                    error
                );

            return '';
        }

        if (!conversationResponse || !conversationResponse.ok) {
            lastAttachmentDiagnostic =
                'conversationFetch=HTTP' +
                Number(
                    conversationResponse &&
                    conversationResponse.status ||
                    0
                );

            return '';
        }

        const conversation =
            await conversationResponse.json();

        const extraction =
            collectConversationFileCandidates(
                conversation,
                fileName,
                jobId,
                suppliedFileId
            );

        const queue =
            extraction.candidates.slice(0, 40);

        const attempted = new Set();
        const statuses = [];

        for (
            let index = 0;
            index < queue.length && index < 40;
            index++
        ) {
            const candidate = queue[index];

            if (attempted.has(candidate.url)) {
                continue;
            }

            attempted.add(candidate.url);

            setStatus(
                'A testar referência autenticada do anexo ' +
                (index + 1) +
                '/' +
                queue.length +
                '…'
            );

            let response = null;

            try {
                response = await chatgptApiFetch(
                    candidate.url,
                    {
                        method: 'GET',
                        redirect: 'follow'
                    }
                );
            } catch {
                response = null;
            }

            if (response && response.ok) {
                const contentType = String(
                    response.headers.get(
                        'content-type'
                    ) || ''
                ).toLowerCase();

                if (
                    contentType.includes(
                        'application/json'
                    )
                ) {
                    try {
                        const metadata =
                            await response.json();

                        const nested =
                            collectConversationFileCandidates(
                                metadata,
                                fileName,
                                jobId,
                                ''
                            ).candidates;

                        for (const item of nested) {
                            if (
                                !attempted.has(item.url) &&
                                !queue.some(
                                    queued =>
                                        queued.url ===
                                        item.url
                                )
                            ) {
                                queue.push(item);
                            }
                        }

                        statuses.push(
                            Number(response.status) +
                            'j'
                        );

                        continue;
                    } catch {
                        statuses.push(
                            Number(response.status) +
                            'json-error'
                        );
                    }
                } else {
                    const text =
                        await response.text();

                    const rejection =
                        attachmentPayloadRejection(
                            text,
                            contentType
                        );

                    if (!rejection) {
                        lastAttachmentDiagnostic = [
                            'conversationApi=ok',
                            'matchedMessages=' +
                                extraction.matchedMessages,
                            'visited=' +
                                extraction.visited,
                            'candidates=' +
                                extraction.candidates.length,
                            'selected=' +
                                (index + 1),
                            'HTTP=' +
                                response.status
                        ].join(';');

                        return text;
                    }

                    statuses.push(
                        Number(response.status) +
                        '-rejected-' +
                        rejection
                    );
                }
            }

            statuses.push(
                Number(
                    response &&
                    response.status ||
                    0
                )
            );

            const gmResult =
                await gmDownloadText(
                    candidate.url
                );

            if (
                gmResult.ok &&
                usablePowerShellPayload(
                    gmResult.text,
                    ''
                )
            ) {
                lastAttachmentDiagnostic = [
                    'conversationApi=ok',
                    'transport=GM',
                    'matchedMessages=' +
                        extraction.matchedMessages,
                    'visited=' +
                        extraction.visited,
                    'candidates=' +
                        extraction.candidates.length,
                    'selected=' +
                        (index + 1),
                    'HTTP=' +
                        gmResult.status
                ].join(';');

                return gmResult.text;
            }

            if (gmResult.ok) {
                statuses.push(
                    Number(gmResult.status) +
                    '-gm-rejected-' +
                    attachmentPayloadRejection(
                        gmResult.text,
                        ''
                    )
                );
            }
        }

        lastAttachmentDiagnostic = [
            'conversationApi=ok',
            'visited=' +
                extraction.visited,
            'candidates=' +
                extraction.candidates.length,
            'attempts=' +
                statuses.slice(0, 40).join(',')
        ].join(';');

        return '';
    }

    async function downloadAttachment(anchor) {
        const href = anchor?.href || anchor?.getAttribute('href');

        if (!href) {
            throw new Error('O anexo não tem um URL utilizável.');
        }

        try {
            const response = await fetchWithTimeout(href, {
                credentials: 'include',
                cache: 'no-store'
            });

            if (response.ok) {
                return await response.text();
            }
        } catch {
            // Tenta GM_xmlhttpRequest a seguir.
        }

        const response = await request({
            method: 'GET',
            url: href,
            responseType: 'arraybuffer',
            timeout: 30000
        });

        if (response.status >= 400) {
            throw new Error(`Falha ao descarregar o anexo: HTTP ${response.status}.`);
        }

        const bytes = response.response instanceof ArrayBuffer
            ? new Uint8Array(response.response)
            : new TextEncoder().encode(String(response.responseText || ''));

        return new TextDecoder('utf-8').decode(bytes);
    }

    function normalizePowerShellCommand(text) {
        return String(text || '')
            .replace(/^\uFEFF/, '')
            .replace(/\r\n?/g, '\n');
    }

    function utf8Bytes(text) {
        return new TextEncoder().encode(normalizePowerShellCommand(text));
    }

    async function sha256(text) {
        const bytes = utf8Bytes(text);
        const digest = await crypto.subtle.digest('SHA-256', bytes);

        return [...new Uint8Array(digest)]
            .map(value => value.toString(16).padStart(2, '0'))
            .join('');
    }

    function encodeBase64Utf8(text) {
        const bytes = utf8Bytes(text);
        const chunkSize = 0x8000;
        let binary = '';

        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            binary += String.fromCharCode(
                ...bytes.subarray(offset, offset + chunkSize)
            );
        }

        return btoa(binary);
    }

    function decodeBase64Utf8(value) {
        const clean = String(value || '').replace(/\s+/g, '');
        const binary = atob(clean);
        const bytes = Uint8Array.from(
            binary,
            character => character.charCodeAt(0)
        );

        return new TextDecoder('utf-8').decode(bytes);
    }


    function lpxFileIdHandshakeKey(
        jobId
    ) {
        return (
            FILEID_HANDSHAKE_PREFIX +
            simpleHash(
                conversationId() +
                ':' +
                String(jobId || '')
            )
        );
    }

    function lpxFileIdHandshakeState(
        jobId
    ) {
        const value =
            GM_getValue(
                lpxFileIdHandshakeKey(
                    jobId
                ),
                null
            );

        return (
            value &&
            typeof value === 'object'
        )
            ? value
            : null;
    }

    function lpxClearFileIdHandshake(
        jobId
    ) {
        GM_deleteValue(
            lpxFileIdHandshakeKey(
                jobId
            )
        );
    }

    function lpxValidateFileIdHandshake(
        manifest
    ) {
        const jobId =
            String(
                manifest.jobId || ''
            ).trim();

        const state =
            lpxFileIdHandshakeState(
                jobId
            );

        if (!state) {
            return;
        }

        const fileName =
            String(
                manifest.file || ''
            ).trim();

        const purpose =
            String(
                manifest.purpose || ''
            ).trim();

        if (
            state.fileName &&
            state.fileName !== fileName
        ) {
            throw new Error(
                'O manifesto com fileId não mantém o mesmo nome de ficheiro do handshake.'
            );
        }

        if (
            state.purpose &&
            purpose &&
            state.purpose !== purpose
        ) {
            throw new Error(
                'O manifesto com fileId não mantém o mesmo propósito do handshake.'
            );
        }
    }

    async function lpxRequestFileIdHandshake(
        assistant,
        manifest
    ) {
        const jobId =
            String(
                manifest.jobId || ''
            ).trim();

        const fileName =
            String(
                manifest.file || ''
            ).trim();

        const purpose =
            String(
                manifest.purpose || ''
            ).trim();

        const sourceMessageId =
            lpxAssistantMessageId(
                assistant
            );

        const key =
            lpxFileIdHandshakeKey(
                jobId
            );

        const previous =
            lpxFileIdHandshakeState(
                jobId
            ) || {};

        const previousAttempts =
            Number(
                previous.attempts || 0
            );

        if (
            previous.sourceMessageId &&
            previous.sourceMessageId ===
                sourceMessageId
        ) {
            setStatus(
                'Handshake do fileId já enviado para este anexo. A aguardar a resposta automática do ChatGPT…'
            );

            return false;
        }

        if (previousAttempts >= 2) {
            throw new Error(
                'O ChatGPT respondeu duas vezes sem devolver o fileId explícito do anexo.'
            );
        }

        const attempt =
            previousAttempts + 1;

        const sandboxLink =
            'sandbox:/mnt/data/' +
            fileName;

        const state = {
            jobId,
            fileName,
            purpose,
            sandboxLink,
            sourceMessageId,
            attempts:
                attempt,
            sentAt:
                Date.now(),
            conversation:
                conversationId()
        };

        GM_setValue(
            key,
            state
        );

        const instruction =
            attempt === 1
                ? [
                    'A resposta anterior anexou este ficheiro e a plataforma disponibilizou agora no contexto interno o fileId exato desse anexo.',
                    'Responde apenas com o mesmo manifesto JSON PSB_JOB_FILE_V1.',
                    'Mantém exatamente jobId, file e purpose.',
                    'Acrescenta o fileId exato fornecido pela plataforma para o anexo da resposta anterior.',
                    'Depois do manifesto, inclui apenas o mesmo link sandbox indicado abaixo.',
                    'Não cries nem anexes outro ficheiro.',
                    'Não cries outro jobId.',
                    'Não inventes nem reutilizes um fileId de outro anexo.',
                    'Não escrevas explicações.'
                ].join(' ')
                : [
                    'A resposta anterior ainda não incluiu o fileId.',
                    'Usa obrigatoriamente o identificador exato do anexo anterior que a plataforma expôs no contexto interno.',
                    'Responde apenas com o mesmo manifesto PSB_JOB_FILE_V1 contendo fileId e o mesmo link sandbox.',
                    'Não cries um novo ficheiro ou job.'
                ].join(' ');

        const message = [
            'PSBRIDGE_FILEID_HANDSHAKE_V1',
            'attempt: ' +
                attempt +
                '/2',
            'job: ' +
                jobId,
            'file: ' +
                fileName,
            'purpose: ' +
                purpose,
            'sourceAssistantMessageId: ' +
                sourceMessageId,
            'sandboxLink: ' +
                sandboxLink,
            'instruction: ' +
                instruction
        ].join('\n');

        setStatus(
            'Anexo publicado. A pedir automaticamente ao ChatGPT o fileId real · tentativa ' +
            attempt +
            '/2…'
        );

        await sendMessage(
            message
        );

        setStatus(
            'Pedido automático de fileId enviado. Não é necessária qualquer intervenção.'
        );

        return true;
    }

    async function processJobManifest(assistant, manifest, forced) {
        const protocol = String(manifest.protocol || '').trim();
        const jobId = String(manifest.jobId || '').trim();
        const fileName = String(manifest.file || '').trim();
        const fileUrl = String(manifest.fileUrl || manifest.url || '').trim();
        const fileId = String(manifest.fileId || '').trim();
        const commandBase64 = String(manifest.commandBase64 || '').trim();
        const inlineCommand = typeof manifest.command === 'string'
            ? manifest.command
            : '';

        if (
            !jobId ||
            (!fileName && !fileUrl && !fileId && !commandBase64 && !inlineCommand)
        ) {
            setStatus(
                `Manifesto ${protocol || 'PowerShell'} incompleto: falta jobId e uma fonte de comando.`
            );
            return;
        }

        // Mesmo "Executar último" não deve repetir um job cujo registo
        // desapareceu do servidor. Exige diagnóstico antes de um novo jobId.
        if (unresolvedJobs().some(row => row?.jobId === jobId)) {
            setStatus(`Job ${jobId}: estado não confirmado após HTTP 404. Reexecução bloqueada para proteger os dados.`);
            return;
        }
        if (isHandled(jobId) && !forced) {
            return;
        }

        if (processingJobIds.has(jobId)) return;
        processingJobIds.add(jobId);
        if (!claim(jobId)) {
            processingJobIds.delete(jobId);
            setStatus(`O job ${jobId} já está a ser tratado noutra aba.`);
            return;
        }

        const inflight = getInflight();
        if (inflight && inflight.jobId === jobId) {
            activeJobId = jobId;
            activeManifest = manifest;
            setStatus(`A recuperar acompanhamento do job ${jobId}, sem o voltar a executar.`);
            try {
                await monitorActiveJob();
            } finally {
                processingJobIds.delete(jobId);
            }
            return;
        }

        try {
            let command = '';


            if (
                protocol === 'PSB_JOB_FILE_V1' &&
                !fileUrl
            ) {
                if (fileId) {
                    try {
                        lpxValidateFileIdHandshake(manifest);
                        setStatus('fileId recebido. A descarregar anexo…');
                        command = await resolveExplicitFileId(fileId, fileName, jobId);
                        lpxClearFileIdHandshake(jobId);
                    } catch (e) {
                        console.warn('Falha na resolução por fileId:', e);
                        command = '';
                    }
                }

                if (!command) {
                    const directLink = findAttachmentLink(assistant, fileName);
                    if (directLink && directLink.href) {
                        try {
                            setStatus('A descarregar anexo via link direto: ' + fileName + '…');
                            command = await downloadAttachment(directLink);
                        } catch (err) {
                            console.warn('Falha no downloadAttachment:', err);
                            command = '';
                        }
                    }
                }

                if (!command) {
                    try {
                        setStatus('A resolver anexo diretamente na API da conversa para ' + fileName + '…');
                        command = await lpxResolveExactMessageAttachment(assistant, fileName, jobId, fileId);
                    } catch (err) {
                        console.warn('Falha no lpxResolveExactMessageAttachment:', err);
                        command = '';
                    }
                }

                if (!command) {
                    setStatus(`PSB_JOB_FILE_V1 rejeitado: downloads desativados. A pedir reenvio em PSB_JOB_V3…`);
                    markHandled(jobId);
                    releaseClaim(jobId);
                    const rejectMsg = [
                        'PSBRIDGE_PROTOCOL_REJECT',
                        `job: ${jobId}`,
                        'error: Anexos e links de download estão permanentemente desativados nesta bridge.',
                        'instruction: Não uses PSB_JOB_FILE_V1 nem anexos .ps1. Coloca o script PowerShell deste job diretamente aqui no chat dentro de um bloco powershell # PSB_JOB_V3 agora.'
                    ].join('\n');
                    try {
                        await sendMessage(rejectMsg, manifest);
                        setStatus(`Reenvio em PSB_JOB_V3 solicitado automaticamente ao ChatGPT.`);
                    } catch (e) {
                        setStatus(`Downloads desativados: solicita ao ChatGPT o bloco em PSB_JOB_V3.`);
                    }
                    return;
                }
            }

            else if (protocol === 'PSB_JOB_FILE_V1' && fileUrl) {
                setStatus('A descarregar o ficheiro ' + (fileName || fileUrl) + '…');
                command = await downloadAttachment({ href: fileUrl });
            }
            else if (protocol === 'PSB_JOB_V3') {
                setStatus('A normalizar localmente o PowerShell legível…');
                command = inlineCommand;
            }
            else if (commandBase64) {
                setStatus('A descodificar o comando do protocolo antigo…');
                command = decodeBase64Utf8(commandBase64);
            }
            else if (inlineCommand) {
                setStatus('A preparar o comando incorporado no manifesto antigo…');
                command = inlineCommand;
            }
            else {
                throw new Error('Não foi encontrada uma fonte de comando utilizável.');
            }

            command = normalizePowerShellCommand(command);

            if (
                protocol === 'PSB_JOB_FILE_V1' &&
                !usablePowerShellPayload(
                    command,
                    ''
                )
            ) {
                throw new Error(
                    'O conteúdo descarregado foi rejeitado: ' +
                    attachmentPayloadRejection(
                        command,
                        ''
                    ) +
                    '.'
                );
            }

            if (!command.trim()) {
                throw new Error('O comando PowerShell está vazio.');
            }

            const localHash = await sha256(command);
            const localBase64 = encodeBase64Utf8(command);
            const byteLength = utf8Bytes(command).length;

            if (
                protocol === 'PSB_JOB_V2' &&
                manifest.sha256 &&
                localHash.toLowerCase() !== String(manifest.sha256).toLowerCase()
            ) {
                throw new Error('O SHA-256 do protocolo antigo não coincide com o comando.');
            }

            setStatus(
                `Job ${jobId}: UTF-8/LF local · ${byteLength} bytes · SHA ${localHash.slice(0, 12)}…`
            );

            // Guardar a intenção antes do POST: um timeout não prova que o servidor rejeitou o job.
            saveInflight(jobId, manifest, 'submitting');
            const response = await request({
                method: 'POST',
                url: `${BRIDGE_URL}/run`,
                headers: authHeaders(),
                data: JSON.stringify({
                    command,
                    commandBase64: localBase64,
                    sha256: localHash,
                    sourceProtocol: protocol,
                    byteLength,
                    jobId,
                    commandKey: jobId,
                    signature: jobId,
                    purpose: String(manifest.purpose || ''),
                    clientId: TAB_ID,
                    tabId: TAB_ID,
                    conversationId: conversationId(),
                    clientVersion: VERSION
                }),
                timeout: 15000
            });

            const data = parseJson(response);

            if (![200, 202].includes(Number(response.status)) || !data.jobId) {
                throw new Error(data.error || `A bridge rejeitou o job: HTTP ${response.status}.`);
            }

            activeJobId = String(data.jobId);
            activeManifest = manifest;
            saveInflight(activeJobId, manifest, 'running');
            setStatus(`Job ${activeJobId} em execução. O ficheiro ficou fora do histórico; Base64 e SHA-256 foram calculados localmente.`);
            await monitorActiveJob();
        } catch (error) {
            releaseClaim(jobId);
            activeJobId = '';
            activeManifest = null;
            if (getInflight()?.jobId === jobId) {
                setStatus(`Job ${jobId} em estado incerto. Não será reenviado automaticamente: ${error.message}`);
            } else {
                setStatus(`Falha no job ${jobId}: ${error.message}`);
            }
        } finally {
            processingJobIds.delete(jobId);
        }
    }

    function resultMessageForJob(id, data) {
        if (!data?.resultJsonUrl) return '';
        return [
            'PSBRIDGE_RESULT_V2',
            `job: ${id}`,
            `status: ${String(data.status || '').toUpperCase()}`,
            `exitCode: ${data.exitCode ?? 'desconhecido'}`,
            `result: ${data.resultJsonUrl}`,
            `log: ${data.resultUrl || ''}`,
            'instruction: lê o resultado público acima e continua o diagnóstico. REGRA OBRIGATÓRIA: Nunca cries ficheiros para download nem anexos .ps1. Escreve o teu próximo comando PowerShell DIRETAMENTE no chat dentro de um bloco powershell # PSB_JOB_V3.'
        ].join('\n');
    }

    async function acknowledgeDeliveredResult(id, message = '') {
        // Consultar a conversa antes de limitar novos envios ou exigir
        // resultados no serviço local. Não reexecutar o job.
        const checked = await checkResultDelivered(id, message);
        if (!checked.confirmed) return false;

        markHandled(id);
        clearInflight(id);
        releaseClaim(id);
        setStatus(`Job ${id}: entrega confirmada no ChatGPT. Estado libertado sem reexecução.`);
        return true;
    }

    function scheduleDeliveryRecovery(delay = 12000) {
        clearTimeout(deliveryRecoveryTimer);
        if (!enabled() || !getInflight()) return;
        deliveryRecoveryTimer = window.setTimeout(() => {
            deliveryRecoveryTimer = 0;
            void recoverPendingDelivery();
        }, delay);
    }

    async function recoverPendingDelivery() {
        if (deliveryRecoveryBusy || activeJobId || sendingMessage || !enabled()) return;
        const original = getInflight();
        if (!original?.jobId) return;
        deliveryRecoveryBusy = true;
        let delay = 16000;
        try {
            let saved = original;
            let message = String(saved.message || '');

            // Confirmar primeiro a presença real no histórico do ChatGPT:
            // aplicar o ACK mesmo com tentativas esgotadas, rascunho
            // pendente ou registo do daemon já indisponível.
            if (await acknowledgeDeliveredResult(saved.jobId, message)) return;

            if (!message) {
                // A versão 15.5.14 guardava só o jobId; nunca reexecutar o POST.
                const res = await request({
                    method: 'GET',
                    url: `${BRIDGE_URL}/job/${encodeURIComponent(saved.jobId)}?metadata=1&_=${Date.now()}`,
                    headers: { 'X-Bridge-Token': token(), 'Cache-Control': 'no-cache' },
                    timeout: 8000
                });
                const data = parseJson(res);
                if (Number(res.status) === 404) {
                    setStatus(`Job ${saved.jobId}: HTTP 404. A confirmar antes de suspender o acompanhamento…`);
                    if (await confirmsMissingJob(saved.jobId)) {
                        stopMissingJob(saved.jobId);
                    }
                    return;
                }
                if (res.status < 400 && data.running) {
                    // Acompanhamento de job já aceite: apenas GET, nunca novo POST.
                    activeJobId = saved.jobId;
                    activeManifest = saved.manifest || { jobId: saved.jobId, protocol: 'PSB_JOB_V3' };
                    await monitorActiveJob();
                    return;
                }
                if (res.status < 400 && data.publishStatus === 'published' && data.resultJsonUrl) {
                    message = resultMessageForJob(saved.jobId, data);
                    updateDeliveryState(saved.jobId, 'published_pending_delivery', { message });
                    saved = getInflight();
                }
            }
            if (!message) {
                setStatus(`Job ${saved.jobId}: à espera de recuperar o resultado publicado; sem reexecução.`);
                return;
            }
            const verify = await checkResultDelivered(saved.jobId, message);
            if (verify.confirmed) {
                markHandled(saved.jobId);
                clearInflight(saved.jobId);
                releaseClaim(saved.jobId);
                setStatus(`Job ${saved.jobId}: entrega confirmada após recuperação.`);
                return;
            }
            const clicks = Number(saved.deliveryClicks || 0);
            const lastClick = Number(saved.lastDeliveryClickAt || 0);
            if (clicks >= 2) {
                // Recuperar no máximo UMA vez resultados antigos que ficaram
                // no compositor depois de esgotar duas tentativas da v15.5.17.
                // Sem confirmação da API, não se assume que seja seguro reenviar.
                const canRescue = clicks === 2 &&
                    !saved.deliveryRescueUsedVersion &&
                    verify.apiOk &&
                    Date.now() - lastClick >= 60000 &&
                    composerDraftMatches(composer(), message, saved.jobId);
                if (!canRescue) {
                    setStatus(`Job ${saved.jobId}: resultado em espera; limite de tentativas ou confirmação insuficiente. Sem reexecução.`);
                    delay = 60000;
                    return;
                }
                updateDeliveryState(saved.jobId, saved.phase, { deliveryRescueAuthorized: VERSION });
                saved = getInflight();
            }
            // Na versão 15.5.14 não se registava o clique já efetuado:
            // só recuperar automaticamente se a API confirmar que o job ainda não chegou.
            if (clicks === 0 && !saved.preparedVersion && !verify.apiOk) {
                setStatus(`Job ${saved.jobId}: estado antigo sem prova de entrega. À espera de confirmação, sem duplicar.`);
                return;
            }
            if (clicks > 0 && (!verify.apiOk || Date.now() - lastClick < 60000)) {
                setStatus(`Job ${saved.jobId}: a verificar entrega anterior, sem novo envio.`);
                return;
            }
            if (assistantWriting()) {
                setStatus(`Job ${saved.jobId}: a aguardar o ChatGPT terminar a resposta.`);
                return;
            }
            try {
                await sendMessage(message, null, saved.jobId);
                markHandled(saved.jobId);
                clearInflight(saved.jobId);
                releaseClaim(saved.jobId);
                setStatus(`Job ${saved.jobId}: resultado entregue e confirmado.`);
            } catch (error) {
                setStatus(`Job ${saved.jobId}: entrega pendente (${error.message}). Resultado preservado.`);
                delay = 16000;
            }
        } catch (error) {
            setStatus(`Recuperação do resultado pendente: ${error.message}`);
        } finally {
            deliveryRecoveryBusy = false;
            if (getInflight() && enabled()) scheduleDeliveryRecovery(delay);
        }
    }

    async function monitorActiveJob() {
        const started = Date.now();
        let finishedAt = 0;
        let failures = 0;
        let consecutive404 = 0;

        const watchedConversation = conversationId();
        while (activeJobId && conversationId() === watchedConversation) {
            const id = activeJobId;
            renewClaim(id);
            let response;
            try {
                response = await request({
                    method: 'GET',
                    url: `${BRIDGE_URL}/job/${encodeURIComponent(id)}?metadata=1&_=${Date.now()}`,
                    headers: {
                        'X-Bridge-Token': token(),
                        'Cache-Control': 'no-cache'
                    },
                    timeout: 8000
                });
            } catch (error) {
                failures++;
                setStatus(`Job ${id}: ligação de monitorização indisponível (${failures}). A recuperar sem reexecutar…`);
                await wait(Math.min(30000, 2000 * failures));
                continue;
            }

            const data = parseJson(response);
            if (Number(response.status) === 404) {
                consecutive404++;
                if (consecutive404 >= 3) {
                    stopMissingJob(id);
                    return;
                }
                setStatus(`Job ${id}: HTTP 404 (${consecutive404}/3). A verificar se o servidor recupera o registo…`);
                await wait(1500 * consecutive404);
                continue;
            }
            consecutive404 = 0;
            if (response.status >= 400) {
                failures++;
                setStatus(`Job ${id}: HTTP ${response.status}. Serviço respondeu com erro; nenhum comando reenviado.`);
                await wait(Math.min(30000, 2000 * failures));
                continue;
            }
            failures = 0;

            if (data.running) {
                saveInflight(id, activeManifest, 'running');
                setStatus(`Job ${id} em execução · ${Math.floor((Date.now() - started) / 1000)} s.`);
                await wait(POLL_MS);
                continue;
            }

            if (!finishedAt) finishedAt = Date.now();

            if (data.publishStatus === 'published' && data.resultJsonUrl) {
                const message = resultMessageForJob(id, data);
                const prior = getInflight();
                if (prior?.jobId === id && prior.phase !== 'delivery_clicked') {
                    updateDeliveryState(id, 'published_pending_delivery', {
                        message,
                        preparedVersion: VERSION
                    });
                } else if (prior?.jobId === id && !prior.message) {
                    updateDeliveryState(id, prior.phase, { message });
                }

                activeJobId = '';
                activeManifest = null;
                try {
                    const check = await checkResultDelivered(id, message);
                    const clicks = Number(getInflight()?.deliveryClicks || 0);
                    if (check.confirmed) {
                        markHandled(id);
                        clearInflight(id);
                        setStatus(`Job ${id}: resultado confirmado na conversa.`);
                    } else if (clicks === 0) {
                        await sendMessage(message, null, id);
                        markHandled(id);
                        clearInflight(id);
                        setStatus(`Job ${id}: resultado entregue e confirmado.`);
                    } else {
                        setStatus(`Job ${id}: entrega anterior ainda sem confirmação. A recuperar sem duplicar.`);
                        scheduleDeliveryRecovery();
                    }
                } catch (error) {
                    setStatus(`Job ${id} publicado; entrega pendente (${error.message}). Resultado preservado.`);
                    scheduleDeliveryRecovery();
                } finally {
                    releaseClaim(id);
                }
                return;
            }

            if (data.publishStatus === 'failed' || data.publishStatus === 'disabled') {
                setStatus(`Job ${id}: publicação falhou. Resultado preservado para diagnóstico.`);
                return;
            }

            if (Date.now() - finishedAt > PUBLISH_WAIT_MS) {
                setStatus(`Job ${id} terminado; publicação ainda pendente. A continuar a verificar…`);
            } else {
                setStatus(`Job ${id} terminado; a aguardar publicação…`);
            }
            await wait(POLL_MS);
        }
    }

    async function processKnowledgeManifest(manifest, forced) {
        const id = String(manifest.id || '').trim();
        const handledId = `learn:${id}`;

        if (!id) {
            return;
        }

        if (isHandled(handledId) && !forced) {
            return;
        }

        try {
            setStatus(`A guardar a lição ${id} no GitHub…`);

            const response = await request({
                method: 'POST',
                url: `${BRIDGE_URL}/knowledge`,
                headers: authHeaders(),
                data: JSON.stringify({ entry: manifest }),
                timeout: 30000
            });

            const data = parseJson(response);

            if (!data.ok) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }

            markHandled(handledId);
            setStatus(`Lição ${id} guardada: ${data.url}`);
        } catch (error) {
            setStatus(`Falha ao guardar a lição ${id}: ${error.message}`);
        }
    }

    function composer() {
        // Nunca confundir os editores de código ou caixas de diálogo com o
        // compositor principal do ChatGPT. Filtrar elementos ocultos.
        const candidates = document.querySelectorAll(
            '#prompt-textarea, [data-testid="composer"] [contenteditable="true"], ' +
            'form [contenteditable="true"], form textarea, div.ProseMirror[contenteditable="true"]'
        );
        for (let i = candidates.length - 1; i >= 0; i--) {
            const node = candidates[i];
            if (!node.isConnected || node.closest('[aria-hidden="true"], [inert]')) continue;
            if (typeof node.getClientRects === 'function' && node.getClientRects().length === 0) continue;
            const form = node.closest('form, [data-testid="composer"]');
            if (form || node.id === 'prompt-textarea') return node;
        }
        return null;
    }

    function normalizeOutgoingText(value) {
        // innerText reflecte a apresentação, textContent os nós DOM. O editor
        // pode converter parágrafos em quebras de linha e links em elementos.
        return String(value || '')
            .normalize('NFC')
            .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
            .replace(/[\u00a0\u202f]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function sameMessageText(a, b) {
        return normalizeOutgoingText(a) === normalizeOutgoingText(b);
    }

    function normalizeResultRendering(value) {
        // O compositor pode adicionar um ícone decorativo ao link.
        // A remoção está limitada a result/log para não alterar outro texto.
        return normalizeOutgoingText(value)
            .replace(/\b(result|log):\s*[🌐🔗]\s*/gu, '$1: ');
    }

    function parsedResultEnvelope(value) {
        const plain = normalizeResultRendering(value);
        const pattern = /^PSBRIDGE_RESULT_V2 job:\s*(PSB-\S+) status:\s*(\S+) exitCode:\s*(\S+) result:\s*(https:\/\/\S+) log:\s*(https:\/\/\S+) instruction:\s*(.+)$/su;
        const match = plain.match(pattern);
        if (!match) return null;
        return {
            jobId: match[1],
            status: match[2],
            exitCode: match[3],
            resultUrl: match[4],
            logUrl: match[5],
            instruction: match[6]
        };
    }

    function samePreparedResultDraft(actual, expected, jobId) {
        if (sameMessageText(actual, expected)) return true;
        if (!jobId) return false;
        const a = parsedResultEnvelope(actual);
        const b = parsedResultEnvelope(expected);
        if (!a || !b) return false;
        return (
            a.jobId === jobId &&
            b.jobId === jobId &&
            a.status === b.status &&
            a.exitCode === b.exitCode &&
            a.resultUrl === b.resultUrl &&
            a.logUrl === b.logUrl &&
            a.instruction === b.instruction
        );
    }

    function composerDraftMatches(editor, text, deliveryJobId) {
        if (!editor) return false;
        const candidates = [
            composerText(),
            editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement
                ? String(editor.value || '')
                : String(editor.textContent || '')
        ];
        return candidates.some(candidate =>
            deliveryJobId
                ? samePreparedResultDraft(candidate, text, deliveryJobId)
                : sameMessageText(candidate, text)
        );
    }

    function composerHasOwnJobDraft(editor, jobId) {
        if (!editor || !jobId) return false;
        const text = String(editor.innerText || editor.textContent || '');
        return normalizeOutgoingText(text).startsWith('PSBRIDGE_RESULT_V2 job: ' + jobId + ' ');
    }

    function setComposerText(editor, text) {
        editor.focus();
        if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
            const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), 'value')?.set;
            if (setter) setter.call(editor, text);
            else editor.value = text;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            editor.dispatchEvent(new Event('change', { bubbles: true }));
            return;
        }

        // ProseMirror: inserir pelo mecanismo nativo de edição do navegador.
        // A substituição direta de filhos não atualiza necessariamente o estado interno do editor.
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        selection.removeAllRanges();
        selection.addRange(range);
        if (document.execCommand('insertText', false, text) && sameMessageText(composerText(), text)) {
            return;
        }
        throw new Error('O editor não aceitou a inserção nativa; mensagem original preservada para verificação.');
    }

    function findSendButton() {
        const editor = composer();
        const scoped = editor?.closest('form') || editor?.closest('[data-testid="composer"]');
        const selector = [
            '#composer-submit-button',
            '[data-testid="composer-submit-button"]',
            '[data-testid="send-button"]',
            'button[aria-label="Send message"]',
            'button[aria-label="Enviar mensagem"]',
            'button[type="submit"]'
        ].join(', ');
        return scoped?.querySelector(selector) || document.querySelector(selector);
    }

    function userTurnContains(text) {
        const nodes = document.querySelectorAll(
            '[data-message-author-role="user"], [data-author-role="user"], [data-testid*="user-message"]'
        );
        const probe = String(text || '').trim();
        if (!probe) return false;
        for (let i = nodes.length - 1; i >= Math.max(0, nodes.length - 6); i--) {
            const content = String(nodes[i].innerText || nodes[i].textContent || '').trim();
            if (content === probe || (content.includes(probe.slice(0, 80)) &&
                content.includes(probe.slice(-80)) && content.length >= probe.length - 20)) {
                return true;
            }
        }
        return false;
    }

    function apiMessageText(message) {
        const parts = message?.content?.parts;
        return Array.isArray(parts)
            ? parts.map(p => typeof p === 'string' ? p : typeof p?.text === 'string' ? p.text : '').join('\n')
            : '';
    }

    function apiContainsResult(data, id) {
        const nodes = data?.mapping;
        if (!nodes || typeof nodes !== 'object') return false;
        let current = data.current_node;
        const seen = new Set();
        // Percorrer só a ramificação atual da conversa, não outras variantes.
        for (let i = 0; i < 160 && current && !seen.has(current); i++) {
            seen.add(current);
            const item = nodes[current];
            if (!item) break;
            const message = item.message;
            const content = apiMessageText(message);
            if (message?.author?.role === 'user' &&
                content.includes('PSBRIDGE_RESULT_V2') &&
                content.includes('job: ' + String(id)) &&
                content.split(/\r?\n/).some(line => line.trim() === 'job: ' + String(id))) {
                return true;
            }
            current = item.parent;
        }
        return false;
    }

    async function checkResultDelivered(id, message) {
        // Uma mensagem ausente nunca comprova entrega pelo DOM.
        if (message && userTurnContains(message)) return { confirmed: true, apiOk: false };
        const uuid = rawConversationUuid();
        if (!uuid) return { confirmed: false, apiOk: false };
        try {
            const response = await chatgptApiFetch(
                '/backend-api/conversation/' + encodeURIComponent(uuid),
                { method: 'GET', headers: { Accept: 'application/json' } }
            );
            if (!response?.ok) return { confirmed: false, apiOk: false };
            const data = await response.json();
            return { confirmed: apiContainsResult(data, id), apiOk: true };
        } catch {
            return { confirmed: false, apiOk: false };
        }
    }

    async function sendMessage(text, manifest = null, deliveryJobId = '') {
        if (sendingMessage) throw new Error('Já existe uma entrega de mensagem nesta aba.');
        sendingMessage = true;
        try {
            if (deliveryJobId) {
                const check = await checkResultDelivered(deliveryJobId, text);
                if (check.confirmed) return;
            } else if (userTurnContains(text)) {
                return;
            }
            const editor = composer();
            if (!editor) throw new Error('Compositor do ChatGPT indisponível.');
            const draft = composerText();
            if (draft && !composerDraftMatches(editor, text, deliveryJobId)) {
                if (composerHasOwnJobDraft(editor, deliveryJobId)) {
                    throw new Error('O resultado deste job já está na caixa, mas o conteúdo difere. Preservado sem enviar nem substituir.');
                }
                throw new Error('A caixa contém um rascunho diferente; preservado sem substituir.');
            }
            if (!draft) setComposerText(editor, text);
            if (!composerDraftMatches(editor, text, deliveryJobId)) {
                throw new Error('Não foi possível validar integralmente o resultado na caixa; não enviado.');
            }

            let button = null;
            for (let n = 0; n < 24; n++) {
                button = findSendButton();
                if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') break;
                await wait(250);
            }
            if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') {
                throw new Error('Botão Enviar indisponível; nenhuma submissão forçada.');
            }
            // Um único mecanismo por tentativa: submit nativo quando o botão
            // pertence realmente a um formulário e é do tipo submit.
            // Para botões React do tipo button, usar o próprio click.
            // O clique por si só nunca equivale a entrega confirmada.
            let deliveryMethod = (
                button.form &&
                button.type === 'submit' &&
                typeof button.form.requestSubmit === 'function'
            ) ? 'form_request_submit' : 'button_click';
            let previousClicks = 0;
            if (deliveryJobId) {
                const prior = getInflight();
                if (!prior || prior.jobId !== deliveryJobId) {
                    throw new Error('O resultado não tem estado de entrega recuperável.');
                }
                previousClicks = Number(prior.deliveryClicks || 0);
                const rescueAttempt = previousClicks === 2 &&
                    prior.deliveryRescueAuthorized === VERSION &&
                    !prior.deliveryRescueUsedVersion;
                if (previousClicks >= 2 && !rescueAttempt) {
                    throw new Error('Limite de tentativas de entrega atingido. Nenhum novo envio.');
                }
                const ageMs = Date.now() - Number(prior.lastDeliveryClickAt || 0);
                if (previousClicks > 0 && ageMs < 60000) {
                    throw new Error('Entrega anterior ainda em verificação. Nenhum novo envio.');
                }
                // Reutilizar o mecanismo semanticamente correto nas tentativas
                // permitidas. Nunca executar click e requestSubmit em sequência.
                // Gravar ANTES da única tentativa (inclusive após reload).
                updateDeliveryState(deliveryJobId, 'delivery_clicked', {
                    message: text,
                    deliveryClicks: previousClicks + 1,
                    lastDeliveryClickAt: Date.now(),
                    deliveryRescueUsedVersion: previousClicks === 2 ? VERSION : prior.deliveryRescueUsedVersion,
                    deliveryRescueAuthorized: '',
                    deliveryMethod
                });
            }
            if (deliveryMethod === 'form_request_submit') {
                button.form.requestSubmit(button);
            } else {
                button.click();
            }
            for (let n = 0; n < 30; n++) {
                if (userTurnContains(text)) return;
                // A API autentica a entrega mesmo se o ChatGPT virtualizar
                // o turno do utilizador e não o montar no DOM.
                if (deliveryJobId && n % 4 === 0) {
                    const checked = await checkResultDelivered(deliveryJobId, text);
                    if (checked.confirmed) return;
                }
                await wait(650);
            }
            if (deliveryJobId && composerDraftMatches(editor, text, deliveryJobId)) {
                throw new Error('O resultado do próprio job continua preparado na caixa; a submissão não foi confirmada. Sem novo envio imediato.');
            }
            throw new Error('Envio não confirmado; verificar a API antes de qualquer nova tentativa.');
        } finally {
            sendingMessage = false;
        }
    }

    async function cancelActive() {
        if (!activeJobId) {
            setStatus('Não existe nenhum job ativo nesta aba.');
            return;
        }

        try {
            await request({
                method: 'POST',
                url: `${BRIDGE_URL}/cancel`,
                headers: authHeaders(),
                data: JSON.stringify({ jobId: activeJobId }),
                timeout: 8000
            });

            setStatus(`Cancelamento pedido para ${activeJobId}.`);
        } catch (error) {
            setStatus(`Falha ao cancelar: ${error.message}`);
        }
    }

    async function setAdmin() {
        try {
            const response = await request({
                method: 'POST',
                url: `${BRIDGE_URL}/set-admin`,
                headers: authHeaders(),
                data: JSON.stringify({ enabled: true }),
                timeout: 8000
            });

            const data = parseJson(response);

            if (!data.ok) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }

            setStatus(data.restarting
                ? 'Elevação pedida. Confirma a janela UAC.'
                : 'A bridge já está em modo ADMIN.');
        } catch (error) {
            setStatus(`Falha no modo ADMIN: ${error.message}`);
        }
    }


    // Recuperação sem scroll: só consulta a conversa depois de uma interação
    // de envio/novo turno, nunca percorre periodicamente o histórico HTML.
    function stopApiProbe() {
        clearTimeout(apiProbeTimer);
        apiProbeTimer = 0;
        apiProbeDeadline = 0;
        apiProbeStartedAt = 0;
        apiProbeConversation = '';
        apiProbeEpoch++;
    }

    function armApiProbe() {
        if (!enabled() || activeJobId) return;
        const current = conversationId();
        if (apiProbeConversation !== current || !apiProbeDeadline) {
            apiProbeConversation = current;
            apiProbeStartedAt = Date.now();
            apiProbeDeadline = Date.now() + 5 * 60 * 1000;
            apiProbeEpoch++;
        }
        queueApiProbe(4000, apiProbeEpoch);
    }

    function queueApiProbe(delay, epoch) {
        clearTimeout(apiProbeTimer);
        apiProbeTimer = window.setTimeout(() => {
            apiProbeTimer = 0;
            if (epoch === apiProbeEpoch) void runApiProbe(epoch);
        }, delay);
    }

    function latestFinalAssistantFromApi(data) {
        const mapping = data?.mapping;
        let current = data?.current_node;
        if (!mapping || typeof mapping !== 'object' || typeof current !== 'string') {
            return { state: 'pending' };
        }

        const visited = new Set();
        for (let n = 0; n < 32 && current && !visited.has(current); n++) {
            visited.add(current);
            const node = mapping[current];
            if (!node) return { state: 'pending' };
            const message = node.message;
            const role = message?.author?.role;
            if (role === 'user') return { state: 'pending' };
            if (role === 'assistant' && (!message.recipient || message.recipient === 'all')) {
                // Excluir mensagens intermédias, chamadas a ferramentas e streaming.
                if (message.end_turn !== true || message.status !== 'finished_successfully') {
                    return { state: 'pending' };
                }
                // O turno final tem de ser posterior ao envio que armou a pesquisa:
                // impede a execução de um job de uma resposta anterior.
                const createdAt = Number(message.create_time);
                if (!Number.isFinite(createdAt) || createdAt <= 0 ||
                    createdAt * 1000 < apiProbeStartedAt - 1500) {
                    return { state: 'pending' };
                }
                const parts = message?.content?.parts;
                if (!Array.isArray(parts)) return { state: 'finished', text: '' };
                return {
                    state: 'finished',
                    text: parts.filter(x => typeof x === 'string').join('\n')
                };
            }
            current = node.parent;
        }
        return { state: 'pending' };
    }

    function jobFromApiText(text) {
        // Só blocos PowerShell explicitamente identificados como PSB_JOB_V3.
        // Não executar exemplos em prosa ou comandos de outras mensagens.
        const fences = /\`\`\`(?:powershell|pwsh|ps1)[^\n]*\n([\s\S]*?)\`\`\`/gi;
        for (const match of String(text || '').matchAll(fences)) {
            const block = match[1].trim();
            if (!/^#\s*PSB_JOB_V3\s*$/im.test(block)) continue;
            const candidate = parseV3PowerShellBlock(block);
            if (!candidate || manifestLooksLikePlaceholder(candidate)) continue;
            if (!/^PSB-\d{8}-\d{4}-[A-Z0-9-]+-\d{3}$/i.test(candidate.jobId)) continue;
            return candidate;
        }
        return null;
    }

    async function runApiProbe(epoch) {
        if (epoch !== apiProbeEpoch || !enabled() ||
            conversationId() !== apiProbeConversation || activeJobId) return;
        if (apiProbeBusy) {
            queueApiProbe(2000, epoch);
            return;
        }

        if (Date.now() > apiProbeDeadline) {
            stopApiProbe();
            return;
        }

        const uuid = rawConversationUuid();
        if (!uuid) {
            queueApiProbe(7000, epoch);
            return;
        }

        apiProbeBusy = true;
        let shouldRepeat = true;
        try {
            const response = await chatgptApiFetch(
                '/backend-api/conversation/' + encodeURIComponent(uuid),
                { method: 'GET', headers: { Accept: 'application/json' } }
            );
            if (response.ok) {
                const data = await response.json();
                if (epoch !== apiProbeEpoch || !enabled() ||
                    conversationId() !== apiProbeConversation) return;
                const latest = latestFinalAssistantFromApi(data);
                if (latest.state === 'finished') {
                    const manifest = jobFromApiText(latest.text);
                    if (manifest && !isHandled(manifest.jobId)) {
                        setStatus('Job detetado pela conversa autenticada, sem scroll.');
                        await processJobManifest(null, manifest, false);
                    }
                    shouldRepeat = false;
                }
            }
        } catch (error) {
            // API não documentada: falhar em segurança, sem alterar sessão,
            // publicar tokens ou enviar um comando duplicado.
            console.debug('[LPX PSB] Verificação sem scroll indisponível:', error.message);
        } finally {
            apiProbeBusy = false;
            if (epoch === apiProbeEpoch && shouldRepeat && enabled() &&
                Date.now() <= apiProbeDeadline && !activeJobId) {
                queueApiProbe(10000, epoch);
            } else if (epoch === apiProbeEpoch) {
                stopApiProbe();
            }
        }
    }

    function installNoScrollTriggers() {
        // Suporta submit por botão e Enter, mesmo quando a resposta não é
        // montada no DOM enquanto estiver fora da zona visível.
        document.addEventListener('submit', event => {
            if (event.target?.querySelector?.('#prompt-textarea, div.ProseMirror')) {
                armApiProbe();
            }
        }, true);
        document.addEventListener('keydown', event => {
            if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
            const editor = composer();
            if (editor && (event.target === editor || editor.contains(event.target))) {
                armApiProbe();
            }
        }, true);
        document.addEventListener('click', event => {
            if (event.target?.closest?.('#composer-submit-button, [data-testid="composer-submit-button"], [data-testid="send-button"]')) {
                armApiProbe();
            }
        }, true);
    }

    function wait(ms) {
        return new Promise(resolve => window.setTimeout(resolve, ms));
    }

    window.addEventListener('focus', () => {
        installObserver();
        scheduleCandidate(candidateAssistant || document.body);
        scheduleDeliveryRecovery(1400);
        void rememberConversation();
    }, true);

    window.addEventListener('popstate', () => {
        stopApiProbe();
        candidateAssistant = null;
        installObserver();
        scheduleHeartbeat(1200);
        render();
    }, true);

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            installObserver();
            scheduleCandidate(candidateAssistant || document.body);
            scheduleDeliveryRecovery(1400);
        }
    });

    const autoRequested = new URLSearchParams(location.search).get('lpxBridge') === '1';

    if (autoRequested && token()) {
        baselineCurrentAssistant();
        setEnabled(true);

        const cleanUrl = new URL(location.href);
        cleanUrl.searchParams.delete('lpxBridge');
        history.replaceState(history.state, '', cleanUrl.href);
    }

    installPanelInteractions();
    installNoScrollTriggers();
    render();
    installObserver();
    scheduleCandidate(document.body);
    scheduleDeliveryRecovery(3000);
    scheduleHeartbeat(1200);
    void rememberConversation();

    void healthCheck(true)
        .then(data => {
            setStatus(
                `Bridge protocolo ${data.protocol} · ${String(data.mode || '').toUpperCase()} · ` +
                `GitHub ${data.githubConfigured ? 'OK' : 'não configurado'} · ` +
                `${enabled() ? 'autonomia ativa nesta aba' : 'autonomia parada'}.`
            );
            const unresolved = unresolvedJobs();
            if (unresolved.length && !getInflight()) {
                const last = unresolved[unresolved.length - 1];
                setStatus(`Job ${last.jobId}: registo ausente do servidor (HTTP ${last.httpStatus}). Guardado como por esclarecer. Não reexecutar.`);
            }

            // Não enviar o protocolo em cada recarregamento de separador:
            // evita disputar o compositor com resultados já publicados.
            if (enabled()) scheduleDeliveryRecovery(1000);
        })
        .catch(() => {
            setStatus('Bridge indisponível. Liga-a pelo atalho do Ambiente de Trabalho.');
        });
})();
