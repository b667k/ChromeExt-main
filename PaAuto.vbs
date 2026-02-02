
' 8888888b.     d8888           d8888 888     888 88888888888 .d88888b.    -  PA Automator Script
' 888   Y88b   d88888          d88888 888     888     888    d88P" "Y88b   -  Created : 12/17/2025     
' 888    888  d88P888         d88P888 888     888     888    888     888   -  Last Update: 1/21/2026   
' 888   d88P d88P 888        d88P 888 888     888     888    888     888   -  Version : v1.0.1         
' 8888888P" d88P  888       d88P  888 888     888     888    888     888   -  Author: Isaac Trost      
' 888      d88P   888      d88P   888 888     888     888    888     888                        
' 888     d8888888888     d8888888888 Y88b. .d88P     888    Y88b. .d88P                        
' 888    d88P     888    d88P     888  "Y88888P"      888     "Y88888P"                         
'                                                                                               
' Description : Automates the flowchart process for PA Auto claims.                             


' LIMITATIONS:                                                                               
'  - Currently unable to detect a couple always-refer edge cases.                            
'  - These include:                                                                          
'     - Severe injury or death of youthful driver.                                           
'     - Reposessed vehicle damage.                                                           
'     - Fall-asleep loss.                                                                    
'  - To my knowledge, there is no data in mainframe that reliably indicates these cases.     

' TODO:
'  - Add cause code in DM's w/ Alayna to Med-Only checking.
'  - Fix scraping exsessive claims. Should stop scraping claims after one is not within 
'    3 years of renewal. E.g. Claim: Q081805181, Policy: A00007354896.

Option Explicit
Dim MFScreen, P, D, C, T
Set P = New Policy
Set D = New MainDriver
Set C = New ClaimsController
Set T = New Tools

' Run Main.
D.Main

Class MainDriver
    Private Sub Class_Initialize()
        ' Connect to MainFrame.
        Set MFScreen = CreateObject("BZWhll.WhllObj")
        MFScreen.Connect ""
        MFScreen.WaitReady 1, 0
    End Sub

    ' Main driver function.
    Sub Main
        ' Terminate if user is not on claims detail screen.
        If Not C.OnClaimsDetailScrn() Then
            MsgBox "You need to be on the Claims Detail screen for this to work.", _
                vbExclamation, "Error."
            Exit Sub
        End If
        
        P.ScrapeInfo()

        ' Exit if policy is cancelled.
        If P.isCancelled Then
            MsgBox "Policy is cancelled, no action needed!", _
                vbExclamation, "[M.] Policy Cancelled"
            Exit Sub
        End If

        ' Advise action based on claim data.
        Me.AdviseAction()
    End Sub

    ' Basically just does the entire PA auto flowchart...
    Sub AdviseAction()
        Dim Claim
        Set Claim = New Claim

        Dim Action, ActionTaken, Comment
        Set Action = CreateObject("Scripting.Dictionary")
        ActionTaken = True
        
        Claim.ScrapeClaimDetails()
        ' Begin flowchart.
        If Claim.isMedOnly() Then
            Comment = Claim.ClaimNumber & " " & Claim.DOL & " Med Only, No Action."
            Action("Title") = "[M.] MED ONLY"
            Action("Type") = vbInformation
            Action("Text") = _
                "FLOWCHART TRACE:" & vbCrLf & _
                "1. Loss type: Med Only" & vbCrLf & vbCrLf & _
                "ACTION:" & vbCrLf & _
                "1. No action. Note PUCM." & vbCrLf & vbCrLf & _
                "CLIPBOARD (PUCM):" & vbCrLf & _
                Comment

        ElseIf Claim.isGlassLoss() Then
            Comment = Claim.ClaimNumber & " " & Claim.DOL & " Glass Loss, No Action."
            Action("Title") = "[O.] GLASS LOSS ONLY"
            Action("Type") = vbInformation
            Action("Text") = _
                "FLOWCHART TRACE:" & vbCrLf & _
                "1. Loss type: Glass Loss Only" & vbCrLf & vbCrLf & _
                "ACTION:" & vbCrLf & _
                "1. No action. Note PUCM." & vbCrLf & vbCrLf & _
                "CLIPBOARD (PUCM):" & vbCrLf & _
                Comment

        ElseIf Claim.isRoadsideAssistanceLoss() Then
            Comment = Claim.ClaimNumber & " " & Claim.DOL & " Roadside Assistance Loss, No Action."
            Action("Title") = "[P.] ROADSIDE ASSISTANCE ONLY"
            Action("Type") = vbInformation
            Action("Text") = _
                "FLOWCHART TRACE:" & vbCrLf & _
                "1. Loss type: Roadside Assistance Only" & vbCrLf & vbCrLf & _
                "ACTION:" & vbCrLf & _
                "1. No action. Note PUCM." & vbCrLf & vbCrLf & _
                "CLIPBOARD (PUCM):" & vbCrLf & _
                Comment

        ElseIf Claim.isNoDriver() Then
            Comment = Claim.ClaimNumber & " " & Claim.DOL & " No Driver " & Claim.FaultRating & ", No Action."
            Action("Title") = "[A.] NO DRIVER"
            Action("Type") = vbInformation
            Action("Text") = _
                "FLOWCHART TRACE:" & vbCrLf & _
                "1. Driver on claim: No (ND)" & vbCrLf & vbCrLf & _
                "ACTION:" & vbCrLf & _
                "1. No action. Note PUCM." & vbCrLf & vbCrLf & _
                "CLIPBOARD (PUCM):" & vbCrLf & _
                Comment

        ElseIf Claim.isDefaultDriver() Then
            Comment = Claim.ClaimNumber & ", Sent Unknown Driver email for NAME_HERE, driver in " & Claim.DOL & " loss."
            Action("Title") = "[B.] DEFAULT DRIVER"
            Action("Type") = vbInformation
            Action("Text") = _
                "FLOWCHART TRACE:" & vbCrLf & _
                "1. Driver on claim: Default Driver (DD)" & vbCrLf & _
                "2. Driver listed on policy: Unknown / needs verification" & vbCrLf & vbCrLf & _
                "ACTION:" & vbCrLf & _
                "1. Check ECC/PUDR for driver name." & vbCrLf & _
                "2. If not listed, begin Claim by Unknown Driver procedure." & vbCrLf & _
                "3. If listed, continue flowchart as normal." & vbCrLf & vbCrLf & _
                "CLIPBOARD (DIARY):" & vbCrLf & _
                Comment

        ElseIf Claim.isStolenVehicle() Then
            Comment = Claim.ClaimNumber & " " & Claim.DOL & " " & Claim.FaultRating & ", Refer to UW - Stolen vehicle."
            Action("Title") = "[L.] STOLEN VEHICLE"
            Action("Type") = vbInformation
            Action("Text") = _
                "FLOWCHART TRACE:" & vbCrLf & _
                "1. Always refer condition: Stolen vehicle (SN)" & vbCrLf & vbCrLf & _
                "ACTION:" & vbCrLf & _
                "1. Refer to underwriter. Note PUCM." & vbCrLf & vbCrLf & _
                "CLIPBOARD (PUCM):" & vbCrLf & _
                Comment

        ElseIf Claim.isNoFaultRating() Then
            Comment = Claim.ClaimNumber
            Action("Title") = "[Q.] NO FAULT RATING"
            Action("Type") = vbInformation
            Action("Text") = _
                "FLOWCHART TRACE:" & vbCrLf & _
                "1. Fault rating: Missing / Unknown (UN or blank)" & vbCrLf & vbCrLf & _
                "ACTION:" & vbCrLf & _
                "1. Check rating in ECC." & vbCrLf & _
                "2. If rating absent, diary out for a month." & vbCrLf & _
                "3. If rating present in ECC, continue the flowchart." & vbCrLf & vbCrLf & _
                "CLIPBOARD (CLAIM #):" & vbCrLf & _
                Comment

        Else
            On Error Resume Next
            Err.Clear
            Claim.ScrapeDriverData()
            If Err.Number <> 0 Then
                Err.Clear
                Comment = Claim.ClaimNumber
                Action("Title") = "[?.] DRIVER NUMBER EMPTY!?"
                Action("Type") = vbInformation
                Action("Text") = _
                    "FLOWCHART TRACE:" & vbCrLf & _
                    "1. Driver on claim: Present (" & Claim.DriverNum & ")" & vbCrLf & _
                    "2. Driver listed on policy: Not found under that number" & vbCrLf & vbCrLf & _
                    "DETAIL:" & vbCrLf & _
                    "Claim shows driver number """ & Claim.DriverNum & """ but there is nobody listed under that number." & vbCrLf & vbCrLf & _
                    "ACTION:" & vbCrLf & _
                    "1. Find the driver's name in ECC, check PUDR if they are listed." & vbCrLf & _
                    "2. If the driver is listed, continue the flowchart as normal." & vbCrLf & _
                    "3. If not, begin the Unknown Driver procedure." & vbCrLf & vbCrLf & _
                    "CLIPBOARD (CLAIM #):" & vbCrLf & _
                    Comment
            Else
                ActionTaken = False
            End If
            On Error GoTo 0
        End If

        If Not ActionTaken Then
            If Claim.isNotAtFault() Then
                Comment = Claim.ClaimNumber & " " & Claim.DOL & " " & Claim.Driver.Name & " " & Claim.FaultRating & ", No Action."
                Action("Title") = "[C.] NOT AT FAULT"
                Action("Type") = vbInformation
                Action("Text") = _
                    "FLOWCHART TRACE:" & vbCrLf & _
                    "1. Fault rating: Not at Fault (NF)" & vbCrLf & vbCrLf & _
                    "ACTION:" & vbCrLf & _
                    "1. No action. Note PUCM." & vbCrLf & vbCrLf & _
                    "CLIPBOARD (PUCM):" & vbCrLf & _
                    Comment

            ElseIf Claim.isAtFault() Then
                ' Scrape recent claims. Needed to continue the flowchart.
                P.ScrapeRecentClaims()
                
                If P.AFACount = 1 Then
                    If Claim.isLossWithinFirst60Days() Then
                        Comment = Claim.ClaimNumber & " " & Claim.DOL & " " & Claim.Driver.Name & " " & Claim.FaultRating & ", Refer to UW - Loss within 60 days of policy inception."
                        Action("Title") = "[K.] LOSS WITHIN 60 DAYS"
                        Action("Type") = vbInformation
                        Action("Text") = _
                            "FLOWCHART TRACE:" & vbCrLf & _
                            "1. Fault rating: At Fault (AF)" & vbCrLf & _
                            "2. Total at-fault claims in past 3 yrs: One" & vbCrLf & _
                            "3. Loss within first 60 days since policy inception: Yes" & vbCrLf & vbCrLf & _
                            "ACTION:" & vbCrLf & _
                            "1. Refer to underwriter. Note PUCM." & vbCrLf & vbCrLf & _
                            "CLIPBOARD (PUCM):" & vbCrLf & _
                            Comment
                    Else
                        If Claim.Driver.isYouthfulDriver() Then
                            Comment = Claim.ClaimNumber & " " & Claim.DOL & " " & Claim.Driver.Name & " " & Claim.FaultRating & ", Sent SWL06 Letter - Youthful Driver."
                            Action("Title") = "[I.] SEND SWL06 LETTER"
                            Action("Type") = vbInformation
                            Action("Text") = _
                                "FLOWCHART TRACE:" & vbCrLf & _
                                "1. Fault rating: At Fault (AF)" & vbCrLf & _
                                "2. Total at-fault claims in past 3 yrs: One" & vbCrLf & _
                                "3. Loss within first 60 days since policy inception: No" & vbCrLf & _
                                "4. Driver youthful (age 16-19): Yes" & vbCrLf & vbCrLf & _
                                "ACTION:" & vbCrLf & _
                                "1. Send SWL06 letter. Note PUCM." & vbCrLf & vbCrLf & _
                                "CLIPBOARD (PUCM):" & vbCrLf & _
                                Comment
                        Else
                            Comment = Claim.ClaimNumber & " " & Claim.DOL & " " & Claim.Driver.Name & " " & Claim.FaultRating & ", No action."
                            Action("Title") = "[J.] AT FAULT"
                            Action("Type") = vbInformation
                            Action("Text") = _
                                "FLOWCHART TRACE:" & vbCrLf & _
                                "1. Fault rating: At Fault (AF)" & vbCrLf & _
                                "2. Total at-fault claims in past 3 yrs: One" & vbCrLf & _
                                "3. Loss within first 60 days since policy inception: No" & vbCrLf & _
                                "4. Driver youthful (age 16-19): No" & vbCrLf & vbCrLf & _
                                "ACTION:" & vbCrLf & _
                                "1. No action. Note PUCM." & vbCrLf & vbCrLf & _
                                "CLIPBOARD (PUCM):" & vbCrLf & _
                                Comment
                        End If
                    End If

                ElseIf P.AFACount >= 2 Then
                    ' Get highest losses by the same driver.
                    Dim MaxCount, MostCommonValue
                    T.GetMostCommonDriverNum P.RecentAFAClaims, MaxCount, MostCommonValue

                    ' If there's a driver with 2+ losses.
                    If MaxCount >= 2 Then
                        Dim CommonDriver

                        ' Dont rescrape info if we already have it.
                        If (MostCommonValue = Claim.Driver.Number) Then
                            Set CommonDriver = Claim.Driver
                        Else
                            Set CommonDriver = C.GetDriverDetailsFromPUDR(MostCommonValue)
                            C.GoToClaim Claim.ClaimNumber
                        End If

                        ' If common driver is named insured or spouse.
                        If CommonDriver.isNamedInsuredOrSpouse() Then
                            If Claim.isPolicyWithin4MonthsOfRenewal() Then
                                Comment = Claim.ClaimNumber & " " & Claim.DOL & " " & Claim.Driver.Name & " " & Claim.FaultRating & ", Refer to UW - 2+ AFA by same driver within 3 yrs of renewal."
                                Action("Title") = "[F.] AT FAULT"
                                Action("Type") = vbInformation
                                Action("Text") = _
                                    "FLOWCHART TRACE:" & vbCrLf & _
                                    "1. Fault rating: At Fault (AF)" & vbCrLf & _
                                    "2. Total at-fault claims in past 3 yrs: Two or More" & vbCrLf & _
                                    "3. Losses by same driver: Yes (2+ by one driver)" & vbCrLf & _
                                    "4. Driver is named insured or spouse: Yes" & vbCrLf & _
                                    "5. Policy renewal within 4 months: Yes" & vbCrLf & vbCrLf & _
                                    "ACTION:" & vbCrLf & _
                                    "1. Refer to UW in PORTA & note PUCM." & vbCrLf & _
                                    "2. Refer Reason: 2 AT FAULT ACCIDENTS WITHIN 3 YEARS; UP FOR RENEWAL" & vbCrLf & vbCrLf & _
                                    "CLIPBOARD (PUCM):" & vbCrLf & _
                                    Comment

                                Action("Text") = _
                                    "FLOWCHART TRACE:" & vbCrLf & _
                                    "1. Fault rating: At Fault (AF)" & vbCrLf & _
                                    "2. Total at-fault claims in past 3 yrs: Two or More" & vbCrLf & _
                                    "3. Losses by same driver: Yes (2+ by one driver)" & vbCrLf & _
                                    "4. Driver is named insured or spouse: Yes" & vbCrLf & _
                                    "5. Policy renewal within 4 months: Yes" & vbCrLf & vbCrLf & _
                                    "ACTION:" & vbCrLf & _
                                    "1. Refer to UW in PORTA & note PUCM." & vbCrLf & _
                                    "2. Refer Reason: 2 AT FAULT ACCIDENTS WITHIN 3 YEARS; UP FOR RENEWAL" & vbCrLf & vbCrLf & _
                                    "CLIPBOARD (PUCM):" & vbCrLf & _
                                    Comment
                            Else
                                Comment = Claim.ClaimNumber & " " & Claim.DOL & " " & Claim.Driver.Name & " " & Claim.FaultRating & ", Set FS for UW to review for PCM - 2+ AFA by same driver within 3 yrs of renewal."
                                Action("Title") = "[D.] AT FAULT"
                                Action("Type") = vbInformation
                                Action("Text") = _
                                    "FLOWCHART TRACE:" & vbCrLf & _
                                    "1. Fault rating: At Fault (AF)" & vbCrLf & _
                                    "2. Total at-fault claims in past 3 yrs: Two or More" & vbCrLf & _
                                    "3. Losses by same driver: Yes (2+ by one driver)" & vbCrLf & _
                                    "4. Driver is named insured or spouse: Yes" & vbCrLf & _
                                    "5. Policy renewal within 4 months: No" & vbCrLf & vbCrLf & _
                                    "ACTION:" & vbCrLf & _
                                    "1. Set FS 4 months prior for UW to review for PCM. Note PUCM." & vbCrLf & vbCrLf & _
                                    "CLIPBOARD (PUCM):" & vbCrLf & _
                                    Comment
                            End If

                            ' If common driver is not named insured or spouse.
                        Else
                            Comment = Claim.ClaimNumber & " " & Claim.DOL & " " & Claim.Driver.Name & " " & Claim.FaultRating & ", Refer to UW - 2+ AFA within 3 yrs of renewal by same driver, not named insured or spouse."
                            Action("Title") = "[H.] At FAULT"
                            Action("Type") = vbInformation
                            Action("Text") = _
                                "FLOWCHART TRACE:" & vbCrLf & _
                                "1. Fault rating: At Fault (AF)" & vbCrLf & _
                                "2. Total at-fault claims in past 3 yrs: Two or More" & vbCrLf & _
                                "3. Losses by same driver: Yes (2+ by one driver)" & vbCrLf & _
                                "4. Driver is named insured or spouse: No" & vbCrLf & _
                                "5. Policy renewal within 4 months: Yes" & vbCrLf & vbCrLf & _
                                "ACTION:" & vbCrLf & _
                                "1. Refer to underwriter. Note PUCM." & vbCrLf & vbCrLf & _
                                "CLIPBOARD (PUCM):" & vbCrLf & _
                                Comment
                        End If

                        ' Different drivers (no driver with 2+ AFA losses).
                    Else
                        ' If renewal is in less than 4 months.
                        ' _MARKER_01_
                        If Claim.isPolicyWithin4MonthsOfRenewal() Then
                            Comment = Claim.ClaimNumber & " " & Claim.DOL & " " & Claim.Driver.Name & " " & Claim.FaultRating & ", Refer to UW - 2+ AFA by different drivers within 3 yrs of renewal."
                            Action("Title") = "[G.] AT FAULT"
                            Action("Type") = vbInformation
                            Action("Text") = _
                                "FLOWCHART TRACE:" & vbCrLf & _
                                "1. Fault rating: At Fault (AF)" & vbCrLf & _
                                "2. Total at-fault claims in past 3 yrs: Two or More" & vbCrLf & _
                                "3. Losses by same driver: No (different drivers)" & vbCrLf & _
                                "4. Policy renewal within 4 months: Yes" & vbCrLf & vbCrLf & _
                                "ACTION:" & vbCrLf & _
                                "1. Refer to underwriter. Note PUCM." & vbCrLf & vbCrLf & _
                                "CLIPBOARD (PUCM):" & vbCrLf & _
                                Comment

                            ' If renewal is not within 4 months.
                        Else
                            Comment = Claim.ClaimNumber & " " & Claim.DOL & " " & Claim.Driver.Name & " " & Claim.FaultRating & ", Set FS for UW to review for PCM - 2+ AFA by different drivers within 3 yrs of renewal."
                            Action("Title") = "[E.] AT FAULT"
                            Action("Type") = vbInformation
                            Action("Text") = _
                                "FLOWCHART TRACE:" & vbCrLf & _
                                "1. Fault rating: At Fault (AF)" & vbCrLf & _
                                "2. Total at-fault claims in past 3 yrs: Two or More" & vbCrLf & _
                                "3. Losses by same driver: No (different drivers)" & vbCrLf & _
                                "4. Policy renewal within 4 months: No" & vbCrLf & vbCrLf & _
                                "ACTION:" & vbCrLf & _
                                "1. Set FS to review PCM 4 months prior. Note PUCM." & vbCrLf & vbCrLf & _
                                "CLIPBOARD (PUCM):" & vbCrLf & _
                                Comment
                        End If
                    End If
                End If

            Else
                Err.Raise 1000, "AdviseAction Function", "Some edge case was not handled. Uh oh... send this claim number to the developer (Isaac Trost) on teams."
            End If
        End If
        
        ' MsgBox P.ToString()
        C.GoToClaim(Claim.ClaimNumber)
        T.CopyToClipboard(Comment)
        MsgBox Action("Text"), Action("Type"), Action("Title")
    End Sub


End Class

Class Policy
    Public Number
    Public StartDate
    Public RenewalDate
    Public isCancelled
    Public RecentClaims

    ' Scrapes policy number, start date, and renewal date from a claims detail screen.
    Public Sub ScrapeInfo()
        Me.Number = C.PolicyNumber()
        Me.StartDate = C.StartDate()
        Me.RenewalDate = T.GetRenewalFromStart(Me.StartDate)
        Me.isCancelled = C.PolicyCancelled()
    End Sub
    
    Public Sub ScrapeRecentClaims()
        Me.RecentClaims = C.GetRecentClaims()
    End Sub
    
    Public Property Get RecentAFAClaims()
        Dim AFAs()
        Dim idx, i
        
        idx = - 1
        ReDim AFAs( - 1)
        
        If Not IsArray(Me.RecentClaims) Then
            RecentAFAClaims = AFAs
            Exit Property
        End If
        
        For i = LBound(Me.RecentClaims) To UBound(Me.RecentClaims)
            If IsObject(Me.RecentClaims(i)) Then
                If Me.RecentClaims(i).FaultRating = "AF" Then
                    idx = idx + 1
                    ReDim Preserve AFAs(idx)
                    Set AFAs(idx) = Me.RecentClaims(i)
                End If
            End If
        Next
        
        RecentAFAClaims = AFAs
    End Property
    
    Public Property Get AFACount()
        AFACount = T.ArrayLen(Me.RecentAFAClaims)
    End Property
End Class

Class Claim
    Public ClaimNumber
    Public Description
    Public DriverNum
    Public FaultRating
    Public DOL
    Public StartDate
    Public RenewalDate
    Public Causes
    Public Driver

    ' NOTES
    '  - Known med-only properties:
    '     - Desc:
    '       - PIP ONLY, MED ONLY
    '     - Causes:
    '        - FPBMED, FPBINC
    '  - Known towing/roadside assistance properties:
    '     - Desc:
    '        - ROADSIDE ASSISTANCE LOSS, TOWING
    '     - Causes:
    '        - RSDRVC

    Public Sub ScrapeClaimDetails()
        If Not C.OnClaimsDetailScrn Then
            Err.Raise 0, "Claim Class, ScrapeAndInit()", "Not on claim detail screen."
        End If

        Me.ClaimNumber = C.ClaimNumber()
        Me.Description = C.Description()
        Me.DriverNum = C.DriverNum()
        Me.FaultRating = C.FaultRating()
        Me.DOL = C.DOL()
        Me.StartDate = C.StartDate()
        Me.RenewalDate = T.GetRenewalFromStart(Me.StartDate)
        Me.Causes = C.Causes()
    End Sub
    Public Sub ScrapeDriverData()
        If IsNumeric(Me.DriverNum) Then
            Set Driver = C.GetDriverDetailsFromPUDR(Me.DriverNum)
        End If
    End Sub
    Public Property Get isPolicyWithin4MonthsOfRenewal
        isPolicyWithin4MonthsOfRenewal = T.AreDatesWithin(Me.RenewalDate, Date, 0, 4, 0)
    End Property
    Public Property Get isLossWithinFirst60Days()
        isLossWithinFirst60Days = T.AreDatesWithin(Me.StartDate, Me.DOL, 0, 0, 60)
    End Property
    Public Property Get isNoDriver()
        isNoDriver = (Me.DriverNum = "ND")
    End Property
    Public Property Get isDefaultDriver()
        isDefaultDriver = (Me.DriverNum = "DD")
    End Property
    Public Property Get isStolenVehicle()
        isStolenVehicle = (Me.DriverNum = "SN")
    End Property
    Public Property Get isNotAtFault()
        isNotAtFault = (Me.FaultRating = "NF")
    End Property
    Public Property Get isAtFault()
        isAtFault = (Me.FaultRating = "AF")
    End Property
    Public Property Get isNoFaultRating()
        isNoFaultRating = (Me.FaultRating = "UN" Or Me.FaultRating = "")
    End Property
    Public Property Get isRoadsideAssistanceLoss()
        isRoadsideAssistanceLoss = False
        If Me.Description = "ROADSIDE ASSISTANCE LOSS" Then
            isRoadsideAssistanceLoss = True
            ' TODO: Update the secondary check by gathering a list of known 
            ' roadside assistance loss cause codes. The only known one as of 
            ' right now is RSDRVC.
        Else
            Dim Cause
            For Each Cause In Me.Causes
                If Cause <> "RSDRVC" Then
                    isRoadsideAssistanceLoss = False
                    Exit For
                End If
            Next
        End If
    End Property
    Public Property Get isGlassLoss()
        isGlassLoss = False
        If Me.Description = "GLASS LOSS" Then
            isGlassLoss = True
            ' TODO: Implement a secondary, more thorough check by comparing 
            ' the cause list against a list of known glass loss cause codes.
        End If
    End Property
    Public Property Get isMedOnly()
        Dim MedOnly
        MedOnly = True
        If Me.Description <> "PIP ONLY" Then
            Dim Cause
            For Each Cause In Me.Causes
                If Cause <> "FPBMED" Then
                    MedOnly = False
                    Exit For
                End If
            Next
        End If
        isMedOnly = MedOnly
    End Property
End Class

Class Driver
    Public Name
    Public Age
    Public Number
    Public Relationship

    Public Sub Init(pNumber, pName, pAge, pRelationship)
        Me.Number = pNumber
        Me.Name = pName
        Me.Age = pAge
        Me.Relationship = pRelationship
    End Sub

    Public Property Get isYouthfulDriver()
        isYouthfulDriver = (Me.Age >= 16 And Me.Age <= 19)
    End Property

    Public Property Get isNamedInsuredOrSpouse()
        isNamedInsuredOrSpouse = (Me.Relationship = "I" Or Me.Relationship = "S")
    End Property
End Class

Class Tools
    Function ArrayLen(arr)
        If Not IsArray(arr) Then
            ArrayLen = 0
            Exit Function
        End If
        ArrayLen = UBound(arr) - LBound(arr) + 1
    End Function
    ' Computes age in years from DOB.
    Public Function AgeFromBirth(Birth)
        Dim DOB
        DOB = T.ParseMMDDYYYY(Birth)
        AgeFromBirth = DateDiff("yyyy", DOB, Date)

        'If birthday hasn't occurred yet this year, subtract 1.
        If DateSerial(Year(Date), Month(DOB), Day(DOB)) > Date Then
            AgeFromBirth = AgeFromBirth - 1
        End If
    End Function
    Function RS(Len, row, col)
        Dim buf
        buf = String(Len, " ") ' pre-size helps avoid odd blanks sometimes
        MFScreen.ReadScreen buf, Len, row, col
        RS = Trim(buf)
    End Function
    Sub GetMostCommonDriverNum(ClaimsArr, ByRef MaxCount, ByRef MostCommonValue)
        Dim Counts, I, Key
        Set Counts = CreateObject("Scripting.Dictionary")
        MaxCount = 0
        MostCommonValue = Empty
        For I = LBound(ClaimsArr) To UBound(ClaimsArr)
            Key = CStr(ClaimsArr(I).DriverNum)
            If Counts.Exists(Key) Then
                Counts(Key) = Counts(Key) + 1
            Else
                Counts.Add Key, 1
            End If
            If Counts(Key) > MaxCount Then
                MaxCount = Counts(Key)
                MostCommonValue = Key
            End If
        Next
    End Sub
    Function AreDatesWithin(Date1, Date2, Years, Months, Days)
        ' Return true if dates are within a given time frame.
        Dim maxDate, minDate
        
        ' Build the allowed range from date1
        maxDate = DateAdd("d", Days, _
            DateAdd("m", Months, _
            DateAdd("yyyy", Years, Date1)))
        
        minDate = DateAdd("d", - Days, _
            DateAdd("m", - Months, _
            DateAdd("yyyy", - Years, Date1)))
        
        ' Check if Date2 falls within the range
        AreDatesWithin = (Date2 >= minDate And Date2 <= maxDate)
    End Function
    Function GetRenewalFromStart(StartDate)
        ' Calculate and return renewal date from the start date.
        Do While StartDate < Date
            StartDate = DateAdd("yyyy", 1, StartDate)
        Loop

        GetRenewalFromStart = StartDate
    End Function
    ' Copy text to clipboard.
    Sub CopyToClipboard(text)
        Dim html
        Set html = CreateObject("htmlfile")
        html.ParentWindow.ClipboardData.SetData "text", CStr(text)
    End Sub
    Public Function ParseMMDDYY(s)
        ' Parse MM-DD-YY dates to Date objects.
        Dim m, d, y
        s = Trim(s) ' Remove whitespace.
        m = CInt(Mid(s, 1, 2))
        d = CInt(Mid(s, 4, 2))
        y = CInt(Mid(s, 7, 2))
        ParseMMDDYY = DateSerial(y, m, d)
    End Function
    Public Function ParseMMDDYYYY(s)
        ' Parse MMDDYYYY dates to Date objects.
        Dim m, d, y
        s = Trim(s) ' Remove whitespace.
        m = CInt(Mid(s, 1, 2))
        d = CInt(Mid(s, 3, 2))
        y = CInt(Mid(s, 5, 4))
        ParseMMDDYYYY = DateSerial(y, m, d)
    End Function
End Class

Class ClaimsController
    ' Scrape all claims within three years of policy renewal.
    Public Function GetRecentClaims()
        ' Initial claim to return to after function.
        Dim InitialClaim
        InitialClaim = C.ClaimNumber()

        Dim Claims()
        ReDim Claims( - 1)

        Me.GoToPolicy "PUUR"
        MFScreen.SendKeys("A<Enter>")

        Do While Me.OnClaimsDetailScrn()
            MFScreen.WaitReady 1, 0

            Dim CurrentClaim, Claim
            CurrentClaim = C.ClaimNumber()
            Set Claim = New Claim
            Claim.ScrapeClaimDetails

            Dim DOLWithinRenewal
            DOLWithinRenewal = T.AreDatesWithin(P.RenewalDate, Claim.DOL, 3, 0, 0)
            If DOLWithinRenewal Then
                ReDim Preserve Claims(UBound(Claims) + 1)
                Set Claims(UBound(Claims)) = Claim
            Else
                Exit Do
            End If
            
            MFScreen.SendKeys("<Enter>")
        Loop
        ' Return to initial claim.
        Me.GoToClaim InitialClaim
        GetRecentClaims = Claims
    End Function
    
    Public Function Causes()
        ' Create empty array.
        Dim CausesArr()
        ReDim CausesArr( - 1)
        
        ' Scrape causes.
        Dim i, Spillage
        Spillage = True ' If causes spill to the next page.
        Do While (Spillage = True)
            For i = 0 To 6 Step 2
                Dim CauseLabel, Cause
                CauseLabel = T.RS(6, 12 + i, 22)
                If (CauseLabel = "CAUSE:") Then
                    Cause = Trim(T.RS(12, 12 + i, 29))
                    ReDim Preserve CausesArr(UBound(CausesArr) + 1)
                    CausesArr(UBound(CausesArr)) = Cause
                Else
                    Spillage = False
                    Exit For
                End If
            Next
            If Spillage Then
                MFScreen.SendKeys("<Enter>")
            End If
        Loop
        Causes = CausesArr
    End Function

    Public Function Description()
        Description = T.RS(61, 8, 19)
    End Function

    Public Function PolicyNumber()
        ' Scrape policy number from screen.
        PolicyNumber = T.RS(11, 2, 8)
    End Function
    
    Public Function ClaimNumber()
        ' Scrape claim number from screen.
        ClaimNumber = T.RS(12, 7, 10)
    End Function
    
    Public Function DOL()
        ' Scrape date of loss from screen.
        DOL = T.ParseMMDDYY(T.RS(8, 9, 20))
    End Function
    
    Public Function DriverNum()
        ' Scrape driver number from screen.
        DriverNum = T.RS(2, 10, 34)
    End Function
    
    Public Function FaultRating()
        ' Scrape fault rating from screen.
        FaultRating = T.RS(2, 10, 36)
    End Function
    
    Public Function StartDate()
        ' Scrape start date from screen.
        StartDate = T.ParseMMDDYY(T.RS(8, 2, 73))
    End Function
    
    Public Function PolicyCancelled()
        ' Check if policy is cancelled.
        PolicyCancelled = (T.RS(9, 6, 56) = "CANCELLED")
    End Function
    
    Public Function OnClaimsScrn()
        ' Check if on the claims screen (not to be confused w/ claims detail screen).
        ' Returns true if on claims screen.
        OnClaimsScrn = (T.RS(18, 6, 31) = "SECTION I - CLAIMS")
    End Function
    
    Public Function OnClaimsDetailScrn()
        ' Check if on the claims detail screen.
        ' Returns true if currently on claims detail screen.
        OnClaimsDetailScrn = (T.RS(28, 6, 26) = "SECTION I - CLAIMS  (DETAIL)")
    End Function
    
    Public Function GoToPolicy(Screen)
        MFScreen.WaitReady 1, 0
        MFScreen.SendKeys("<Clear>" & Screen & " " & P.Number & "<Enter>")
        MFScreen.WaitReady 1, 0
    End Function
    
    Public Function GoToClaim(ClaimNumber)
        ' Navigates to a given claim on a policy.
        ' Go to PUBC screen for the policy.
        Me.GoToPolicy "PUUR"

        ' View first policy.
        MFScreen.SendKeys("A<Enter>")

        ' Go to the next claim until its the one we want.
        Do While C.ClaimNumber <> ClaimNumber
            MFScreen.WaitReady 1, 0
            MFScreen.SendKeys("<Enter>")
        Loop
    End Function
    
    Public Function GetDriverDetailsFromPUDR(DriverNumStr)
        ' Get driver name, age, and driver number from PUDR.
        ' Returns dict object.
        MFScreen.SendKeys("<Clear>PUDR " & P.Number & "<Enter>")
        While True
            MFScreen.WaitReady 1, 0
            Dim i
            For i = 0 To 2
                ' Initialize variables.
                Dim Driver, Number, Name, Birth, Age, Relationship, IsDriverNumberEmpty
                Set Driver = New Driver
                
                ' Scrape values from screen.
                Number = T.RS(2, 4 + i, 2)
                Name = T.RS(31, 4 + i, 7)
                Birth = T.RS(8, 4 + i, 62)
                Relationship = T.RS(1, 9 + i, 72)

                ' Trim name.
                Name = Trim(Name)

                ' Check for ghost driver! (No driver listed as the given driver number.)
                IsDriverNumberEmpty = (Name <> "" And Birth <> "" And Relationship <> "")
                If ( Not IsDriverNumberEmpty) Then
                    Err.Raise 123, "DriverNumberEmpty", "No driver listed under driver number " & DriverNumStr & "."
                End If

                ' If target driver, create driver object w/ data and return it.
                If (Number = DriverNumStr) Then
                    Age = T.AgeFromBirth(Birth)
                    Driver.Init Number, Name, Age, Relationship
                    Set GetDriverDetailsFromPUDR = Driver
                    Exit Function
                End If
            Next
            MFScreen.SendKeys "<Enter>"
        Wend
    End Function
End Class