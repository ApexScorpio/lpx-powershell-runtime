// ==UserScript==
// @name         ChatGPT PowerShell Bridge — v15 Lite Multi-Conversation
// @namespace    apexscorpio.local
// @version      2026.07.30.15.3.17
// @description  Executa ficheiros PowerShell anexados sem colocar o comando no histórico; mantém V2/V3 por compatibilidade.
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


    const VERSION = '15.3.17';
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
    const CLAIM_TTL_MS = 2 * 60 * 1000;
    const POLL_MS = 750;
    const SETTLE_MS = 900;
    const PUBLISH_WAIT_MS = 90 * 1000;

    let candidateAssistant = null;
    let settleTimer = 0;
    let activeJobId = '';
    let activeManifest = null;
    let lastAttachmentDiagnostic = '';
    let observer = null;
    let observerRoot = null;
    let lastStatus = 'A iniciar…';

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

    function claim(id) {
        const claims = cleanClaims();
        const existing = claims[id];
        const now = Date.now();

        if (existing) {
            const sameConversation =
                existing.conversation ===
                conversationId();

            const claimedAt =
                Number(existing.claimedAt || 0);

            const recent =
                claimedAt > 0 &&
                now - claimedAt < 30 * 1000;

            if (!sameConversation || recent) {
                return false;
            }

            delete claims[id];
        }

        claims[id] = {
            tabId: TAB_ID,
            instanceId: INSTANCE_ID,
            conversation: conversationId(),
            claimedAt: now,
            expiresAt: now + CLAIM_TTL_MS
        };

        GM_setValue(CLAIMS_KEY, claims);
        return true;
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

        render();
    }

    function protocolPromptKey() {
        return `${PROMPT_SENT_PREFIX}${simpleHash(conversationId())}:${VERSION}`;
    }

    function protocolPromptText() {
        return [
            'LPX_POWERSHELL_BRIDGE_PROTOCOL_V15_3',
            '',
            `Esta conversa está ligada à LPX PowerShell Bridge v${VERSION}.`,
            '',
            'Sempre que for necessário executar PowerShell, cria o comando num ficheiro .ps1 anexado e responde apenas com um manifesto JSON pequeno:',
            '{',
            '  "protocol": "PSB_JOB_FILE_V1",',
            '  "jobId": "PSB-AAAAMMDD-HHMM-DESCRICAO-001",',
            '  "file": "nome-unico-do-comando.ps1",',
            '  "fileId": "file_00000000000000000000000000000000",',
            '  "purpose": "objetivo claro e curto"',
            '}',
            '',
            'REGRAS OBRIGATÓRIAS:',
            '1. O PowerShell completo fica apenas dentro do ficheiro .ps1 anexado; nunca o coloques no texto da conversa.',
            '2. Na mesma resposta, inclui apenas o manifesto JSON e um link normal para descarregar esse ficheiro.',
            '2A. Inclui fileId apenas quando a plataforma fornecer explicitamente o identificador do anexo desta mensagem; nunca o inventes nem reutilizes.',
            '3. Não uses Base64, SHA-256, command, commandBase64, links GitHub temporários nem blocos PowerShell para o job.',
            '4. Usa um nome de ficheiro e um jobId únicos em cada execução.',
            '5. O userscript aciona o download do anexo e a bridge local encontra, valida, normaliza e executa o ficheiro.',
            '6. PSB_JOB_V2 e PSB_JOB_V3 continuam aceites apenas para compatibilidade e recuperação.',
            '7. Depois de receberes PSBRIDGE_RESULT_V2, lê primeiro o URL result e continua o diagnóstico.',
            '8. Usa o URL log apenas quando o resumo JSON não for suficiente e não reproduzas o log completo na conversa.',
            '9. Mantém os comandos temporários; guarda apenas decisões, causas e soluções técnicas consolidadas.',
            '',
            'Confirma estas regras silenciosamente e aplica-as em todas as próximas execuções PowerShell desta conversa.'
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

        setStatus('A enviar ao ChatGPT o formato obrigatório PSB_JOB_FILE_V1…');
        await sendMessage(protocolPromptText());
        GM_setValue(key, true);
        setStatus('Protocolo PSB_JOB_FILE_V1 enviado. A bridge está pronta.');
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
                    setStatus('Ativa. A preparar o protocolo PSB_JOB_FILE_V1…');

                    try {
                        await sendProtocolPrompt(false);
                    } catch (error) {
                        setStatus(`A bridge ficou ativa, mas o protocolo não foi enviado: ${error.message}`);
                    }
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

    function closestAssistant(node) {
        const element = node?.nodeType === Node.ELEMENT_NODE
            ? node
            : node?.parentElement;

        return element?.closest?.('[data-message-author-role="assistant"]') || null;
    }

    function latestAssistantFallback() {
        const nodes = document.querySelectorAll('[data-message-author-role="assistant"]');
        return nodes.length ? nodes[nodes.length - 1] : null;
    }

    function baselineCurrentAssistant() {
        const latest = latestAssistantFallback();

        if (!latest) {
            return;
        }

        for (const manifest of manifestsIn(latest)) {
            if (['PSB_JOB_FILE_V1', 'PSB_JOB_V2', 'PSB_JOB_V3'].includes(manifest.protocol) && manifest.jobId) {
                markHandled(String(manifest.jobId));
            }

            if (manifest.protocol === 'PSB_LEARN_V1' && manifest.id) {
                markHandled(`learn:${manifest.id}`);
            }
        }
    }

    function scheduleCandidate(node) {
        const assistant = closestAssistant(node);

        if (assistant) {
            candidateAssistant = assistant;
        }

        clearTimeout(settleTimer);
        settleTimer = window.setTimeout(() => {
            void inspectCandidate(false);
        }, SETTLE_MS);
    }

    function installObserver() {
        const root = document.querySelector('main') || document.body;

        if (observerRoot === root) {
            return;
        }

        observer?.disconnect();
        observerRoot = root;

        observer = new MutationObserver(records => {
            for (const record of records) {
                scheduleCandidate(record.target);

                for (const added of record.addedNodes) {
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
            const jobMatch = line.match(/^\s*#\s*jobId\s*:\s*(.+?)\s*$/i);
            const purposeMatch = line.match(/^\s*#\s*purpose\s*:\s*(.*?)\s*$/i);

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

            if (!line.trim()) {
                commandStart = index + 1;
                continue;
            }

            break;
        }

        const command = lines
            .slice(commandStart)
            .join('\n')
            .replace(/^\n+/, '');

        if (!jobId || !command.trim()) {
            return null;
        }

        return {
            protocol: 'PSB_JOB_V3',
            jobId,
            purpose,
            command
        };
    }

    function manifestsIn(assistant) {
        const manifests = [];

        for (const pre of assistant.querySelectorAll('pre')) {
            const text = String(pre.innerText || pre.textContent || '').trim();

            if (!text) {
                continue;
            }

            if (text.includes('PSB_JOB_V3')) {
                const value = parseV3PowerShellBlock(text);

                if (value) {
                    manifests.push(value);
                    continue;
                }
            }

            if (!text.includes('PSB_JOB_FILE_V1') && !text.includes('PSB_JOB_V2') && !text.includes('PSB_LEARN_V1')) {
                continue;
            }

            try {
                const value = JSON.parse(text);

                if (value && typeof value === 'object' && value.protocol) {
                    manifests.push(value);
                }
            } catch {
                // Apenas JSON válido é aceite no protocolo antigo.
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
            scheduleCandidate(candidateAssistant || document.body);
            return;
        }

        const assistant = candidateAssistant || latestAssistantFallback();

        if (!assistant) {
            setStatus('Não foi encontrada uma resposta do assistente.');
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
        const wanted = String(fileName || '')
            .trim()
            .toLowerCase();

        const turn = turnContainer(assistant);

        if (
            !wanted ||
            !(turn instanceof Element)
        ) {
            return [];
        }

        const selector = [
            'a[href]',
            'button',
            '[role="button"]',
            '[tabindex]',
            '[data-testid*="download"]',
            '[data-testid*="attachment"]',
            '[data-testid*="file"]'
        ].join(', ');

        const found = [];
        const seen = new Set();

        function add(node, priority = 0) {
            if (
                !(node instanceof HTMLElement) ||
                seen.has(node) ||
                !turn.contains(node) ||
                node.closest('pre, code')
            ) {
                return;
            }

            const label =
                attachmentControlLabel(node);

            if (!label.includes(wanted)) {
                return;
            }

            seen.add(node);

            const href = String(
                node.getAttribute('href') || ''
            ).trim();

            let score = priority + 500;

            if (/^sandbox:/i.test(href)) {
                score += 2000;
            }

            if (node.matches('a[href]')) {
                score += 900;
            }

            if (
                node.matches(
                    'button, [role="button"]'
                )
            ) {
                score += 500;
            }

            if (node.hasAttribute('download')) {
                score += 700;
            }

            if (
                /download|descarregar|transferir|attachment|anexo|file|ficheiro/
                    .test(label)
            ) {
                score += 250;
            }

            found.push({
                node,
                score
            });
        }

        for (
            const control of
            turn.querySelectorAll(selector)
        ) {
            add(control, 200);
        }

        return found
            .sort(
                (left, right) =>
                    right.score - left.score
            )
            .map(entry => entry.node)
            .slice(0, 6);
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
                'Foram acionados ' +
                attempts +
                ' elementos. A aguardar que o Chrome termine o download…'
            );
        }

        await requestPromise;

        if (requestError) {
            throw requestError;
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

        return String(
            turn.getAttribute(
                'data-message-id'
            ) || ''
        ).trim();
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

        if (!messageId) {
            throw new Error(
                'A mensagem do manifesto não tem data-message-id.'
            );
        }

        const conversationUuid =
            rawConversationUuid();

        if (!conversationUuid) {
            throw new Error(
                'Não foi possível obter o UUID da conversa.'
            );
        }

        setStatus(
            'A consultar apenas a mensagem ' +
            messageId +
            ' na API autenticada…'
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
            mapping[messageId] ||
            null;

        if (!exactNode) {
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

        const exactRoot = {
            mapping: {
                [messageId]:
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

        if (isHandled(jobId) && !forced) {
            return;
        }

        if (!claim(jobId)) {
            setStatus(`O job ${jobId} já está a ser tratado noutra aba.`);
            return;
        }

        try {
            let command = '';


            if (
                protocol === 'PSB_JOB_FILE_V1' &&
                !fileUrl
            ) {
                setStatus(
                    'A resolver o anexo exclusivamente pela mensagem exata da API…'
                );

                try {
                    command =
                        await lpxResolveExactMessageAttachment(
                            assistant,
                            fileName,
                            jobId,
                            fileId
                        );
                } catch (error) {
                    lastAttachmentDiagnostic =
                        'exactMessageResolver=error:' +
                        String(
                            error &&
                            error.message ||
                            error
                        );

                    command = '';
                }

                if (!command) {
                    if (fileId) {
                        throw new Error(
                            'O fileId explícito não devolveu um ficheiro PowerShell válido. Diagnóstico: ' +
                            (
                                lastAttachmentDiagnostic ||
                                'indisponível'
                            ) +
                            '.'
                        );
                    }

                    await queueExactSandboxFileJob(
                        assistant,
                        manifest,
                        fileName,
                        jobId,
                        protocol
                    );

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
            setStatus(`Job ${activeJobId} em execução. O ficheiro ficou fora do histórico; Base64 e SHA-256 foram calculados localmente.`);
            await monitorActiveJob();
        } catch (error) {
            releaseClaim(jobId);
            activeJobId = '';
            activeManifest = null;
            setStatus(`Falha no job ${jobId}: ${error.message}`);
        }
    }

    async function monitorActiveJob() {
        const started = Date.now();
        let finishedAt = 0;

        while (activeJobId) {
            const response = await request({
                method: 'GET',
                url: `${BRIDGE_URL}/job/${encodeURIComponent(activeJobId)}?metadata=1&_=${Date.now()}`,
                headers: {
                    'X-Bridge-Token': token(),
                    'Cache-Control': 'no-cache'
                },
                timeout: 8000
            });

            const data = parseJson(response);

            if (response.status >= 400) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }

            if (data.running) {
                setStatus(`Job ${activeJobId} em execução · ${Math.floor((Date.now() - started) / 1000)} s.`);
                await wait(POLL_MS);
                continue;
            }

            if (!finishedAt) {
                finishedAt = Date.now();
            }

            if (data.publishStatus === 'published' && data.resultJsonUrl) {
                const manifest = activeManifest;
                const completedJobId = activeJobId;

                markHandled(completedJobId);
                releaseClaim(completedJobId);
                activeJobId = '';
                activeManifest = null;

                const message = [
                    'PSBRIDGE_RESULT_V2',
                    `job: ${completedJobId}`,
                    `status: ${String(data.status || '').toUpperCase()}`,
                    `exitCode: ${data.exitCode ?? 'desconhecido'}`,
                    `result: ${data.resultJsonUrl}`,
                    `log: ${data.resultUrl || ''}`,
                    'instruction: lê apenas este resultado público, considera o que já foi tentado e continua o diagnóstico. Não reproduzas o log completo na conversa.'
                ].join('\n');

                setStatus(`Resultado publicado. A enviar apenas o URL para esta conversa…`);
                await sendMessage(message, manifest);
                setStatus(`Job ${completedJobId} concluído e enviado por URL.`);
                return;
            }

            if (data.publishStatus === 'failed' || data.publishStatus === 'disabled') {
                throw new Error(data.publishError || 'A publicação no GitHub falhou.');
            }

            if (Date.now() - finishedAt > PUBLISH_WAIT_MS) {
                throw new Error('O job terminou, mas a publicação no GitHub ultrapassou o tempo limite.');
            }

            setStatus(`Job terminado. A publicar o resultado no GitHub…`);
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
        return document.querySelector('#prompt-textarea')
            || document.querySelector('[contenteditable="true"][data-lexical-editor="true"]')
            || document.querySelector('textarea[placeholder]');
    }

    function setComposerText(editor, text) {
        editor.focus();

        if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
            const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), 'value')?.set;

            if (setter) {
                setter.call(editor, text);
            } else {
                editor.value = text;
            }

            editor.dispatchEvent(new Event('input', { bubbles: true }));
            return;
        }

        editor.replaceChildren();

        for (const line of text.split('\n')) {
            const paragraph = document.createElement('p');

            if (line) {
                paragraph.textContent = line;
            } else {
                paragraph.appendChild(document.createElement('br'));
            }

            editor.appendChild(paragraph);
        }

        editor.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: text
        }));
    }

    function findSendButton() {
        return document.querySelector('[data-testid="send-button"]')
            || [...document.querySelectorAll('button')].find(node => /enviar|send/i.test(node.getAttribute('aria-label') || ''))
            || null;
    }

    async function sendMessage(text) {
        for (let attempt = 0; attempt < 40; attempt++) {
            const editor = composer();

            if (!editor) {
                await wait(250);
                continue;
            }

            setComposerText(editor, text);
            await wait(250);

            const send = findSendButton();

            if (send && !send.disabled) {
                send.click();
                return;
            }

            await wait(250);
        }

        throw new Error('Não foi possível enviar automaticamente o URL do resultado.');
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

    function wait(ms) {
        return new Promise(resolve => window.setTimeout(resolve, ms));
    }

    window.addEventListener('focus', () => {
        installObserver();
        scheduleCandidate(candidateAssistant || document.body);
        void rememberConversation();
    }, true);

    window.addEventListener('popstate', () => {
        candidateAssistant = null;
        installObserver();
        render();
    }, true);

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            installObserver();
            scheduleCandidate(candidateAssistant || document.body);
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
    render();
    installObserver();
    void rememberConversation();

    void healthCheck(true)
        .then(data => {
            setStatus(
                `Bridge protocolo ${data.protocol} · ${String(data.mode || '').toUpperCase()} · ` +
                `GitHub ${data.githubConfigured ? 'OK' : 'não configurado'} · ` +
                `${enabled() ? 'autonomia ativa nesta aba' : 'autonomia parada'}.`
            );

            if (enabled()) {
                window.setTimeout(() => {
                    void sendProtocolPrompt(false);
                }, 900);
            }
        })
        .catch(() => {
            setStatus('Bridge indisponível. Liga-a pelo atalho do Ambiente de Trabalho.');
        });
})();
