# LPX PowerShell Bridge — protocolo vigente

Estado confirmado em 2026-10-30: código do userscript publicado em main, versão **15.5.14**. Este ficheiro define o protocolo atual e substitui as instruções antigas da versão 15.2.0. **Não pressupõe que o navegador local já esteja atualizado.**

## Entrada para execução

O ChatGPT tem de inserir o script completo, autónomo, legível e executável num bloco Markdown `powershell` na própria resposta:

```powershell
# PSB_JOB_V3
# jobId: PSB-AAAAMMDD-HHMM-DESCRICAO-001
# purpose: resumo concreto do objetivo
Clear-History
# restante código real...
```

- O jobId real e único não pode conter placeholders. O código completo tem de estar dentro do bloco.
- Nunca descrever um job como pronto/executável quando não existe um bloco PowerShell com conteúdo real na resposta.
- Não utilizar anexos PSB_JOB_FILE_V1, ficheiros para download ou manifesto JSON em substituição do script inline.
- Nunca pedir execução manual do PowerShell quando a Bridge estiver ativa.
- A Bridge deteta, valida e envia automaticamente o comando ao serviço local; isso não comprova sucesso funcional.
- Os resultados regressam como PSBRIDGE_RESULT_V2; ler primeiro `result` e só então declarar o estado real, sem inventar resultados.
- Se não houver bloco `PSB_JOB_V3` real, **não houve job executável**.
- `ChatGPT Work` é uma funcionalidade diferente do protocolo da Bridge: nunca inferir que o texto "Work" autoriza substituir a execução local da Bridge por Work.

## Identificação de falhas

- Painel da aba com versão inferior à do repositório: atualização publicada mas **ainda não instalada/ativada nesse separador**.
- Painel "Resultado publicado. A enviar apenas o URL...": publicação confirmada, entrega da resposta à conversa ainda não confirmada.
- Resposta do assistente sem bloco PSB_JOB_V3: não há comando para o leitor local executar.
- Em qualquer situação de entrega incerta, **não duplicar automaticamente o POST do comando**. Recuperar o estado do job antes de considerar reexecução.
- O Tampermonkey verifica atualizações através de @updateURL e @version segundo a documentação oficial; o utilizador pode iniciar a verificação pelo menu da extensão, sem downloads manuais.
- Um script já injetado num separador não muda de versão apenas porque o repositório foi atualizado.

## Limites e proteções

Não terminar sessões, não limpar credenciais/tokens/cookies/backups, não forçar logout ou restart do Antigravity, TIMI, Maestro ou BonChat. Evitar criar ficheiros em C:. Histórico técnico em .md apenas por adição. Para correções visuais, confirmar com capturas da sessão real quando disponível.
