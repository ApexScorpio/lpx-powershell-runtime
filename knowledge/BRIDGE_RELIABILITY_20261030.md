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
