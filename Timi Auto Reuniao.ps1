param(
    [switch]$PrepareOnly,
    [switch]$DryRun,
    [switch]$RunNow
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

$BaseDir = 'S:\Users\lopes\AppData\Local\LPX\Timi Auto Reuniao'
$ConfigPath = Join-Path $BaseDir 'config.json'
$LogDir = Join-Path $BaseDir 'logs'
$LogPath = Join-Path $LogDir ('Timi-Auto-Reuniao-' + (Get-Date -Format 'yyyy-MM-dd') + '.log')

New-Item -ItemType Directory -Force -Path $BaseDir, $LogDir | Out-Null

function Write-Log {
    param([string]$Message)
    $line = ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'), $Message)
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Configuração local não encontrada: $ConfigPath"
}

$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
# LPX DAILY STATE V1
$StatePath = Join-Path $BaseDir 'state.json'

function Get-DailyState {
    $today = (Get-Date).ToString('yyyy-MM-dd')
    if (Test-Path -LiteralPath $StatePath) {
        try {
            $saved = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ([string]$saved.Date -eq $today) {
                return [pscustomobject]@{
                    Date = $today
                    Account1Sent = [bool]$saved.Account1Sent
                    Account2Sent = [bool]$saved.Account2Sent
                }
            }
        }
        catch {
            Write-Log "Estado diário inválido; será recriado: $($_.Exception.Message)"
        }
    }

    return [pscustomobject]@{
        Date = $today
        Account1Sent = $false
        Account2Sent = $false
    }
}

function Save-DailyState {
    param($State)
    $tmp = $StatePath + '.tmp'
    $State | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $tmp -Encoding UTF8
    Move-Item -LiteralPath $tmp -Destination $StatePath -Force
}

function Set-AccountSentToday {
    param([int]$Index, $State)
    if ($Index -eq 0) {
        $State.Account1Sent = $true
    }
    elseif ($Index -eq 1) {
        $State.Account2Sent = $true
    }
    Save-DailyState -State $State
}
# LPX DAILY STATE V1 END

Add-Type -AssemblyName System.Windows.Forms

if (-not ('LPXWin32' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class LPXWin32 {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

    public const int SW_SHOW = 5;
    public const int SW_RESTORE = 9;
    public const int SW_MAXIMIZE = 3;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    public static IntPtr FindTopWindowForProcess(int pid) {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate (IntPtr hWnd, IntPtr lParam) {
            uint windowPid;
            GetWindowThreadProcessId(hWnd, out windowPid);
            if ((int)windowPid == pid) {
                found = hWnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
'@
}

function Get-PlainPassword {
    param([string]$Encrypted)
    $secure = ConvertTo-SecureString $Encrypted
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

function Send-Keys {
    param([string]$Keys)
    [System.Windows.Forms.SendKeys]::SendWait($Keys)
    Start-Sleep -Milliseconds 120
}

function Set-Clip {
    param([string]$Text)
    [System.Windows.Forms.Clipboard]::SetText([string]$Text)
}

function Get-Clip {
    try {
        return [System.Windows.Forms.Clipboard]::GetText()
    }
    catch {
        return ''
    }
}

function Get-WindowHandleForPid {
    param([int]$ProcessId)
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($process -and $process.MainWindowHandle -ne 0) {
        return [IntPtr]$process.MainWindowHandle
    }
    return [LPXWin32]::FindTopWindowForProcess($ProcessId)
}

function Focus-Window {
    param([int]$ProcessId)

    $handle = Get-WindowHandleForPid -ProcessId $ProcessId
    if ($handle -eq [IntPtr]::Zero) {
        return $false
    }

    [LPXWin32]::ShowWindow($handle, [LPXWin32]::SW_RESTORE) | Out-Null
    Start-Sleep -Milliseconds 250
    [LPXWin32]::ShowWindow($handle, [LPXWin32]::SW_MAXIMIZE) | Out-Null
    [LPXWin32]::BringWindowToTop($handle) | Out-Null
    [LPXWin32]::SetForegroundWindow($handle) | Out-Null

    try {
        $shell = New-Object -ComObject WScript.Shell
        $shell.AppActivate($ProcessId) | Out-Null
    } catch {}

    Start-Sleep -Milliseconds 450
    return $true
}

function Click-Relative {
    param(
        [int]$ProcessId,
        [double]$XFraction,
        [double]$YFraction
    )

    $handle = Get-WindowHandleForPid -ProcessId $ProcessId
    if ($handle -eq [IntPtr]::Zero) {
        return $false
    }

    $rect = New-Object LPXWin32+RECT
    if (-not [LPXWin32]::GetWindowRect($handle, [ref]$rect)) {
        return $false
    }

    $width = [Math]::Max(1, $rect.Right - $rect.Left)
    $height = [Math]::Max(1, $rect.Bottom - $rect.Top)

    $x = [int]($rect.Left + ($width * $XFraction))
    $y = [int]($rect.Top + ($height * $YFraction))

    [LPXWin32]::SetCursorPos($x, $y) | Out-Null
    Start-Sleep -Milliseconds 80
    [LPXWin32]::mouse_event([LPXWin32]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
    [LPXWin32]::mouse_event([LPXWin32]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 180
    return $true
}

function Paste-Text {
    param([string]$Text)
    Set-Clip $Text
    Send-Keys '^v'
}

function Get-BonChatProcessInfo {
    $items = @()
    $rows = Get-CimInstance Win32_Process -Filter "Name='BonChat.exe'" -ErrorAction SilentlyContinue
    foreach ($row in $rows) {
        $items += [pscustomobject]@{
            ProcessId = [int]$row.ProcessId
            ExecutablePath = [string]$row.ExecutablePath
            CommandLine = [string]$row.CommandLine
            CreationDate = $row.CreationDate
        }
    }
    return @($items)
}

function Stop-BonChatProcess {
    param([int]$ProcessId, [string]$Reason)
    try {
        Write-Log "A fechar PID $ProcessId ($Reason)."
        Stop-Process -Id $ProcessId -Force -ErrorAction Stop
        Start-Sleep -Milliseconds 350
    }
    catch {
        Write-Log "Não foi possível fechar PID ${ProcessId}: $($_.Exception.Message)"
    }
}

function Ensure-PortableCopy {
    param($Account)

    $sourceDir = Split-Path -Parent ([string]$config.BonChatExe)
    $targetDir = [string]$Account.AppDir
    $targetExe = [string]$Account.Exe

    if (Test-Path -LiteralPath $targetExe) {
        return
    }

    Write-Log "A criar cópia BonChat para conta $($Account.Login) em $targetDir."
    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

    $arguments = @(
        "`"$sourceDir`"",
        "`"$targetDir`"",
        '/E',
        '/XD', 'tdata', 'sentry',
        '/R:1',
        '/W:1',
        '/NFL',
        '/NDL',
        '/NJH',
        '/NJS',
        '/NP'
    )

    $proc = Start-Process -FilePath 'robocopy.exe' -ArgumentList $arguments -PassThru -Wait -WindowStyle Hidden
    if ($proc.ExitCode -ge 8) {
        throw "Robocopy falhou ao criar $targetDir (exitCode=$($proc.ExitCode))."
    }

    if (-not (Test-Path -LiteralPath $targetExe)) {
        throw "A cópia foi criada sem BonChat.exe: $targetExe"
    }
}

function Get-AccountProcess {
    param($Account)
    $wanted = ([string]$Account.Exe).ToLowerInvariant()
    $matches = @(Get-BonChatProcessInfo | Where-Object {
        ([string]$_.ExecutablePath).ToLowerInvariant() -eq $wanted
    })
    if ($matches.Count -gt 0) {
        return $matches[0]
    }
    return $null
}

function Remove-UnmanagedInstanceIfNeeded {
    $all = @(Get-BonChatProcessInfo)
    if ($all.Count -lt 2) {
        return
    }

    $ownedPaths = @(
        ([string]$config.Accounts[0].Exe).ToLowerInvariant(),
        ([string]$config.Accounts[1].Exe).ToLowerInvariant()
    )

    $unmanaged = @($all | Where-Object {
        $ownedPaths -notcontains ([string]$_.ExecutablePath).ToLowerInvariant()
    } | Sort-Object CreationDate -Descending)

    if ($unmanaged.Count -gt 0) {
        Stop-BonChatProcess -ProcessId $unmanaged[0].ProcessId -Reason 'abrir instância dedicada mantendo o máximo de 2'
        return
    }

    $duplicates = @()
    foreach ($account in $config.Accounts) {
        $path = ([string]$account.Exe).ToLowerInvariant()
        $same = @($all | Where-Object {
            ([string]$_.ExecutablePath).ToLowerInvariant() -eq $path
        } | Sort-Object CreationDate -Descending)
        if ($same.Count -gt 1) {
            $duplicates += $same[0]
        }
    }
    if ($duplicates.Count -gt 0) {
        Stop-BonChatProcess -ProcessId $duplicates[0].ProcessId -Reason 'instância duplicada'
    }
}

function Enforce-ExactlyTwoOwned {
    $all = @(Get-BonChatProcessInfo)
    $ownedPaths = @(
        ([string]$config.Accounts[0].Exe).ToLowerInvariant(),
        ([string]$config.Accounts[1].Exe).ToLowerInvariant()
    )

    foreach ($item in @($all | Where-Object {
        $ownedPaths -notcontains ([string]$_.ExecutablePath).ToLowerInvariant()
    })) {
        Stop-BonChatProcess -ProcessId $item.ProcessId -Reason 'instância não gerida pelo Timi Auto Reuniao'
    }

    foreach ($account in $config.Accounts) {
        $path = ([string]$account.Exe).ToLowerInvariant()
        $same = @(Get-BonChatProcessInfo | Where-Object {
            ([string]$_.ExecutablePath).ToLowerInvariant() -eq $path
        } | Sort-Object CreationDate)
        if ($same.Count -gt 1) {
            foreach ($extra in $same[1..($same.Count - 1)]) {
                Stop-BonChatProcess -ProcessId $extra.ProcessId -Reason 'duplicado da mesma conta'
            }
        }
    }
}

function Wait-ForWindow {
    param([int]$ProcessId, [int]$TimeoutSeconds = 20)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $handle = Get-WindowHandleForPid -ProcessId $ProcessId
        if ($handle -ne [IntPtr]::Zero) {
            return $true
        }
        Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $deadline)

    return $false
}

function Invoke-AutoLogin {
    param($Account, [int]$ProcessId)

    $marker = Join-Path ([string]$Account.AppDir) '.lpx-login-prepared'
    if (Test-Path -LiteralPath $marker) {
        return $true
    }

    $tdata = Join-Path ([string]$Account.AppDir) 'tdata'
    if ((Test-Path -LiteralPath $tdata) -and @(Get-ChildItem -LiteralPath $tdata -Force -ErrorAction SilentlyContinue).Count -gt 0) {
        Set-Content -LiteralPath $marker -Value (Get-Date -Format o) -Encoding ASCII
        return $true
    }

    Write-Log "A tentar login automático para $($Account.Login)."

    if (-not (Focus-Window -ProcessId $ProcessId)) {
        Write-Log "Login: sem janela para PID $ProcessId."
        return $false
    }

    $password = Get-PlainPassword -Encrypted ([string]$Account.PasswordProtected)
    $oldClip = Get-Clip

    try {
        # Estratégia principal: campos centrais típicos do cliente Qt.
        Click-Relative -ProcessId $ProcessId -XFraction 0.50 -YFraction 0.43 | Out-Null
        Send-Keys '^a'
        Paste-Text ([string]$Account.Login)
        Send-Keys '{ENTER}'
        Start-Sleep -Seconds 2

        Click-Relative -ProcessId $ProcessId -XFraction 0.50 -YFraction 0.52 | Out-Null
        Send-Keys '^a'
        Paste-Text $password
        Send-Keys '{ENTER}'
        Start-Sleep -Seconds 5

        if ((Test-Path -LiteralPath $tdata) -and @(Get-ChildItem -LiteralPath $tdata -Force -ErrorAction SilentlyContinue).Count -gt 0) {
            Set-Content -LiteralPath $marker -Value (Get-Date -Format o) -Encoding ASCII
            Write-Log "Login preparado para $($Account.Login)."
            return $true
        }

        # Fallback por teclado: primeiro campo -> próximo campo -> Enter.
        Focus-Window -ProcessId $ProcessId | Out-Null
        Send-Keys '{ESC}'
        Send-Keys '{TAB}'
        Send-Keys '^a'
        Paste-Text ([string]$Account.Login)
        Send-Keys '{TAB}'
        Send-Keys '^a'
        Paste-Text $password
        Send-Keys '{ENTER}'
        Start-Sleep -Seconds 5

        if ((Test-Path -LiteralPath $tdata) -and @(Get-ChildItem -LiteralPath $tdata -Force -ErrorAction SilentlyContinue).Count -gt 0) {
            Set-Content -LiteralPath $marker -Value (Get-Date -Format o) -Encoding ASCII
            Write-Log "Login preparado no fallback para $($Account.Login)."
            return $true
        }

        Write-Log "Login automático não confirmado para $($Account.Login); a instância ficou aberta para nova tentativa."
        return $false
    }
    finally {
        if ($null -ne $oldClip) {
            try { Set-Clip $oldClip } catch {}
        }
        $password = $null
    }
}

function Ensure-AccountRunning {
    param($Account)

    Ensure-PortableCopy -Account $Account

    $existing = Get-AccountProcess -Account $Account
    if ($existing) {
        return $existing
    }

    Remove-UnmanagedInstanceIfNeeded

    Write-Log "A abrir conta $($Account.Login)."
    $proc = Start-Process -FilePath ([string]$Account.Exe) -ArgumentList '-noupdate' -WorkingDirectory ([string]$Account.AppDir) -PassThru

    if (-not (Wait-ForWindow -ProcessId $proc.Id -TimeoutSeconds 25)) {
        throw "BonChat abriu sem janela utilizável para a conta $($Account.Login) (PID $($proc.Id))."
    }

    Invoke-AutoLogin -Account $Account -ProcessId $proc.Id | Out-Null

    return [pscustomobject]@{
        ProcessId = $proc.Id
        ExecutablePath = [string]$Account.Exe
        CommandLine = ''
        CreationDate = Get-Date
    }
}

function Test-MessageInputAndSend {
    param(
        $Account,
        [string]$Message,
        [switch]$NoSend
    )

    $procInfo = Get-AccountProcess -Account $Account
    if (-not $procInfo) {
        return $false
    }

    $pidValue = [int]$procInfo.ProcessId
    if (-not (Focus-Window -ProcessId $pidValue)) {
        return $false
    }

    $oldClip = Get-Clip
    try {
        # Pesquisa do grupo.
        Send-Keys '{ESC}'
        Send-Keys '{ESC}'
        Send-Keys '^k'
        Start-Sleep -Milliseconds 350
        Send-Keys '^a'
        Paste-Text ([string]$config.Group)
        Start-Sleep -Milliseconds 900
        Send-Keys '{ENTER}'
        Start-Sleep -Milliseconds 1100
        Send-Keys '{ESC}'
        Start-Sleep -Milliseconds 250

        # Área da caixa de texto na zona inferior direita do cliente maximizado.
        Click-Relative -ProcessId $pidValue -XFraction 0.68 -YFraction 0.945 | Out-Null
        Start-Sleep -Milliseconds 250

        # Prova de que existe um campo editável: colar, selecionar e copiar.
        Send-Keys '^a'
        Paste-Text $Message
        Start-Sleep -Milliseconds 220
        Send-Keys '^a'
        Send-Keys '^c'
        Start-Sleep -Milliseconds 180
        $copied = Get-Clip

        if ($copied -ne $Message) {
            Send-Keys '{ESC}'
            Write-Log "Grupo $($config.Group) ainda não expôs caixa de mensagem para $($Account.Login)."
            return $false
        }

        if ($NoSend) {
            Send-Keys '^a'
            Send-Keys '{BACKSPACE}'
            Write-Log "DRY-RUN: caixa de mensagem confirmada para $($Account.Login), sem envio."
            return $true
        }

        Send-Keys '{ENTER}'
        Start-Sleep -Milliseconds 700

        # Verificação simples: se o texto continuar no campo, não foi enviado.
        $marker = 'LPX_CLIP_' + [Guid]::NewGuid().ToString('N')
        Set-Clip $marker
        Send-Keys '^a'
        Send-Keys '^c'
        Start-Sleep -Milliseconds 180
        $after = Get-Clip

        if ($after -eq $Message) {
            Write-Log "O texto permaneceu na caixa; envio não confirmado para $($Account.Login)."
            return $false
        }

        Write-Log "Mensagem enviada para grupo $($config.Group) pela conta $($Account.Login): $Message"
        return $true
    }
    finally {
        try { Set-Clip $oldClip } catch {}
    }
}

function Pick-Greeting {
    $messages = @(
        'Boa noite',
        'Boas',
        'Bom dia',
        'Boa noite a todos',
        'Boas a todos',
        'Olá, boa noite',
        'Boa noite pessoal',
        'Boas pessoal',
        'Olá a todos',
        'Boa noite malta',
        'Uma boa noite a todos',
        'Boas noites',
        'Olá!',
        'Tudo bem? Boa noite',
        'Boa noite 🙂'
    )
    return [string](Get-Random -InputObject $messages)
}

function New-SchedulePair {
    param([datetime]$Base)

    # Abre entre 19:30:00 e 19:34:00; envia depois de abrir e até 19:35:00.
    $openOffset = Get-Random -Minimum 0 -Maximum 241
    $minSend = [Math]::Min(295, $openOffset + 10)
    $sendOffset = Get-Random -Minimum $minSend -Maximum 301

    return [pscustomobject]@{
        OpenAt = $Base.AddSeconds($openOffset)
        SendAt = $Base.AddSeconds($sendOffset)
        NextCheckAt = $Base.AddSeconds($sendOffset)
        Opened = $false
        Sent = $false
        Message = Pick-Greeting
    }
}

function Get-DailyBaseTime {
    if ($RunNow -or $PrepareOnly) {
        return (Get-Date)
    }

    $now = Get-Date
    $base = Get-Date -Year $now.Year -Month $now.Month -Day $now.Day -Hour 19 -Minute 30 -Second 0

    if ($now -lt $base) {
        return $base
    }

    if ($now -le $base.AddMinutes(5)) {
        return $base
    }

    # StartWhenAvailable: se o PC estava desligado, executa logo sem esperar pelo dia seguinte.
    Write-Log "Execução começou depois das 19:35; a usar janela curta imediata por StartWhenAvailable."
    return $now
}

$mutex = New-Object Threading.Mutex($false, 'Global\LPX_Timi_Auto_Reuniao')
$hasMutex = $false
try {
    $hasMutex = $mutex.WaitOne(0)
    if (-not $hasMutex) {
        Write-Log 'Já existe uma execução ativa; esta instância termina.'
        exit 0
    }

    Write-Log '=== Timi Auto Reuniao iniciado ==='

    if ($PrepareOnly) {
        foreach ($account in $config.Accounts) {
            Ensure-AccountRunning -Account $account | Out-Null
            Start-Sleep -Seconds 2
        }
        Enforce-ExactlyTwoOwned
        $count = @(Get-BonChatProcessInfo).Count
        Write-Log "PREPARE concluído. Processos BonChat: $count."
        [pscustomobject]@{
            Mode = 'PrepareOnly'
            BonChatProcesses = $count
            Account1Running = [bool](Get-AccountProcess -Account $config.Accounts[0])
            Account2Running = [bool](Get-AccountProcess -Account $config.Accounts[1])
            Account1ProfileReady = Test-Path -LiteralPath (Join-Path ([string]$config.Accounts[0].AppDir) '.lpx-login-prepared')
            Account2ProfileReady = Test-Path -LiteralPath (Join-Path ([string]$config.Accounts[1].AppDir) '.lpx-login-prepared')
            LogPath = $LogPath
        } | ConvertTo-Json -Depth 4
        exit 0
    }

    $base = Get-DailyBaseTime
    $state1 = New-SchedulePair -Base $base
    do {
        $state2 = New-SchedulePair -Base $base
        $openDiff = [Math]::Abs(($state1.OpenAt - $state2.OpenAt).TotalSeconds)
        $sendDiff = [Math]::Abs(($state1.SendAt - $state2.SendAt).TotalSeconds)
    } while ($openDiff -lt 10 -or $sendDiff -lt 10)

    $states = @($state1, $state2)
    # Restaurar o estado persistente do dia atual para impedir envios duplicados.
    $dailyState = Get-DailyState
    $states[0].Sent = [bool]$dailyState.Account1Sent
    $states[1].Sent = [bool]$dailyState.Account2Sent
    if ($states[0].Sent) {
        $states[0].Opened = $true
        Write-Log 'Conta 1 já enviou hoje; envio ignorado.'
    }
    if ($states[1].Sent) {
        $states[1].Opened = $true
        Write-Log 'Conta 2 já enviou hoje; envio ignorado.'
    }

    Write-Log ("Conta 1: abrir {0}, enviar {1}" -f $state1.OpenAt.ToString('HH:mm:ss'), $state1.SendAt.ToString('HH:mm:ss'))
    Write-Log ("Conta 2: abrir {0}, enviar {1}" -f $state2.OpenAt.ToString('HH:mm:ss'), $state2.SendAt.ToString('HH:mm:ss'))

    $stopAt = $base.Date.AddDays(1).AddHours(6)

    while (-not ($states[0].Sent -and $states[1].Sent)) {
        $now = Get-Date

        if ($now -ge $stopAt) {
            Write-Log 'Limite diário atingido às 06:00 sem completar ambos os envios.'
            break
        }

        for ($i = 0; $i -lt 2; $i++) {
            $account = $config.Accounts[$i]
            $state = $states[$i]

            if (-not $state.Opened -and $now -ge $state.OpenAt) {
                Ensure-AccountRunning -Account $account | Out-Null
                $state.Opened = $true
                Write-Log "Conta $($i + 1) aberta/confirmada."
            }

            if ($state.Opened -and -not $state.Sent -and $now -ge $state.NextCheckAt) {
                $ok = Test-MessageInputAndSend -Account $account -Message ([string]$state.Message) -NoSend:$DryRun
                if ($ok) {
                    $state.Sent = $true
                    if (-not $DryRun) {
                        Set-AccountSentToday -Index $i -State $dailyState
                    }
                }
                else {
                    $state.NextCheckAt = (Get-Date).AddMinutes(1)
                    Write-Log "Conta $($i + 1): nova verificação dentro de 1 minuto."
                }
            }
        }

        if ($states[0].Opened -and $states[1].Opened) {
            Enforce-ExactlyTwoOwned
        }

        Start-Sleep -Seconds 1
    }

    Enforce-ExactlyTwoOwned

    [pscustomobject]@{
        Mode = $(if ($DryRun) { 'DryRun' } else { 'Normal' })
        Account1Sent = [bool]$states[0].Sent
        Account2Sent = [bool]$states[1].Sent
        Account1OpenAt = $states[0].OpenAt.ToString('o')
        Account2OpenAt = $states[1].OpenAt.ToString('o')
        Account1SendAt = $states[0].SendAt.ToString('o')
        Account2SendAt = $states[1].SendAt.ToString('o')
        ProcessCount = @(Get-BonChatProcessInfo).Count
        LogPath = $LogPath
    } | ConvertTo-Json -Depth 4

    Write-Log '=== Timi Auto Reuniao terminado ==='
}
finally {
    if ($hasMutex) {
        try { $mutex.ReleaseMutex() | Out-Null } catch {}
    }
    $mutex.Dispose()
}

