param([string]$Mode = 'info')
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  Add-Type -AssemblyName System.Speech
  if ($Mode -eq 'info') {
    $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $voices = @($s.GetInstalledVoices() | ForEach-Object { @{name=$_.VoiceInfo.Name;culture=$_.VoiceInfo.Culture.Name;gender=[string]$_.VoiceInfo.Gender;enabled=$_.Enabled} })
    $recognizers = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object { $_.Culture.Name -eq 'zh-CN' })
    @{recognition=($recognizers.Count -gt 0);voices=$voices} | ConvertTo-Json -Compress -Depth 5
    $s.Dispose()
  } else {
    $data = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $stream = New-Object System.IO.MemoryStream
    if ($Mode -eq 'speak') {
      $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
      if ($data.voice) { $s.SelectVoice([string]$data.voice) } else { $s.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Female,[System.Speech.Synthesis.VoiceAge]::NotSet,0,[System.Globalization.CultureInfo]::GetCultureInfo('zh-CN')) }
      $s.Rate = 0
      $s.SetOutputToWaveStream($stream)
      $s.Speak([string]$data.text)
      $s.SetOutputToNull()
      @{audio=('data:audio/wav;base64,' + [Convert]::ToBase64String($stream.ToArray()));voice=$s.Voice.Name} | ConvertTo-Json -Compress
      $s.Dispose()
    } elseif ($Mode -eq 'recognize') {
      $bytes = [Convert]::FromBase64String([string]$data.wavBase64)
      $stream.Write($bytes,0,$bytes.Length)
      $stream.Position=0
      $rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine([System.Globalization.CultureInfo]::GetCultureInfo('zh-CN'))
      $rec.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
      $rec.SetInputToWaveStream($stream)
      $parts = @()
      $confidence = 0.0
      while ($true) {
        try { $r=$rec.Recognize() } catch {
          if ($parts.Count -gt 0 -and $_.Exception.InnerException -is [System.InvalidOperationException] -and $rec.AudioState -eq [System.Speech.Recognition.AudioState]::Stopped) { break }
          throw
        }
        if ($null -eq $r) {break}
        $parts += $r.Text
        $confidence += $r.Confidence
        if ($parts.Count -ge 80) {break}
      }
      $rec.Dispose()
      @{text=($parts -join ' ');confidence=$(if($parts.Count){$confidence/$parts.Count}else{0})} | ConvertTo-Json -Compress
    } else { throw 'Unsupported speech operation' }
    $stream.Dispose()
  }
} catch {
  @{error=$_.Exception.Message} | ConvertTo-Json -Compress
  exit 1
}
