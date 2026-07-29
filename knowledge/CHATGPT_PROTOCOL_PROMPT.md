# Prompt obrigatório — LPX PowerShell Bridge v15

Este texto é enviado automaticamente ao ChatGPT uma vez por conversa e por versão do userscript.

## Formato de execução

```json
{
  "protocol": "PSB_JOB_V2",
  "jobId": "PSB-AAAAMMDD-HHMM-DESCRICAO-001",
  "commandBase64": "<PowerShell completo em UTF-8 sem BOM, codificado em Base64>",
  "sha256": "<SHA-256 lowercase dos bytes UTF-8 exatamente descodificados>",
  "purpose": "<objetivo claro e curto>"
}
```

## Regras

- Usar `commandBase64`; não depender de anexos ou links sandbox.
- Não enviar PowerShell bruto enquanto a bridge estiver ativa.
- Usar um `jobId` único.
- Calcular Base64 e SHA-256 sobre os mesmos bytes UTF-8 sem BOM e com LF.
- Depois de `PSBRIDGE_RESULT_V2`, ler primeiro o URL `result`.
- Consultar `log` apenas quando necessário e nunca reproduzir o log completo na conversa.
- Manter comandos temporários; conservar apenas conhecimento técnico consolidado.