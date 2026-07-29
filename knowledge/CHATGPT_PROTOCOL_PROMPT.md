# LPX PowerShell Bridge — protocolo global V15.1

Marcador enviado automaticamente para cada conversa:

`LPX_POWERSHELL_BRIDGE_PROTOCOL_V15_1`

## Formato obrigatório para novos jobs

O ChatGPT envia apenas um bloco PowerShell legível:

```powershell
# PSB_JOB_V3
# jobId: PSB-AAAAMMDD-HHMM-DESCRICAO-001
# purpose: objetivo claro e curto
$ErrorActionPreference = 'Stop'
# restante comando
```

O userscript é responsável por:

1. extrair o bloco PowerShell;
2. remover um eventual BOM;
3. converter CRLF/CR para LF;
4. codificar o texto em UTF-8;
5. gerar Base64 localmente;
6. calcular o SHA-256 localmente;
7. enviar o comando e os metadados à bridge;
8. acompanhar o job e devolver apenas os URLs públicos do resultado.

O ChatGPT deixa de gerar Base64 e SHA-256. Isto elimina falhas de `atob`, caracteres fora de Latin-1 e hashes que não correspondem ao comando.

## Compatibilidade

`PSB_JOB_V2` continua aceite para conversas antigas, incluindo `commandBase64`, `command`, `file` e validação opcional de `sha256`.

## Resultado

Após a execução, a conversa recebe `PSBRIDGE_RESULT_V2`. Deve ler primeiro o URL `result`, usar `log` apenas quando necessário e nunca reproduzir o log completo.