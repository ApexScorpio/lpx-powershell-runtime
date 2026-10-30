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
