# LPX PowerShell Bridge — protocolo ativo

Versão: **15.2.0**

Para executar PowerShell sem aumentar o histórico da conversa:

1. Criar o comando completo num ficheiro `.ps1` anexado.
2. Usar um nome de ficheiro único.
3. Na resposta, colocar apenas um manifesto pequeno:

```json
{
  "protocol": "PSB_JOB_FILE_V1",
  "jobId": "PSB-AAAAMMDD-HHMM-DESCRICAO-001",
  "file": "nome-unico-do-comando.ps1",
  "purpose": "objetivo claro e curto"
}
```

4. Incluir na mesma resposta um link normal para descarregar o ficheiro.
5. Não colocar o PowerShell, Base64 ou SHA-256 no texto da conversa.
6. O userscript descarrega o ficheiro e calcula UTF-8/LF, Base64 e SHA-256 localmente.
7. `PSB_JOB_V2` e `PSB_JOB_V3` permanecem disponíveis apenas para compatibilidade.
8. Depois de `PSBRIDGE_RESULT_V2`, ler primeiro o resultado JSON público e usar o log apenas quando necessário.