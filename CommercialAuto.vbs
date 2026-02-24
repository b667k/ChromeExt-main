Option Explicit

' =========================
' CONFIG
' =========================
Const SCREEN_ID_ROW = 2
Const SCREEN_ID_COL = 2
Const SCREEN_ID_LEN = 4

' Driver/Fault Rating field (you provided)
Const DRIVER_FR_ROW = 10
Const DRIVER_FR_COL = 31
Const DRIVER_FR_LEN = 7

' Date of Loss (you provided)
Const DOL_ROW = 9
Const DOL_COL = 20
Const DOL_LEN = 8

' PUBC extra pull (ONLY when no driver)
Const PUBC_PULL_ROW = 13
Const PUBC_PULL_COL = 67
Const PUBC_PULL_LEN = 6

' PUUR extra pull (Row 2, Col 8, Len 41) -> pass into form field T3
Const PUUR_PULL_ROW = 2
Const PUUR_PULL_COL = 8
Const PUUR_PULL_LEN = 41

Const MAX_ADVANCES = 250

Const MB_EXCLAMATION = 48
Const MB_INFO        = 64

Const NO_DRIVER_URL = "http://erieshare/sites/formsmgmt/CommlForms/_layouts/15/FormServer.aspx?XsnLocation=/sites/formsmgmt/CommlForms/CUW134/forms/template.xsn%3Fopenin=browser"
Const PASS_PARAM_X  = "x"
Const PASS_PARAM_T3 = "t3"
Const PASS_PARAM_T4 = "t4"
Const PASS_PARAM_T5 = "t5"

' Chrome extension ClaimCenter URL base - opens ClaimCenter with claim number
Const CC_BASE_URL = "https://cc-prod-gwcpprod.erie.delta4-andromeda.guidewire.net/ClaimCenter.do"
Const TARGET_PAGE_LOSS_DETAILS = "loss_details"

' =========================
' INIT
' =========================
Dim MFScreen
Set MFScreen = CreateObject("BZWhll.WhllObj")
MFScreen.Connect ""
MFScreen.WaitReady 5, 0

RunCommercialAuto

' =========================
' HELPERS
' =========================
Function CRLF()
  CRLF = Chr(13) & Chr(10)
End Function

Function RS(ByVal length, ByVal row, ByVal col)
  Dim buf
  buf = ""
  MFScreen.ReadScreen buf, length, row, col
  RS = buf
End Function

Function ScreenId()
  ScreenId = UCase(Trim(RS(SCREEN_ID_LEN, SCREEN_ID_ROW, SCREEN_ID_COL)))
End Function

Sub EnsurePUUR()
  If ScreenId() <> "PUUR" Then
    MFScreen.SendKeys "<Home>PUUR<Enter>"
    MFScreen.WaitReady 1, 200
  End If
End Sub

' Read POLICY/CLAIM from %TEMP%\commercial_auto_context.txt
Sub ReadPortalContext(ByRef policyOut, ByRef claimOut)
  Dim sh, fso, p, ts, line
  policyOut = ""
  claimOut  = ""

  Set sh = CreateObject("WScript.Shell")
  Set fso = CreateObject("Scripting.FileSystemObject")

  p = sh.ExpandEnvironmentStrings("%TEMP%") & "\commercial_auto_context.txt"
  If Not fso.FileExists(p) Then Exit Sub

  Set ts = fso.OpenTextFile(p, 1, False)
  Do While Not ts.AtEndOfStream
    line = Trim(ts.ReadLine)
    If UCase(Left(line, 7)) = "POLICY=" Then policyOut = Trim(Mid(line, 8))
    If UCase(Left(line, 6)) = "CLAIM=" Then claimOut = Trim(Mid(line, 7))
  Loop
  ts.Close
End Sub

' Robust page scan for long claim number
Function PageHasClaim(ByVal claim)
  Dim r, line
  claim = UCase(Trim(claim))
  PageHasClaim = False

  For r = 6 To 14
    line = UCase(RS(80, r, 1))
    If InStr(1, line, claim, 1) > 0 Then
      PageHasClaim = True
      Exit Function
    End If
  Next
End Function

Function GoToPUURClaim(ByVal policyNum, ByVal claimNum)
  Dim i
  GoToPUURClaim = False

  policyNum = Trim(CStr(policyNum))
  claimNum  = Trim(CStr(claimNum))
  If policyNum = "" Or claimNum = "" Then Exit Function

  Call EnsurePUUR()
  If ScreenId() <> "PUUR" Then Exit Function

  MFScreen.SendKeys "<Clear>PUUR " & policyNum & "<Enter>"
  MFScreen.WaitReady 1, 200

  MFScreen.SendKeys "A<Enter>"
  MFScreen.WaitReady 1, 200

  For i = 1 To MAX_ADVANCES
    If PageHasClaim(claimNum) Then
      GoToPUURClaim = True
      Exit Function
    End If
    MFScreen.SendKeys "<Enter>"
    MFScreen.WaitReady 1, 200
  Next
End Function

Function GetPUBCValue_13_67_6()
  Dim v
  v = ""
  MFScreen.SendKeys "<Home>PUBC<Enter>"
  MFScreen.WaitReady 1, 200
  v = Trim(RS(PUBC_PULL_LEN, PUBC_PULL_ROW, PUBC_PULL_COL))
  MFScreen.SendKeys "<PF3>"
  MFScreen.WaitReady 1, 200
  GetPUBCValue_13_67_6 = v
End Function

Function GetPUURValue_2_8_41()
  Call EnsurePUUR()
  GetPUURValue_2_8_41 = Trim(RS(PUUR_PULL_LEN, PUUR_PULL_ROW, PUUR_PULL_COL))
End Function

Function SanitizeAlphaNum6(ByVal s)
  Dim i, ch, out
  s = UCase(Trim(CStr(s)))
  out = ""
  For i = 1 To Len(s)
    ch = Mid(s, i, 1)
    If (ch >= "A" And ch <= "Z") Or (ch >= "0" And ch <= "9") Then
      out = out & ch
      If Len(out) = 6 Then Exit For
    End If
  Next
  SanitizeAlphaNum6 = out
End Function

Function UrlEncodeBasic(ByVal s)
  Dim i, ch, code, out
  out = ""
  s = CStr(s)
  For i = 1 To Len(s)
    ch = Mid(s, i, 1)
    If (ch >= "A" And ch <= "Z") Or (ch >= "a" And ch <= "z") Or (ch >= "0" And ch <= "9") _
       Or ch = "-" Or ch = "_" Or ch = "." Or ch = "~" Then
      out = out & ch
    ElseIf ch = " " Then
      out = out & "%20"
    Else
      code = Hex(AscW(ch))
      If Len(code) = 1 Then code = "0" & code
      out = out & "%" & code
    End If
  Next
  UrlEncodeBasic = out
End Function

Function AppendQueryParam(ByVal baseUrl, ByVal paramName, ByVal paramVal)
  Dim sep
  If InStr(1, baseUrl, "?", 1) > 0 Then
    If Right(baseUrl, 1) = "?" Or Right(baseUrl, 1) = "&" Then
      sep = ""
    Else
      sep = "&"
    End If
  Else
    sep = "?"
  End If
  AppendQueryParam = baseUrl & sep & paramName & "=" & UrlEncodeBasic(paramVal)
End Function

' Opens ClaimCenter via Chrome extension to get driver name, then opens CUW134 with all params
Sub OpenNoDriverWithClaimCenter(ByVal pubc6, ByVal puurText41, ByVal dolSlash, ByVal claimNum)
  Dim sh, ccUrl, finalUrl
  
  Set sh = CreateObject("WScript.Shell")
  
  ' Build ClaimCenter URL - Chrome extension will:
  ' 1. Open ClaimCenter with this claim
  ' 2. Navigate to Loss Details
  ' 3. Get driver name
  ' 4. Open CUW134 with all 4 parameters (x, t3, t4, t5)
  ccUrl = CC_BASE_URL & "?claimNumber=" & UrlEncodeBasic(claimNum) & "&TargetPage=" & TARGET_PAGE_LOSS_DETAILS
  
  ' Open ClaimCenter - Chrome extension will handle the rest
  ' It will get driver from Loss Details, combine with our x/t3/t5, and open CUW134
  sh.Run """" & ccUrl & """", 1, False
  
  MsgBox "Opening ClaimCenter to get driver name..." & CRLF() & _
         "The Chrome extension will:" & CRLF() & _
         "1. Open ClaimCenter for claim: " & claimNum & CRLF() & _
         "2. Navigate to Loss Details" & CRLF() & _
         "3. Get driver name" & CRLF() & _
         "4. Open CUW134 form with all parameters", _
         MB_INFO, "Opening ClaimCenter"
End Sub

' Legacy function - kept for compatibility
Sub OpenNoDriverInDefaultBrowser(ByVal pubc6, ByVal puurText41, ByVal dolSlash)
  Dim sh, finalUrl
  finalUrl = NO_DRIVER_URL
  finalUrl = AppendQueryParam(finalUrl, PASS_PARAM_X, pubc6)
  finalUrl = AppendQueryParam(finalUrl, PASS_PARAM_T3, puurText41)
  finalUrl = AppendQueryParam(finalUrl, PASS_PARAM_T5, dolSlash)
  Set sh = CreateObject("WScript.Shell")
  sh.Run """" & finalUrl & """", 1, False
End Sub

' NEW: read driver/fault field
Function GetDriverFault7()
  GetDriverFault7 = Trim(RS(DRIVER_FR_LEN, DRIVER_FR_ROW, DRIVER_FR_COL))
End Function

' NEW: read DOL
Function GetDOL8()
  GetDOL8 = Trim(RS(DOL_LEN, DOL_ROW, DOL_COL))
End Function

Function DashToSlash(ByVal s)
  DashToSlash = Replace(Trim(CStr(s)), "-", "/")
End Function

' =========================
' MAIN
' =========================
Sub RunCommercialAuto()
  Dim policyNum, claimNum, okNav
  Dim driverFault, dolRaw, dolSlash
  Dim pubcVal, pubcVal6, puurText41

  Call ReadPortalContext(policyNum, claimNum)

  If policyNum = "" Or claimNum = "" Then
    MsgBox "Commercial Auto: missing POLICY/CLAIM context." & CRLF() & _
           "Expected %TEMP%\commercial_auto_context.txt with POLICY= and CLAIM=", _
           MB_EXCLAMATION, "Commercial Auto"
    Exit Sub
  End If

  okNav = GoToPUURClaim(policyNum, claimNum)
  If Not okNav Then
    MsgBox "Could not navigate to claim." & CRLF() & _
           "Policy: [" & policyNum & "]" & CRLF() & _
           "Claim:  [" & claimNum & "]" & CRLF() & _
           "Screen: [" & ScreenId() & "]", _
           MB_EXCLAMATION, "Navigation Failed"
    Exit Sub
  End If

  ' Pull the values from the claim page (your coordinates)
  driverFault = GetDriverFault7()
  dolRaw = GetDOL8()
  dolSlash = DashToSlash(dolRaw)

  ' NO DRIVER condition (same intent as before): not numeric
  ' If the field contains other chars/spaces, treat as NO DRIVER.
  If IsNumeric(driverFault) Then
    Exit Sub
  End If

  ' NO DRIVER path - open ClaimCenter to get driver name
  pubcVal = GetPUBCValue_13_67_6()
  pubcVal6 = SanitizeAlphaNum6(pubcVal)
  puurText41 = GetPUURValue_2_8_41()

  ' NEW: Open ClaimCenter via Chrome extension - it will get driver and open CUW134
  Call OpenNoDriverWithClaimCenter(pubcVal6, puurText41, dolSlash, claimNum)

  MsgBox "No driver found. ClaimCenter opening..." & CRLF() & _
         "Driver/Fault (10,31,7): [" & driverFault & "]" & CRLF() & _
         "DOL (9,20,8): [" & dolRaw & "] -> [" & dolSlash & "]" & CRLF() & _
         "Claim: [" & claimNum & "]", _
         MB_EXCLAMATION, "No Driver"
End Sub
