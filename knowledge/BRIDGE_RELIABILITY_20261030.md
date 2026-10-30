# LPX PowerShell Bridge — Histórico de fiabilidade (2026-10-30)

Registo cumulativo: não substituir nem remover as entradas anteriores.

## 2026-10-30 — Passo 1: Inspeção em modo leitura
- Consultado userscript público da branch main com versão 15.5.12 e respetivos metadados.
- Identificado envio de mensagens com até 30 tentativas e combinação de cliques sintéticos, click, requestSubmit e Enter.
- A função de envio terminava com sucesso mesmo se o texto continuava no compositor.
- Detetados claim TTL de 120 segundos, possibilidade de outro separador assumir um job ao fim de 30 segundos, e perda de acompanhamento após erro HTTP/timeout.
- Identificada a marcação do job como tratado antes da confirmação do envio do resultado.

## 2026-10-30 — Passo 2: Correção isolada
- Criada branch fix/bridge-delivery-recovery-20261030 sem substituir a versão main.
- Versão candidata 15.5.13.
- Substituídas tentativas repetidas por um único clique nativo no botão ativo, com confirmação de mensagem de utilizador no histórico.
- Bloqueada substituição de rascunhos alheios e manipulação forçada de botões desativados.
- Inserção de texto ProseMirror tentada via execCommand('insertText') para envolver o mecanismo nativo de edição do navegador.
- Introduzido registo persistente inflight por conversa, guardado antes da submissão ao serviço local.
- Restabelecimento do acompanhamento via GET de job existente sem novo POST e monitorização tolerante a falhas temporárias de rede.
- Resultado assinalado como tratado apenas depois de confirmação de envio ao ChatGPT.
- Claims alargados para 10 minutos e renovados durante monitorização.
- Quando um envio ou job fica incerto, conserva-se a referência e não se reexecuta cegamente.

## 2026-10-30 — Passo 3: Validação limitada
- Compilação sintática JavaScript via new Function: PASS.
- Quatro testes lógicos isolados: rascunho preexistente preservado, botão desativado não clicado, um clique para envio confirmado, um clique para envio não confirmado.
- Resultado: 4 PASS, 0 FAIL.
- Sem acesso ao Chrome real do utilizador nem aos logs do daemon; testes de integração reais ainda pendentes.
- Não foram fechadas aplicações, modificadas sessões ou eliminados tokens.
- Não foi possível recolher screenshot do Chrome do utilizador; validação visual só possível por execução local.

## 2026-10-30 — Riscos e próximos testes
- Confirmar DOM e comportamento da versão do ChatGPT instalada no Chrome, sobretudo inserção multi-linha em ProseMirror.
- Confirmar semântica do endpoint /job em caso de timeout, HTTP 404 e expiração real do lado servidor.
- Confirmar processo de atualização do Tampermonkey da versão 15.5.11.
- Não apresentar a correção como testada no Windows até receber evidência real.

## 2026-10-30 — Passo 4: Proteção da deteção e revisão de compatibilidade
- A observação de alterações ignora mutações alheias às respostas do assistente, para impedir que alterações contínuas no compositor adiem a deteção de jobs.
- A monitorização também acompanha jobs iniciados manualmente através do painel, mesmo quando a autonomia não está ativa.
- Sintaxe novamente validada com sucesso.
- Consultada documentação MDN: document.execCommand('insertText') é uma API antiga, com comportamento dependente do navegador e que exige validação no Chrome real.
- A correção não pressupõe que esta API funcione em todas as versões do ChatGPT; uma falha mantém o envio como não confirmado.

## 2026-10-30 — Passo 5: Publicação da versão
- PR #1 criada e integrada na branch main.
- Commit de integração: 8ae2b8edcfb9122c5d135b60b001092b79722d11.
- Versão publicada em main: 15.5.13; revisão de leitura confirmada após integração.
- A publicação não equivale a instalação automática imediata no Chrome do utilizador.
- A verificação de serviço local, daemon, logs e screenshots do utilizador continua necessária para encerrar o incidente.

## 2026-10-30 — Passo 6: Diagnóstico da dependência de scroll
- Analisada a versão 15.5.13 do userscript na branch principal.
- Confirmado que o MutationObserver ignorava respostas inseridas dentro de subárvores porque avaliava sobretudo os ancestrais do nó inserido.
- Confirmado que não existia mecanismo de recuperação a partir do último turno autenticado após uma submissão cujo conteúdo não fosse montado no DOM.
- Foram consultadas as notas MDN sobre visibilitychange e os limites de temporizadores de separadores em segundo plano; isto não demonstra qual o comportamento observado na instalação real.
- Correção criada na branch fix/bridge-scroll-independent-20261030; nenhum processo ou sessão local alterado.

## 2026-10-30 — Passo 7: Versão candidata 15.5.14
- A deteção por MutationObserver passou a inspecionar as subárvores efetivamente adicionadas, sem percorrer todo o histórico em cada alteração.
- Evitada a procura integral do histórico durante a geração de uma resposta.
- Adicionadas escutas de interação no envio (botão, submit e Enter) para acionar uma verificação temporária independente do scroll.
- Se a resposta não aparecer no DOM, a verificação consulta a conversa autenticada através do endpoint que já era utilizado na Bridge para obter anexos, sem transmitir credenciais a terceiros.
- Só são elegíveis respostas finais do assistente, posteriores à interação que iniciou a verificação, com bloco PowerShell PSB_JOB_V3 e jobId válido.
- Ficam excluídos exemplos em prosa, mensagens antigas, mensagens de utilizador, outputs de ferramentas e respostas ainda em streaming.
- Um mesmo job não pode entrar simultaneamente duas vezes na rotina de processamento.
- Não existe varrimento permanente do histórico; a verificação tem duração limitada e termina quando a resposta final é confirmada.
- A deteção de mensagens de utilizador montadas por virtualização não aciona a consulta autenticada, evitando executar trabalhos antigos por efeito do scroll.
- Nova versão: 15.5.14.

## 2026-10-30 — Passo 8: Testes isolados
- Validação de sintaxe JavaScript: PASS.
- Cenário de resposta final com job legítimo sem depender do DOM: PASS.
- Cenário de utilizador atual sem resposta e job antigo: PASS.
- Resposta antiga: ignorada — PASS.
- Resposta em streaming: ignorada — PASS.
- Prosa simples, bloco sem cabeçalho e jobId-placeholder: ignorados — PASS.
- Verificação estática adicional: PASS.
- Resultado: 8 PASS, 0 FAIL.
- Limite: não foram executados testes end-to-end no Chrome do utilizador; a API interna de conversa pode mudar sem aviso.
- Não foram capturados screenshots da sessão local, por não existir acesso ao navegador do utilizador; nenhuma validação visual real foi afirmada.

## 2026-10-30 — Passo 9: Testes de subárvores DOM
- Foram simulados quatro cenários adicionais para a rotina de deteção: resposta dentro de nova subárvore, nó de resposta direto, subárvore apenas de utilizador e nó de texto.
- Resultado: 4 PASS, 0 FAIL.
- Total de testes isolados desta correção: 12 PASS, 0 FAIL.
- A simulação não substitui o teste visual e funcional no Chrome do utilizador.

## 2026-10-30 — Passo 10: Integração da correção sem scroll
- Pull Request #2 criado e integrado na branch main.
- Commit de integração: 49c61cd805988174c867b5be78650a2d10b9dee4.
- Ficheiro de userscript relido na branch main e confirmada a versão 15.5.14, com deteção de subárvores, recuperação por API autenticada e mutex de jobs.
- A publicação no GitHub não garante que o Tampermonkey no Chrome já tenha atualizado a versão instalada.
- Validação do Chrome local e screenshot da execução sem scroll continuam pendentes; não foram reportadas como concluídas.

## 2026-10-30 — Passo 11: Screenshot real denuncia versão antiga e entrega por confirmar
- Screenshot fornecida pelo utilizador apresenta no painel Tampermonkey "PowerShell Bridge v15.5.11 · ATIVA".
- Estado visível: "Resultado publicado. A enviar apenas o URL para esta conversa..."; publicação não comprova entrega.
- A resposta visível anuncia um job FiscalGuard; na parte visível da captura não aparece o bloco PSB_JOB_V3. A região abaixo da captura não é observável, pelo que não foi afirmada ausência no turno inteiro.
- Confirmado no GitHub que o userscript 15.5.11 já tinha @updateURL e @downloadURL para o mesmo raw URL da versão publicada 15.5.14. A versão local é antiga; atualização do repositório não equivale a atualização da aba.
- Confirmada na documentação oficial Tampermonkey a opção de verificar atualizações do userscript.
- Identificada documentação 15.2.0 no ficheiro CHATGPT_PROTOCOL_PROMPT.md ainda intitulada "protocolo ativo", contrariando o protocolo atual PSB_JOB_V3.
- Criado ACTIVE_BRIDGE_PROTOCOL_V15.md com formato real e diagnóstico; apensa retificação ao documento histórico original, sem remover quaisquer entradas.
- Nenhum acesso à sessão Chrome real nem ao daemon Windows. Não foram alterados tokens, perfis, backups ou processos.

## 2026-10-30 — Passo 12: Integração e verificação do protocolo
- Pull Request #3 integrada na branch main; commit de integração d61f9e189e78973bbe0a5d3f816fd0297b7aad51.
- Confirmada a existência do novo knowledge/ACTIVE_BRIDGE_PROTOCOL_V15.md e a retificação aditiva em knowledge/CHATGPT_PROTOCOL_PROMPT.md.
- Relido cabeçalho do userscript em main: VERSION=15.5.14 e @updateURL permanece ligado à branch main.
- A imagem fornecida continua a comprovar apenas que o separador fotografado tinha o runtime 15.5.11, não que a atualização tenha sido aplicada.
- Não foi feita reinicialização, atualização de perfis/tokens ou execução local; a correção do cliente no Chrome depende da instalação efetiva de versão recente pelo Tampermonkey.

## 2026-10-30 — Passo 13: Evidência visual de falha generalizada na entrega
- Captura fornecida pelo utilizador mostra três separadores independentes com o runtime v15.5.14 ativo: PokéGuide, TIMI e FiscalGuard.
- Todos têm resultados publicados e entrega automática não confirmada; não é uma falha de instalação ou reconhecimento dos três jobs.
- Jobs visíveis na imagem: PSB-20261030-1116-POKEGUIDE-ASM626-005; PSB-20261030-1127-TIMI-VOUCHER-PREFLIGHT-033; PSB-20261030-1124-FISCALGUARD-AT-REAL-003.
- Dois separadores mostram erro de confirmação da mensagem no histórico; um mostra compositor ocupado com outro texto.
- O código v15.5.14 verificava a entrega principalmente por nós de utilizador no DOM e, após falha, preservava o inflight sem rotina de recuperação automática suficientemente eficaz.
- O histórico de utilizador pode estar virtualizado; uma ausência no DOM não equivale a ausência da mensagem no servidor.

## 2026-10-30 — Passo 14: Implementação isolada v15.5.15
- Branch: fix/bridge-delivery-ack-recovery-20261030.
- Confirmar entrega por leitura autenticada de /backend-api/conversation/{id} no mesmo domínio do ChatGPT, percorrendo a ramificação atual e exigindo role=user e jobId exato.
- O resultado é guardado no estado local da conversa antes de tentar submetê-lo.
- Registo dos cliques de envio antes de executá-los; não repetir cegamente um clique com confirmação pendente.
- Recuperação de estados v15.5.14 por GET /job, sem repetição do POST /run nem execução PowerShell.
- Respeito por rascunhos do utilizador e pelo editor correto, verificando visibilidade e pertença ao formulário do ChatGPT.
- Verificação de resultados após carregamento, foco e visibilidade de cada aba.
- Protocolo não é reenviado automaticamente ao ativar ou recarregar a aba; opção manual continua disponível.
- O estado antigo sem contagem de cliques exige prova de ausência do resultado na conversa antes de tentar uma nova entrega.
- Jobs previamente aceites e ainda em execução podem recuperar acompanhamento por GET sem reexecutar comandos.

## 2026-10-30 — Passo 15: Testes de unidade isolados
- Sintaxe JavaScript: PASS.
- Confirmação por linha exata de jobId: PASS.
- Rejeição de identificação errada: PASS.
- Rejeição de mensagens de assistente e de variantes de ramificação não ativas: PASS.
- Isolamento de identificadores entre as três conversas: PASS.
- Recuperação sem POST /run: PASS.
- Garantia de preservação de rascunhos e disparos automáticos ao carregar/focar: PASS.
- Testes de recuperação simulada: seis cenários aprovados, incluindo resultado já entregue, entrega antiga com API indisponível, entrega antiga ausente verificada, nova entrega pendente, clique incerto e obtenção de resultado já publicado via GET.
- Total até agora: 16 verificações PASS, sem falha.
- O código foi testado em ambiente simulado; o funcionamento real na sessão Chrome do utilizador ainda necessita validação por screenshot e resultado do job.
- Nenhuma sessão local foi alterada ou encerrada. Sem ficheiros de download criados, sem alterar Antigravity, TIMI, BonChat, Maestro ou FiscalGuard.

## 2026-10-30 — Passo 16: Publicação e validação da 15.5.15
- Pull Request #4 criada e integrada na branch main do repositório.
- Commit de integração: 6c0b89a7df6a2c7560a85159245f5d806a6f4209.
- Verificação posterior ao merge: metadados @version e const VERSION indicam 15.5.15; funções de recuperação e confirmação por API presentes.
- Verificado novamente que recoverPendingDelivery não contém POST /run e não reexecuta jobs PowerShell.
- Testes do DOM, backend real do Chrome, sessões de utilizador e screenshots após atualização continuam por realizar. Publicado no GitHub não significa instalado nos separadores.

## 2026-10-30 — Passo 17: Serviço local deixou de aceitar ligações
- Utilizador abriu `http://127.0.0.1:17351/health` no Chrome e obteve `ERR_CONNECTION_REFUSED`.
- O erro confirma recusa da ligação no endereço/porta testado; não comprova qual a causa (serviço parado, falta de listener, filtro ou problema de rede local).
- Diagnóstico sustentado por Microsoft Learn: confirmar que a porta está em estado LISTENING, antes de agir sobre firewall ou instalações.
- A branch main contém o userscript e documentação, mas não fornece um executável/launcher Windows validado para arrancar diretamente daqui.
- Não executar novos jobs, não repetir os três jobs publicados, não reiniciar/encerrar aplicações, não limpar tokens nem tocar no Antigravity.
- Ação de recuperação não destrutiva proposta: usar o atalho da Bridge que já existe no Ambiente de Trabalho (referido no próprio userscript); voltar a verificar o endpoint /health e o estado real dos jobs após o serviço regressar.
- Recuperação local ainda NÃO executada nem confirmada.

## 2026-10-30 — Passo 18: Recuperação solicitada após fecho da janela PowerShell
- O utilizador indicou ter iniciado anteriormente a Bridge por comando PowerShell e que provavelmente fechou a janela.
- Procuradas conversas anteriores pelo comando de arranque exato; não foi encontrado caminho verificável para o serviço local.
- Confirmado na documentação Microsoft que Get-NetTCPConnection identifica listeners e Start-Process inicia programas; não foi recuperado o lançador exato da Bridge.
- Proposta uma recuperação local por PowerShell, sem downloads, com guarda de porta 17351 e pesquisa de lançadores realmente existentes (atalhos ou script .ps1 registado em histórico PSReadLine); só arrancar um candidato único e validado; caso contrário emitir diagnóstico e não executar código desconhecido.
- O script não foi executado no computador do utilizador e não há screenshot local disponível neste momento.

## 2026-10-30 — Passo 19: Screenshot real — job 1128 em HTTP 404 contínuo
- Captura fornecida pelo utilizador mostra o runtime v15.5.15 ATIVA a consultar `PSB-20261030-1128-POKEGUIDE-ASMDEPTH-001` e reportar `HTTP 404. A acompanhar sem reenvio do comando...`.
- Confirma-se diretamente no código 15.5.15 que `monitorActiveJob()` continua a consultar indefinidamente para qualquer resposta HTTP >= 400.
- Consultada a árvore completa e atual da branch pública `runtime` (151 entradas, resultado sem truncagem). A árvore contém resultados PokéGuide ASM626 anteriores, mas não contém o ficheiro com jobId ASMDEPTH-001.
- Um 404 não prova se o trabalho foi ou não executado, nem se a ausência é permanente; referência externa: MDN HTTP 404.
- Hipótese por verificar: o serviço Windows pode ter perdido o registo em memória depois de ter sido reaberto; não há nesta branch o código do daemon para comprovar ou corrigir a persistência do servidor.

## 2026-10-30 — Passo 20: Correção browser isolada 15.5.16
- Criada branch `fix/bridge-missing-job-404-20261030` sem interferir na instalação local.
- Em modo de monitorização, três 404 consecutivos provocam paragem de polling, libertação do estado ativo e preservação de metadados do job na estrutura local `lpxPsb15:unresolved:<conversation>`.
- Em modo de recuperação depois de reload, o primeiro 404 é confirmado por duas leituras GET adicionais antes de registar o job como estado por esclarecer.
- O arquivo guarda identificador, conversa, propósito, estado anterior, código HTTP e data — nunca o comando PowerShell completo nem tokens.
- A resposta HTTP 404 não é interpretada como falha comprovada do comando.
- O job arquivado fica bloqueado contra novas execuções automáticas, incluindo o botão "Executar último"; um novo trabalho deve ter novo jobId apenas depois de diagnóstico.
- O painel volta a apresentar o último job por esclarecer após recarregar a conversa; jobs futuros não são bloqueados por polling eterno.
- Nenhum POST `/run` introduzido na recuperação, nenhum job foi reexecutado e nenhuma sessão ou programa do utilizador foi alterado.

## 2026-10-30 — Passo 21: Validação limitada
- Sintaxe JavaScript validada: PASS.
- Quatro cenários simulados: três 404 em monitorização; três 404 após reload; 404 temporário seguido de resultado publicado; 404 seguido de recuperação transitória durante confirmações. Todos PASS.
- Testes efetuados no código de cliente em ambiente controlado, não no Chrome real do utilizador.
- Screenshot recebido foi inspecionado visualmente. Não foram produzidas capturas novas da instalação local.
- O daemon Windows continua sem auditoria: não prometer persistência de jobs após reinício sem acesso ao seu código e armazenamento.

## 2026-10-30 — Passo 22: Integração e verificação pública
- Pull Request #5 integrada na branch main.
- Commit de integração: 3168364990c633ec6a861082e736795f68abfddd.
- Ficheiro de userscript relido da branch main: `const VERSION = '15.5.16'`, `@version 2026.10.30.15.5.16`, parser JS válido.
- Confirmadas lógica de três 404 consecutivos, arquivo de irresolvidos, impedimento de reexecução pelo botão manual e confirmação de 404 no fluxo de recuperação.
- Código de recuperação não introduz novos POST /run; as consultas de verificação são GET.
- Sem confirmação end-to-end no Chrome do utilizador nem acesso ao código do serviço Windows: a causa permanente de perda de jobs no daemon continua por investigar.

## 2026-10-30 — Passo 23: Três janelas visíveis, só uma com foco
- Utilizador informou que três janelas Chrome separadas estão simultaneamente visíveis, mas os trabalhos parecem iniciar-se apenas depois de dar foco à respetiva janela.
- Comparada documentação oficial Chrome for Developers (timer throttling Chrome 88, background tabs) e MDN Page Visibility API / Document.hasFocus.
- Factos confirmados: `hasFocus()` e `document.hidden` têm significado distinto; uma janela visível pode estar sem foco. Temporizadores JavaScript podem sofrer throttling em páginas ocultas; não é garantida execução no instante nominal.
- Inspecionada v15.5.16: `focus` acionava explicitamente `installObserver`, `scheduleCandidate` e `scheduleDeliveryRecovery`; observador original fixava-se em `main` e podia ficar obsoleto quando a aplicação SPA o substituía.
- Nenhum dado de telemetria local prova ainda quanto da latência real se deve ao Chrome e quanto se deve à substituição do DOM.

## 2026-10-30 — Passo 24: Correção isolada de independência de foco (15.5.17)
- Criada branch `fix/bridge-no-focus-heartbeat-20261030`.
- O observador acompanha agora `document.body`, elemento mais estável durante substituição de `main` pelo React.
- Acrescentado `backgroundHeartbeat` a cada 7 segundos quando a página é visível e a cada 18 segundos se estiver oculta, sujeito aos limites do próprio Chrome, independentemente de `focus` ou `scroll`.
- O heartbeat revalida o observador, verifica a resposta mais recente, respeita estados ocupado/geração e retoma apenas a recuperação de entrega em `inflight` sem ressubmeter PowerShell.
- Reforçado rearme após navegação SPA, arranque inicial, e ativação da Bridge.
- Os temporizadores de recuperação/sondagem são marcados livres quando disparam, permitindo retoma posterior.
- Sem alterações ao servidor local, permissões Chrome, perfil, Antigravity, Maestro, TIMI, BonChat ou backups.

## 2026-10-30 — Passo 25: Verificação técnica
- Sintaxe JS validada sem erros.
- Dez testes simulados PASS: observer ligado ao body mesmo com main existente, apenas um observer, sondagem sem foco, sondagem com documento oculto, estado inflight sem reexecução, job ativo não revisitado, Bridge desligada sem timer, cadência visível, cadência oculta, resposta em streaming não examinada.
- Limitação explícita: tempos nominais não são SLA de processamento, o Chrome pode suspender/limitar timers em páginas ocultas.
- Ainda falta screenshot e ensaio end-to-end das três janelas Chrome reais; a entrega via editor ProseMirror em janela sem foco não foi comprovada.

## 2026-10-30 — Passo 26: Publicação e verificação da 15.5.17
- PR #6 integrada em main, commit b3e00ca0e38fb6a4ec95af1cbb34bb99698f5248.
- Relido userscript na branch main: @version=2026.10.30.15.5.17 e VERSION=15.5.17.
- Confirmados body observer, heartbeat independente do foco e arranque automático da verificação.
- Verificação sintática JavaScript: PASS.
- Não se realizou prova no Chrome do utilizador; particularmente, envio via editor do ChatGPT em janela sem foco continua sem confirmação end-to-end.

## 2026-10-30 — Passo 27: Screenshot real mostra resultados presos no compositor
- Captura mostra v15.5.17 ATIVA, job `PSB-20261030-1404-FISCALGUARD-IUC-DOCUMENTOS-009` com aviso `A caixa contém outra mensagem; não foi substituída`.
- O compositor já contém uma mensagem `PSBRIDGE_RESULT_V2` do mesmo job, com `status: SUCCEEDED`, `exitCode: 0`, URLs `result` e `log`. Não havia confirmação de submissão ao ChatGPT.
- O utilizador confirma a existência de várias mensagens de resultado em espera e que o processamento das conversas fica bloqueado sem o envio.
- O ficheiro JSON público do job FiscalGuard 009 foi consultado: `succeeded`, `exitCode=0`, `elapsedMs=364`, `outputLength=0`. Isto não comprova leitura real de documentos AT ou importação DPAPI.
- Causa demonstrada no código v15.5.17: `sendMessage` exige texto do editor idêntico ao texto do resultado após normalização limitada; editores ricos podem incluir quebras duplas, espaços especiais ou ícones de links; isso rejeita incorretamente uma mensagem preparada que é do próprio job.

## 2026-10-30 — Passo 28: Correção isolada v15.5.18
- Criada branch `fix/bridge-same-job-draft-20261030`, sem alterar runtime local.
- Normalização Unicode NFC, espaços Unicode, quebras de linha e ícones de links exclusivamente nos campos result/log.
- Reconhecimento de mensagem preparada exige cabeçalho, identificador exato, estado, exitCode, URLs e instrução equivalentes. Qualquer diferença de job, URL, estado, instrução ou texto extra é rejeitada.
- Rascunhos privados do utilizador nunca são substituídos; resultado de outro job também não.
- Se botão estiver associado a form como submit, prefere `form.requestSubmit(button)`, caso contrário usa um único `button.click()`; nunca executa os dois na mesma tentativa.
- Mantém registo persistente do número de tentativas, restrição temporal, confirmação por consulta da conversa autenticada e proteção contra reenvios cegos.
- Se o resultado continuar visível na caixa após a tentativa, o estado distingue `resultado preparado mas envio por confirmar`, sem declarar entrega.
- Sem apagar dados de perfis, sessões, cookies, tokens e backups. Sem reinícios, downloads ou execução de comandos PowerShell na máquina do utilizador.

## 2026-10-30 — Passo 29: Testes isolados e limites
- Sintaxe JavaScript: PASS.
- Treze testes de identidade e formatação de resultados: 13 PASS.
- Onze testes simulados de envio: form submit para resultado preparado, botão React, rascunho privado, conteúdo alterado, já entregue, caixa vazia, botão desativado, repetição após período de segurança, limite de tempo, limite de tentativas e resultado que continua em caixa — 11 PASS.
- Documentação MDN verificada: requestSubmit gera validação e submit event; submit() direto não é equivalente. A API execCommand de edição está descontinuada e pode não disparar eventos de input consistentemente.
- Ausência de teste end-to-end no Chrome real; o código não prova que o ChatGPT aceite eventos de envio sintéticos nem garante entrega com janelas sem foco. Requer screenshots do resultado após atualização.

## 2026-10-30 — Passo 30: Publicação da correção de resultados em espera
- PR #7 integrada em main; commit de merge `90898c7ad386d39b599165ad41859384767ef6b0`.
- Verificada na branch main a versão `15.5.18` (metadados e código), sintaxe JavaScript PASS.
- Confirmadas funções `samePreparedResultDraft`, `requestSubmit(button)` para botão submit real e atualização persistente de deliveryClicks antes de cada tentativa.
- Não ocorreu qualquer atualização do Tampermonkey nem envio real no Chrome do utilizador nesta etapa; somente publicação GitHub. O problema end-to-end continua por validar por screenshot e evidência de nova mensagem em histórico.

## 2026-10-30 — Passo 31: Recuperação de rascunhos anteriores já no limite de tentativas
- Depois da publicação 15.5.18, foi identificado que resultados pendentes da 15.5.17 podiam já ter dois `deliveryClicks`, impedindo qualquer recuperação mesmo com texto do próprio job na caixa.
- Criada branch `fix/bridge-legacy-stuck-draft-rescue-20261030`.
- Candidata 15.5.19: uma única recuperação de rascunho legado acima do limite, sujeita em simultâneo a duas tentativas prévias, ausência de entrega confirmada pela API autenticada, editor com envelope integral do mesmo job, intervalo mínimo de 60 segundos, e inexistência de resgate anterior.
- Permissão de resgate marcada por versão em `deliveryRescueAuthorized`; o envio valida esta marca, regista o terceiro clique antes da ação e grava `deliveryRescueUsedVersion` para não repetir após refresh.
- API indisponível, rascunho diferente, tentativa recente ou resgate já usado impedem reenviar. Nenhum POST /run ou PowerShell executado por esta correção.
- Simulação de `sendMessage`: seis cenários PASS (resgate autorizado, sem permissão, já consumido, recente, texto alterado, tentativa ainda não entregue).
- Simulação de `recoverPendingDelivery`: quatro cenários PASS (autorização segura, API indisponível, rascunho distinto, intervalo não cumprido).
- Sintaxe JavaScript PASS. Não foi realizado teste end-to-end no Chrome local.

## 2026-10-30 — Passo 32: Integração e verificação final da correção de entrega
- PR #8 integrada na branch main; commit de integração c2dd12f4c78a3cedec9eb2f20877d89738854334.
- Ficheiro de userscript relido em main: versão 15.5.19 no código e metadados, sintaxe JavaScript PASS.
- Confirmadas no código as funções de identidade de resultados, resgate único de legacy drafts, marcação persistente antes do envio e `requestSubmit(button)` para botões submit reais.
- Vários resultados já em espera nas caixas do utilizador ainda precisam de entrega real comprovada na conversa; a atualização no GitHub não efetua a submissão do Chrome.
- O teste de aceitação requer a mensagem PSBRIDGE_RESULT_V2 passar para uma mensagem de utilizador no histórico, com o mesmo jobId, sem nova execução PowerShell.


## 2026-10-30 — Passo 33: Evidência de entrega confirmada, mas estado pendente na Bridge 15.5.22
- Evidência fornecida pelo utilizador para `PSB-20261030-1515-POKEGUIDE-ROM0RETRY-002`: sessão HTTP 200; conversa HTTP 200; resultado presente na API e no ramo atual (`true`); distância de 12 mensagens; formato exato reconhecido.
- O limite de leitura de 160 mensagens não explica este caso.
- Screenshot também mostra `PSB-20261030-1541-TIMI-PROVAS-V2-050` numa segunda conversa a verificar tentativa de entrega anterior; **não** existe ainda prova por API de que este segundo resultado foi recebido.
- Origem local instalada v15.5.22 permanece desconhecida; no repositório público só foi identificada a base 15.5.19. Não substituir o runtime do utilizador nem anunciar uma atualização instalada.

## 2026-10-30 — Passo 34: Correção de reconciliação ACK isolada na base pública
- Branch `fix/bridge-ack-existing-results-20261030` criada sem alterar `main` nem o Tampermonkey instalado.
- Inserida a rotina `acknowledgeDeliveredResult`: consulta a entrega na conversa atual antes de avaliar limites de tentativas ou solicitar o resultado ao daemon; só assinala tratado, liberta o estado inflight e a reserva do job perante confirmação positiva.
- Recuperação com mensagem ausente passa a consultar a API primeiro; isto permite recuperar entregas comprovadas mesmo quando o daemon já não conserva o resultado.
- Resultado não confirmado (falha de API, ausência no ramo atual) mantém a recuperação conservadora e nunca origina novo POST `/run`.
- Corrigida confirmação enganadora por texto vazio no DOM: `userTurnContains` rejeita texto vazio e `checkResultDelivered` só consulta o DOM quando o corpo da mensagem existe.
- Testes prévios à publicação: sintaxe JavaScript PASS; cenário de ACK confirmado PASS; ausência de ACK sem mutações PASS.
- Commit de código: `c74af6f7bcabd018202fbc230b81910e4074b5ac`; o `@version` continua 15.5.19 para evitar promover a base antiga acima da 15.5.22 instalada.
- **Pendente**: obter o código efetivamente instalado da 15.5.22, integrar a alteração sem perder as funções mais recentes e provar o desbloqueio real no Chrome do utilizador.

## 2026-10-30 — Passo 35: Testes isolados da reconciliação de entrega
- Ficheiro JS completo da branch compilável por `new Function`: PASS (sintaxe).
- Simulador da recuperação: resultado já presente na conversa, 99 tentativas registadas e ausência de texto local: ACK aplicado imediatamente, sem consulta ao daemon e sem reenvio: PASS.
- Simulador da recuperação: confirmação negativa e GET local HTTP 503: estado persistido, sem reenvio, recuperações posteriores permitidas: PASS.
- Parser com resultado na cadeia atual à distância de 12 mensagens: identifica jobId exato, rejeita jobId diferente: PASS.
- Simulação inicial teve duas falhas no teste (omissão de `BRIDGE_URL` no ambiente de mocking e expectativa de uma expressão textual incorreta); corrigido o **simulador**, não o código de produção. Todos os testes finais PASS.
- Limites: testes simulados, não confirmam comportamento da v15.5.22 instalada nem sucesso real em janelas Chrome; nenhuma sessão, job ou perfil alterado.

## 2026-10-30 — Passo 36: Integração em main e releitura
- PR #9 integrada no ramo `main`, commit de merge `2e793ec9b5c533f55698e5cba72f7578eb032f3b`.
- Relido o ficheiro JS em `main`: blob `bb7754d19b6423cc1843100d4151fa09ccac06ba`; rotina `acknowledgeDeliveredResult` presente; reconciliação antecipada presente; proteção contra texto vazio presente; sintaxe PASS.
- Metadados `@version`/const VERSION mantidos em 15.5.19 porque a máquina do utilizador tem v15.5.22; **não** se deve anunciar uma nova versão ou sobrescrever uma versão instalada que não foi obtida e comparada.
- Integração pública concluída. Aplicação na 15.5.22, teste de entrega end-to-end e screenshots reais permanecem pendentes.

## 2026-10-30 — Passo 37: Plano de aplicação aditiva na instalação 15.5.22 sem downgrade
- Reconsultado o ficheiro `tampermonkey/chatgpt-powershell-bridge-v15-lite.user.js` e a lista de branches do repositório. `main` contém a correção ACK mas a versão continua 15.5.19. A versão local 15.5.22 permanece indisponível na fonte pública.
- Consulta do contexto de conversas anteriores e ficheiros da Library: não foi encontrada cópia verificável do código instalado 15.5.22.
- Verificada a documentação oficial Tampermonkey: o editor incorporado usa CodeMirror; a página do editor permite consultar o código instalado. Preparado método de patch aditivo no editor, que só atua se confirmar `@version=2026.10.30.15.5.22`, `VERSION=15.5.22` e todas as âncoras exatas; interrompe sem alterações perante divergências.
- O método injeta reconciliação por API autenticada no início da recuperação, antes dos limites de tentativas, e só aplica ACK depois de confirmar `PSBRIDGE_RESULT_V2` e jobId no ramo atual. Não faz POST /run, não fecha browser, não altera perfis ou tokens, e prepara alterações no editor sem guardar automaticamente.
- Testes locais com editor CodeMirror simulado: fonte 15.5.22 e âncoras compatíveis -> versão 15.5.23 preparada, compilação JS PASS, cópia original preservada em memória; versão 15.5.21 -> nenhuma alteração; âncora inesperada -> nenhuma alteração. Resultado real no navegador ainda não comprovado.
- Nenhum ficheiro foi instalado na máquina do utilizador nem ocorreu gravação automática no Tampermonkey. A execução local exige abrir o editor do script, executar o patch na consola do Chrome e guardar explicitamente depois das validações.

## 2026-10-30 — Passo 38: Recebida a fonte original instalada da Bridge v15.5.22
- Recebido ficheiro de 7510 linhas identificado como `@version 2026.10.30.15.5.22` e `const VERSION = '15.5.22'`, com URLs de atualização do repositório oficial do utilizador.
- Inspeção do código: v15.5.22 tem `API_BUDGET_KEY`, intervalo mínimo entre leituras de conversa, validação de recibos do job, `resumeAutonomy` e proteções do compositor. Essas funcionalidades não podem perder-se num downgrade para a base pública 15.5.19.
- Foram preservados todos os códigos de sessão, armazenamento, runtime local, protocolo e URLs de instalação originais; não foi executado nenhum PowerShell, nem alterada a instalação do navegador.

## 2026-10-30 — Passo 39: Versão 15.5.23 construída a partir do original
- Atualizados `@version` e `VERSION` para 15.5.23 sobre a fonte de 15.5.22, sem utilizar como base a 15.5.19 pública.
- A recuperação de entrega chama `checkResultDelivered` antecipadamente se existir mensagem, tentativas antigas ou fase de publicação, antes do GET local ou de qualquer limite de reenvio. ACK confirmado liberta `handled`, `inflight` e `claim`; não emite POST /run.
- A API recebe apenas leitura autenticada, e compara um recibo `PSBRIDGE_RESULT_V2` válido do utilizador no ramo atual com o `jobId` exato. Se os outros campos divergirem, não duplica um resultado já existente do mesmo job; expõe `receiptMismatch` para diagnóstico.
- Nenhuma entrega pode ser confirmada por texto vazio no DOM.
- Quando a consulta está temporariamente indisponível (incluindo HTTP 429 do limitador), o estado permanece guardado e é agendada nova verificação; nenhuma tentativa de envio é consumida.
- Testes isolados em Node 22: `node --check` PASS; recibo correto/errado, role indevida e vazio no DOM PASS; API HTTP 200 com diferença no recibo PASS; API HTTP 429 PASS; resultado existente com 99 tentativas PASS sem reenvio nem leitura do daemon; recuperação em 429 PASS sem reenvio.
- Atualização publicada inicialmente na branch `fix/bridge-v15-5-23-from-installed-20261030`. Ficheiro relido no GitHub: versão 15.5.23, sintaxe PASS e alterações de ACK presentes.
- Limitação: testes foram simulados; não houve acesso à instalação local do Chrome, screenshot após a atualização, nem confirmação end-to-end na máquina do utilizador.

## 2026-10-30 — Passo 40: Integração e verificação de publicação v15.5.23
- PR #10 integrada em `main`, commit de merge `28cb6cb18935851e315ef225a73b46e43611c144`.
- Relida a versão principal no GitHub: `@version 2026.10.30.15.5.23` e `VERSION = '15.5.23'`; blob publicado `58ab8e4d32ec7deac4b1cb54443617e98be3a2af`.
- Confirmadas no ficheiro publicado: reconciliação antecipada, bloqueio de envios em API indisponível, controlo de orçamento de API partilhado, método `button_click` e `resumeAutonomy` da v15.5.22. Compilação sintática JavaScript: PASS.
- Link direto de instalação/atualização: `https://raw.githubusercontent.com/ApexScorpio/lpx-powershell-runtime/main/tampermonkey/chatgpt-powershell-bridge-v15-lite.user.js`.
- Instalação e execução no Chrome do utilizador NÃO comprovadas; evitar concluir que os estados de jobs foram limpos até inspeção visual e leitura da versão do runtime no separador.

## 2026-10-30 — Passo 41: Screenshot real de três janelas na v15.5.23
- Screenshot recebido e analisado: três janelas Chrome visíveis com Bridge `v15.5.23 · ATIVA`.
- PokéGuide: job `PSB-20261030-1515-POKEGUIDE-ROM0RETRY-002`, estado `API_HTTP_429`, resultado preservado.
- TIMI: job `PSB-20261030-1541-TIMI-PROVAS-V2-050`, estado `API_HTTP_429`, resultado preservado.
- FiscalGuard: job `PSB-20261030-1544-FISCALGUARD-LOGIN-IUC-016`, estado `API_HTTP_429`, resultado preservado, com erro de carregamento da própria conversa do ChatGPT visível por trás do painel.
- Inspeção da fonte publicada 15.5.23: `chatgptApiFetch` fabrica localmente `new Response('{}',{status:429})` quando o budget partilhado de 10s ainda não expirou. A UI não distingue isto de um HTTP 429 real da API; logo, o print **não comprova** 429 de origem remota. A falha de carregamento do ChatGPT é independente até haver prova em contrário.
- Foram detetados caminhos de entrega em `monitorActiveJob` e `sendMessage` que ainda podiam avançar para o clique sem confirmação de API disponível; a correção deve impedir esse risco.

## 2026-10-30 — Passo 42: Construção isolada da v15.5.24
- Criada branch `fix/bridge-15-5-24-rate-gate-ack-20261030` sobre o `main` com v15.5.23, que derivou da fonte real 15.5.22 do utilizador.
- `@version` e `VERSION` elevadas para 15.5.24. Sem alterações de perfis, tokens, sessões, daemon, Antigravity, TIMI, Maestro, BonChat ou outros programas.
- Um 429 sintetizado por controlo local recebe cabeçalho `X-LPX-Bridge-Cooldown: local`; a verificação passa a devolver `PAUSA_LOCAL_PARTILHADA` e duração até nova tentativa. Um 429 HTTP real continua classificado `API_HTTP_429` e respeita `Retry-After` / budget.
- Introduzido `apiRetryDelay` com desfasamento estável por conversa para evitar que três abas retomem leituras simultaneamente, além do orçamento de acesso já partilhado; não força qualquer chamada à API durante a pausa.
- `recoverPendingDelivery`, `monitorActiveJob` e `sendMessage` preservam resultados se `apiOk=false`, sem POST /run ou cliques de envio; `runApiProbe` adapta a pausa ao orçamento partilhado.
- `apiContainsResult` aceita recibo válido com links Markdown ou diretos, exigindo simultaneamente role `user`, cabeçalho `PSBRIDGE_RESULT_V2`, jobId em linha exata, status, exitCode, result e log; rejeita conteúdo de assistente, exemplos citados e recibos incompletos.
- O histórico e os estados dos jobs já existentes não são eliminados.

## 2026-10-30 — Passo 43: Testes isolados v15.5.24
- Sintaxe JavaScript completa: PASS.
- Recibo Markdown no ramo atual com jobId exato: PASS. JobId diferente, role assistente, exemplo citado e recibo incompleto: todos rejeitados (PASS).
- Resposta 429 local com cabeçalho diferenciador: `PAUSA_LOCAL_PARTILHADA`, sem afirmar erro do ChatGPT (PASS).
- Resposta 429 real com `Retry-After=120`: backoff ~120s respeitado (PASS).
- Resposta 200 contendo recibo válido em Markdown: ACK confirmado (PASS).
- Estado pendente com 99 clicks pré-registados: não reenviado nem daemon consultado enquanto API em pausa, retry agendado (PASS).
- `monitorActiveJob` com publicação concluída e API indisponível: nem `sendMessage` nem `markHandled` / `clearInflight`; retry planeado (PASS).
- `sendMessage` com API 429: rejeita antes de procurar editor ou clicar, preservando estado (PASS).
- Simulador intermédio precisou de definição adicional de `VERSION` no contexto de teste; após correção do teste, cenários finais PASS. Não houve correção da produção por esse erro de mocking.
- Testes não substituem prova end-to-end em três janelas após instalação; não foi possível tirar screenshot remoto da instalação real. Screenshot do utilizador é a evidência visual inicial.

## 2026-10-30 — Passo 44: Publicação da 15.5.24 e releitura final
- PR #11 integrada em `main`, commit de merge `d6392501bbf764d5802c4ad9529f08b9e389ce13`.
- Código relido de `main`: `@version 2026.10.30.15.5.24`, `VERSION=15.5.24`, blob `0d71c7b9359cba4dee56f43b661e99037e351f88`.
- Verificados na publicação: cabeçalho de pausa local, retentativas desfasadas, envio bloqueado sem confirmação, reconhecimento de recibos Markdown, sintaxe JS PASS.
- Link de atualização Tampermonkey: `https://raw.githubusercontent.com/ApexScorpio/lpx-powershell-runtime/main/tampermonkey/chatgpt-powershell-bridge-v15-lite.user.js`.
- Não executar `Executar último` nem `Cancelar` nos três jobs pendentes. Confirmar versão 15.5.24 após atualização e recarregamento controlado da página quando não houver jobs ativos. Tokens, cookies, armazenamento de perfis e backups não foram modificados por esta alteração do repositório.
- Continua por provar em produção: as três entregas, resposta da API real após o período de limitação e o erro de carregamento da terceira conversa. Não afirmar que os jobs foram desbloqueados localmente até existirem evidências.

## 2026-10-30 — Passo 45: Nova captura da v15.5.24 com três janelas
- Screenshot do utilizador recebido e analisado: as três Bridges apresentam `v15.5.24 · ATIVA`.
- PokéGuide `PSB-20261030-1515-POKEGUIDE-ROM0RETRY-002`: `PAUSA_LOCAL_PARTILHADA`, resultado preservado, nova consulta agendada.
- TIMI `PSB-20261030-1541-TIMI-PROVAS-V2-050`: `PAUSA_LOCAL_PARTILHADA`, resultado preservado, nova consulta agendada.
- FiscalGuard `PSB-20261030-1544-FISCALGUARD-LOGIN-IUC-016`: `API_HTTP_429` na interface, resultado preservado e nova consulta agendada. Pela implementação v15.5.24, esta classificação indica resposta 429 não sintetizada pela pausa local, sem provar o mecanismo exato do limite do servidor.
- Ainda não existe evidência de que o tempo de backoff terminou nem de que as três entregas foram confirmadas. Não confundir o estado de pausa com bloqueio definitivo.
- Fonte externa consultada: MDN Web Locks API (serialização entre separadores da mesma origem, `navigator.locks.request`); MDN HTTP 429 e `Retry-After` (obrigação de não repetir pedidos prematuramente).
- Falha observável no código: a reserva do orçamento utiliza `GM_getValue` seguida de `GM_setValue` sem exclusão mútua, permitindo que várias janelas façam a reserva simultaneamente.

## 2026-10-30 — Passo 46: Correção de concorrência isolada v15.5.25
- Branch `fix/bridge-v15-5-25-cross-tab-api-lock-20261030` criada a partir do `main` com v15.5.24, que preserva a base real v15.5.22 enviada pelo utilizador.
- `@version` e `VERSION` alterados para 15.5.25. Função `chatgptApiFetch` passou a serializar os pedidos GET da conversa pela Web Locks API com lock exclusivo `lpx-psb15-chatgpt-conversation-read`, cobrindo a leitura/reserva do orçamento, a consulta e atualização do backoff.
- A coordenação exclusiva opera entre os separadores na mesma origem e contexto do browser, conforme MDN; se `navigator.locks.request` não estiver disponível, conserva-se o comportamento anterior com orçamento partilhado e backoff. Não se promete coordenação forte nesse fallback.
- Preservados controlos de 429 local/real, período `Retry-After`, estados pendentes, proteções de não-reexecução, autenticação, dados e sessões existentes. Nenhuma operação de reinício, limpeza, POST /run ou alteração da máquina do utilizador.

## 2026-10-30 — Passo 47: Testes simulados da v15.5.25
- Ficheiro JavaScript completo validado sintaticamente: PASS.
- Três pedidos simultâneos ao mesmo endpoint no simulador: três tentativas de lock, máximo uma secção crítica simultânea e apenas uma consulta HTTP; duas pausas locais produzidas: PASS.
- HTTP 429 remoto seguido de pedido concorrente: apenas uma consulta HTTP remota; segundo pedido limitado localmente e backoff partilhado, sem repetição: PASS.
- Exceção de rede: erro propagado e lock libertado: PASS.
- Ausência da Web Locks API: fallback anterior preservado: PASS.
- Estes resultados são simulações numa sandbox JavaScript, não um ensaio end-to-end com três janelas Chrome nem prova de desbloqueio dos três jobs. Captura visual inicial inspecionada; captura pós-atualização ainda pendente.

## 2026-10-30 — Passo 48: Integração e verificação pública v15.5.25
- PR #12 integrada em `main`; commit de merge `340cbd1a107a407fe0cb7bc1d1873f7aea25d18a`.
- Relido o userscript na origem após merge: `@version 2026.10.30.15.5.25`, `VERSION='15.5.25'`, blob `2046370b37e18653e8b4572ef04b082d72e34b3e`.
- Código de exclusão mútua `navigator.locks.request` presente; `Retry-After`/backoff preservados; sintaxe JS PASS.
- Link de atualização: `https://raw.githubusercontent.com/ApexScorpio/lpx-powershell-runtime/main/tampermonkey/chatgpt-powershell-bridge-v15-lite.user.js`.
- Atualização do repositório não implica instalação ou alteração dos separadores Chrome: ainda falta confirmação visual do runtime 15.5.25 e dos resultados dos três jobs.
- O HTTP 429 real exige respeitar `Retry-After` ou backoff registado; nenhuma correção pode garantir que o servidor responda 200 antes do limite terminar.
- Recomendar atualização pelo Tampermonkey e recarregamento controlado apenas quando não houver jobs locais ativos. Nunca usar `Executar último` para recuperar a entrega. Nenhuma sessão/token/perfil/browser/processo foi alterado por esta publicação GitHub.

## 2026-10-30 — Passo 49: Captura de v15.5.25 com resultado ROM0FIX-004 pendente
- Captura real fornecida pelo utilizador: painel `PowerShell Bridge v15.5.25 · ATIVA`, `PSB-20261030-1630-POKEGUIDE-ROM0FIX-004` com aviso `PAUSA_LOCAL_PARTILHADA`, resultado preservado, sem envio. Não existe nessa imagem prova de entrega ao ChatGPT, nem de bloqueio irreversível.
- Consultado o ramo GitHub `runtime`: ficheiros JSON e TXT do job estão presentes sob `runtime/d576e00447c8d0d1/`.
- O JSON confirma `status=succeeded`, `exitCode=0`, início 17:14:04 UTC e conclusão 17:14:24 UTC, relatório com `outputLength=8984`.
- O TXT confirma `CORRECAO_ROM0=CONFIRMADA`, `ASM_TARGETED_PASS=70`, `FULL_SUITE_PASS=676`, `FULL_SUITE_SKIPPED=1`, `CERTIFICACAO=APROVADA`. Isso não equivale a mapeamento integral sem lacunas: relatório mantém `ROM_RED_ROM0_EFFECTS_STILL_UNKNOWN=537` e equivalentes Blue/Green, `semanticallyCertified=0`.
- Problema atual separado: a confirmação da entrega na conversa ainda não está demonstrada. Jamais reexecutar o job para reparar uma entrega pendente.

## 2026-10-30 — Passo 50: Análise do desperdício de orçamento API
- Inspecionada a fonte publicada da v15.5.25. `runApiProbe` e `armApiProbe` continuavam a consultar a conversa para procurar novos jobs mesmo depois da existência de um `getInflight()` com entrega anterior por confirmar.
- `recoverPendingDelivery` usa o mesmo limite de consultas para verificar entregas. As sondagens redundantes podiam competir pela reserva partilhada de API, aumentando a duração da pausa local sem contribuir para resolver a entrega.
- Trata-se de risco de concorrência verificável pelo código, não prova de que seja a única causa das pausas vistas no Chrome.

## 2026-10-30 — Passo 51: v15.5.26 — prioridade à entrega pendente
- Criada a branch `fix/bridge-v15-5-26-prioritize-pending-ack-20261030` com base na v15.5.25 pública; atualizados `@version` e `VERSION` para 15.5.26.
- `armApiProbe` não inicia novas pesquisas quando existe `getInflight()` na conversa.
- `runApiProbe` encerra uma pesquisa existente ao encontrar um resultado pendente antes da consulta, ou no `finally` se o estado ficou pendente enquanto a consulta decorria.
- Após `saveInflight(...,'submitting')`, `processJobManifest` encerra a sonda para evitar consumir a API durante o acompanhamento do job.
- A recuperação de entrega e os mecanismos de proteção anti-reexecução permanecem inalterados. Nenhum `POST /run` adicionado; nenhuma alteração nas sessões, cookies, tokens ou perfis.

## 2026-10-30 — Passo 52: Validação isolada v15.5.26
- Sintaxe de todo o JavaScript: PASS.
- `armApiProbe` com `getInflight()` preenchido não agenda API; após libertação do estado, um novo evento pode armá-la: PASS.
- `runApiProbe` com job pendente fecha a sonda antes de qualquer leitura autenticada: PASS.
- Race condition simulada: `getInflight` torna-se preenchido durante a chamada de API; `finally` encerra a sonda e não agenda outra: PASS.
- Testes isolados; NÃO comprova ainda a conclusão de entrega real em qualquer janela Chrome.

## 2026-10-30 — Passo 53: Publicação verificada de v15.5.26
- PR #13 integrada em `main`, commit `1f63fb8e3e4b7eb919bb694feab3736457153555`.
- Ficheiro do userscript relido no repositório público: `@version 2026.10.30.15.5.26`, `VERSION=15.5.26`, blob `bbd0fb6686874182cfe3db0763323d364a58e16e`.
- Confirmadas presença das guardas de sondagem em entrega pendente, exclusão mútua via Web Locks da v15.5.25, e análise sintática JS completa PASS.
- Link de atualização: `https://raw.githubusercontent.com/ApexScorpio/lpx-powershell-runtime/main/tampermonkey/chatgpt-powershell-bridge-v15-lite.user.js`.
- O utilizador ainda tem de instalar/ativar esta versão no Tampermonkey. Não há confirmação visual nem end-to-end da entrega ao ChatGPT do resultado ROM0FIX-004; no GitHub está efetivamente publicado e a execução terminou com exitCode=0. Nenhum token, sessão ou perfil local foi alterado por esta publicação.

## 2026-10-30 — Passo 54: Correção das confirmações redundantes
- A análise da v15.5.26 identificou duas consultas consecutivas de confirmação do mesmo resultado: uma na recuperação e outra na função de envio.
- Implementada a reutilização de uma confirmação recente e vinculada ao job e à conversa na nova versão 15.5.27.
- A coordenação de consultas entre janelas passou a usar uma fila FIFO, separada da execução dos jobs.
- Testes isolados: quatro rondas A-B-C-A, envio com confirmação reutilizada sem segunda chamada, casos sem confirmação e resposta incompleta preservam a segurança.
- Testes de sintaxe aprovados. Falta validação real no Chrome após instalação.

## 2026-10-30 — Passo 55: Captura real da v15.5.27
- O utilizador enviou um screenshot com PowerShell Bridge v15.5.27 ATIVA e o job PSB-20261030-1630-POKEGUIDE-ROM0FIX-004 em AGUARDA_FILA_API_3_DE_3.
- A mensagem demonstra bloqueio no controlo LOCAL de acesso à API, não erro HTTP 429 remoto, nem falha na execução do PowerShell. O job já tinha SUCCEEDED e exitCode 0 confirmados por ficheiros do GitHub.
- A fila FIFO global da 15.5.27 misturava tráfego de conversas diferentes. Uma entrada antiga na cabeça podia impedir o terceiro participante de consultar, até expirar ou o primeiro participar novamente. A prioridade global contrariava a independência entre PokéGuide, TIMI e FiscalGuard.
- O ramo da 15.5.27 já contém a correção da dupla consulta de ACK; PR #14 permaneceu por integrar em main após bloqueio da ferramenta de merge.

## 2026-10-30 — Passo 56: v15.5.28, filas separadas por conversa
- Criada a branch fix/bridge-v15-5-28-independent-api-lanes-20261030 sobre a fonte completa da 15.5.27, originalmente derivada da 15.5.22 do utilizador.
- As reservas locais da API deixam de usar fila global: cada conversa recebe chave API_LANE_PREFIX independente e bloqueio Web Locks específico do respetivo identificador. Conversas distintas podem consultar em paralelo; duas abas da mesma conversa mantêm exclusão mútua.
- Apenas o HTTP 429 verdadeiro desencadeia pausa PARTILHADA, com Retry-After respeitado e atualização serializada. Histórico de backoff REAL legado é respeitado se failures > 0; filas antigas não são apagadas, mas deixam de bloquear.
- A API local passa a reportar PAUSA_LOCAL_DESTA_CONVERSA ou LIMITE_REAL_SERVIDOR_PARTILHADO; eliminação do motivo AGUARDA_FILA_API_n_DE_m de operações novas.
- Mantidos íntegros os estados de jobs, credenciais, sessões, perfis, backups, autenticação, links e proibição de reexecução. Nenhum processo local foi encerrado; nenhum job foi lançado.

## 2026-10-30 — Passo 57: Testes isolados
- Sintaxe do userscript completo: PASS.
- Três conversas diferentes em paralelo com entradas antigas de fila global: 3/3 chamadas HTTP permitidas, máximo de 3 simultâneas: PASS.
- Duas abas da mesma conversa: uma chamada HTTP e uma pausa local: PASS.
- Resposta HTTP 429 real, Retry-After 120s: segunda conversa impedida de consultar, pausa global respeitada: PASS.
- Backoff real da versão anterior preservado; orçamento artificial antigo sem falhas ignorado: PASS.
- Não foi testado ainda o comportamento nas três janelas reais após atualização, nem a entrega do resultado ROM0FIX-004.

## 2026-10-30 — Passo 58: Integração e verificação da v15.5.28
- PR #15 integrada em main no commit d68d3c682a8687335e91938198626512f11313e6.
- Releitura independente do userscript publicado: VERSION 15.5.28, @version 2026.10.30.15.5.28, blob 5d1d7dc563a34db1a7ee5b2d98df91f313c2fa83; sintaxe JavaScript PASS.
- Confirmada a ausência da mensagem AGUARDA_FILA_API e da função de fila global antiga. Confirmadas as chaves de leitura por conversa, o bloqueio Web Locks por conversa e o controlo separado de HTTP 429 remoto.
- Link de instalação atualizado no ramo principal: https://raw.githubusercontent.com/ApexScorpio/lpx-powershell-runtime/main/tampermonkey/chatgpt-powershell-bridge-v15-lite.user.js
- A instalação efetiva no Chrome e o desbloqueio da entrega de ROM0FIX-004 continuam sem comprovação visual. O resultado do job está publicado no GitHub. Não repetir execução ou eliminar estado pendente para desbloquear.

## 2026-10-30 — Passo 59: Screenshot das três conversas ativas na v15.5.28
- Captura real recebida: as três janelas apresentam PowerShell Bridge v15.5.28 ATIVA.
- PokéGuide mostra `PSB-20261030-1900-POKEGUIDE-WORLDFLAGS-009` com entrega preservada e `LIMITE_REAL_SERVIDOR_PARTILHADO`.
- TIMI mostra `PSB-20261030-1541-TIMI-PROVAS-V2-050` com confirmação da API pendente no mesmo estado.
- FiscalGuard mostra `PSB-20261030-1839-FISCALGUARD-AT-019` em execução, 31 segundos no momento da captura. Isto demonstra que a execução local de pelo menos uma conversa continuava, mas NÃO prova que as outras estavam impedidas de executar por causa dela: aguardavam entrega/confirmacao.
- Consultado `runtime` no GitHub: `POKEGUIDE-WORLDFLAGS-009` terminou com status failed/exitCode 1 às 18:41:01 UTC e foi publicado; `TIMI-PROVAS-V2-050` terminou succeeded/exitCode 0 às 15:44:29 UTC e foi publicado.
- Fonte v15.5.28 inspecionada: `apiRemoteWaitMs` consulta um estado de limitação remoto partilhado (e legado com failures > 0); `chatgptApiFetch` aplica essa pausa aos GETs de todas as conversas; `getInflight` continua separado por conversa. O estado LIMITE_REAL_SERVIDOR_PARTILHADO pode derivar de um 429 remoto anterior em backoff, sem provar que o servidor está a devolver 429 neste instante.
- Limitação de arquitetura: três execuções PowerShell independentes não implicam três verificações/entregas ChatGPT independentes durante limitação do mesmo backend. Não desativar indiscriminadamente a pausa remota; isso multiplicaria pedidos sujeitos ao mesmo limite. Melhorias futuras devem reduzir a dependência de GET para entrega, conservar as provas de clique/DOM e evitar duplicados.
- Nenhuma sessão, processo, ficheiro local ou estado pendente foi alterado durante esta análise. Os resultados publicados não foram reexecutados.
