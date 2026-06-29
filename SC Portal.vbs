' Doppio clic = apre SC Portal come un'app, SENZA finestra del terminale.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
d = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
sh.CurrentDirectory = d
pyw = d & "venv\Scripts\pythonw.exe"
py  = d & "venv\Scripts\python.exe"
If fso.FileExists(pyw) Then
    ' Avvio completamente invisibile (0 = nessuna finestra).
    sh.Run """" & pyw & """ """ & d & "start.py""", 0, False
ElseIf fso.FileExists(py) Then
    ' Fallback: python.exe del venv, comunque senza finestra visibile.
    sh.Run """" & py & """ """ & d & "start.py""", 0, False
Else
    ' Primo avvio (nessun venv): mostra il setup, poi sara' invisibile.
    sh.Run """" & d & "Avvia SC Portal.bat""", 1, False
End If
