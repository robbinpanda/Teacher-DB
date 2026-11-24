param([Parameter(Mandatory = $true)][string]$Source, [Parameter(Mandatory = $true)][string]$Target)
# Open a generated .docx in real Word, report how many native equations it
# recognises, and export a PDF for visual review. Word throws on a file it
# would have to repair, so a clean exit means the document is well formed.
$ErrorActionPreference = "Stop"
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  # ConfirmConversions=false, ReadOnly=true, AddToRecentFiles=false, ..., OpenAndRepair=false, NoEncodingDialog=true
  $document = $word.Documents.Open($Source, $false, $true, $false, "", "", $true, "", "", 0, 0, $false, $false, 0, $true)
  Write-Output ("opened; equations=" + $document.OMaths.Count + " pages=" + $document.ComputeStatistics(2))
  $document.ExportAsFixedFormat($Target, 17)
  $document.Close($false)
} finally {
  $word.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
