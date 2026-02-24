// ==UserScript==
// @name         Custom Mainframe Script Buttons (Core)
// @version      2026-01-15
// @description  Core buttons: BlueZone .bbs wrapper downloads + Go To PUUR Claim (LOB-aware display) + PA Home passes POLICY/DATE from #taskDescription
// @author       Isaac Trost & Blaine Oler
// @match        http://erieweb/UnderwritingPortal/Home/ViewItem*
// @run-at       document-end
// @grant        none
// ==/UserScript==

"use strict";

/**
 * Buttons
 * - PA Home now downloads a .bbs wrapper that:
 *    1) reads POLICY + NOTE_DATE strictly from #taskDescription text
 *    2) writes %TEMP%\pa_home_context.txt
 *    3) runs the PaHome.vbs using wscript.exe
 */
const CUSTOM_MAINFRAME_BUTTONS = [
  {
    id: "script1",
    label: "PA Automater",
    action: "downloadFromPath",
    filePath: "I:\\Apprentice's Scripts\\pa-automater-3000.vbs",
  },
  {
    id: "script2",
    label: "Check for 3rd Year",
    action: "downloadFromPath",
    filePath: "I:\\Apprentice's Scripts\\3YearLossScope.vbs",
  },
  {
    id: "goToPuurClaim",
    label: "Go To PUUR Claim",
    action: "goToPUURClaim",
  },
  {
    id: "script3",
    label: "Commercial Auto",
    action: "downloadFromPath",
    filePath: "I:\\Apprentice's Scripts\\CommercialAuto.vbs",
  },
  {
    id: "script4",
    label: "Pa Home",
    action: "downloadPaHomeBbs",
    filePath: "I:\\Apprentice's Scripts\\PaHome.vbs", // the VBS file that contains your mainframe logic
  },
];

/**
 * Display rules:
 * - If APV: ONLY show PA Automater + Go To PUUR Claim
 * - If HP:  ONLY show Pa Home
 * - If ACV, AGV, AFV: ONLY show Commercial Auto
 * - Else: show ALL buttons
 */
const APV_ONLY_BUTTON_IDS = new Set(["script1", "goToPuurClaim"]);
const HP_ONLY_BUTTON_IDS = new Set(["script4"]);
const COM_ONLY_BUTTON_IDS = new Set(["script3"]);

/**
 * Values we consider valid to drive the button display logic.
 * We only trust extractClaimType() if it produces one of these.
 */
const VALID_LOB_VALUES = new Set(["APV", "HP", "ACV", "AGV", "AFV"]);

/* ---------------------------
 * Utilities
 * ------------------------- */
function downloadTextFile({ content, downloadName }) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = downloadName;
  document.body.appendChild(a);
  a.click();

  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function baseNameNoExt(path) {
  return path
    .split(/[\\/]/)
    .pop()
    .replace(/\.[^.]+$/, "");
}

/* ---------------------------
 * Portal data extraction
 * ------------------------- */

/**
 * Header policy number (big one in ViewItem header)
 * Kept for LOB lookup logic only.
 */
function getHeaderPolicyNumber() {
  const headerPolicyEl = document.querySelector("div.row.Form-header > label");
  return headerPolicyEl?.innerText?.trim() || "";
}

/**
 * Claim number from taskDescription (for PUUR Claim)
 * We keep the old behavior but make it more robust.
 */
function getClaimNumber() {
  const taskEl = document.querySelector("#taskDescription");
  const text = (taskEl?.textContent || "").replace(/\s+/g, " ").trim();
  // historically claim number is first token; keep but sanitize
  return text.split(" ")[0]?.trim() || "";
}

/**
 * STRICT: POLICY + NOTE_DATE for notes must come from:
 *   <label id="taskDescription">A00007318366 12/15/2025</label>
 *
 * This prevents "wrong number" issues caused by mixing sources.
 */
function getTaskPolicyAndDate() {
  const el = document.querySelector("#taskDescription");
  const raw = (el?.textContent || "").replace(/\s+/g, " ").trim();

  // Policy like: A00007318366
  const policyMatch = raw.match(/\bA\d+\b/i);

  // Date like: 12/15/2025 (supports 1-2 digit month/day)
  const dateMatch = raw.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/);

  return {
    policy: policyMatch ? policyMatch[0].trim() : "",
    noteDate: dateMatch ? dateMatch[0].trim() : "",
    raw,
  };
}


/**
 * Find LOB for the header policy in #AccountSnapshot table
 */
function getLobForPolicy(policyNumber) {
  if (!policyNumber) return "";

  const snapshot = document.querySelector("#AccountSnapshot");
  if (!snapshot) return "";

  const rows = snapshot.querySelectorAll("tbody tr");
  for (const row of rows) {
    const tds = row.querySelectorAll("td");
    const policyTd = tds?.[0]?.innerText?.trim() || "";
    const lobTd = tds?.[2]?.innerText?.trim() || "";
    if (policyTd && policyTd === policyNumber) return lobTd;
  }
  return "";
}

/**
 * Extract claim type from the last <script> tag on the page.
 * Returns "APV", "HP", etc or null if not found.
 */
function extractClaimType() {
  const scripts = document.querySelectorAll("script");
  if (!scripts.length) return null;

  const lastScriptText = scripts[scripts.length - 1].textContent || "";
  const match = lastScriptText.match(/'([A-Za-z]+)'/);

  return match ? match[1] : null;
}

/**
 * Prefer LOB from the table; if missing/invalid, fall back to claim type extraction.
 */
function getEffectiveLob(policyNumber) {
  const lobFromTable = (getLobForPolicy(policyNumber) || "").trim();
  if (VALID_LOB_VALUES.has(lobFromTable)) return lobFromTable;

  const claimType = (extractClaimType() || "").trim();
  if (VALID_LOB_VALUES.has(claimType)) return claimType;

  return lobFromTable || claimType || "";
}

function getPortalContext() {
  const headerPolicyNumber = getHeaderPolicyNumber();
  const claimNumber = getClaimNumber();
  const lob = getEffectiveLob(headerPolicyNumber);

  // NOTE: for notes we will NOT use headerPolicyNumber; we use #taskDescription only.
  return { headerPolicyNumber, claimNumber, lob };
}

/* ---------------------------
 * BBS wrapper generation
 * ------------------------- */

function createBbsWrapperForPath(filePath) {
  return `Sub Main()
  Dim bzhao
  Set bzhao = CreateObject("BZWhll.WhllObj")
  bzhao.Connect
  bzhao.RunScript "${filePath}"
End Sub
`;
}

/**
 * PA Home wrapper:
 * - reads POLICY + NOTE_DATE strictly from #taskDescription
 * - writes %TEMP%\pa_home_context.txt
 * - runs the VBS via wscript.exe
 */
function createPaHomeBbsWrapper(vbsFilePath) {
  const { policy, noteDate, raw } = getTaskPolicyAndDate();

  if (!policy || !noteDate) {
    alert(
      `Pa Home: couldn't parse POLICY/DATE from #taskDescription.\n\n` +
        `Raw: "${raw}"\n\n` +
        `Expected: "A########### MM/DD/YYYY"`
    );
    return "";
  }

  // minimal script inside wrapper
  return `Sub Main()
  Dim sh, fso, tmp, ts, cmd
  Set sh = CreateObject("WScript.Shell")
  Set fso = CreateObject("Scripting.FileSystemObject")

  tmp = sh.ExpandEnvironmentStrings("%TEMP%") & "\\pa_home_context.txt"
  Set ts = fso.CreateTextFile(tmp, True)
  ts.WriteLine "POLICY=${policy}"
  ts.WriteLine "NOTE_DATE=${noteDate}"
  ts.Close

  cmd = "wscript.exe " & Chr(34) & "${vbsFilePath}" & Chr(34)
  sh.Run cmd, 1, False
End Sub
`;
}

function handleDownloadFromPath(btn) {
  if (!btn.filePath) {
    alert(`Button "${btn.label}" is missing filePath.`);
    return;
  }
  const content = createBbsWrapperForPath(btn.filePath);
  const downloadName = `${baseNameNoExt(btn.filePath)}.bbs`;
  downloadTextFile({ content, downloadName });
}

function handleDownloadPaHomeBbs(btn) {
  if (!btn.filePath) {
    alert(`Button "${btn.label}" is missing filePath.`);
    return;
  }
  const content = createPaHomeBbsWrapper(btn.filePath);
  if (!content) return;
  const downloadName = `${baseNameNoExt(btn.filePath)}.bbs`;
  downloadTextFile({ content, downloadName });
}

/* ---------------------------
 * Go To PUUR Claim (.bbs)
 * ------------------------- */
function createBbsGoToPUURClaim(policyNumber, claimNumber) {
  return `Option Explicit

Dim MFScreen As Object
Set MFScreen = CreateObject("BZWhll.WhllObj")

MFScreen.Connect ""
MFScreen.WaitReady 5, 0

Dim PolicyNumber, ClaimNumber
PolicyNumber = "${policyNumber}"
ClaimNumber  = "${claimNumber}"

Sub GoToClaim()
    Dim IsOnClaimsScreen, IsOnClaimsDetailScreen
    IsOnClaimsScreen = ReadAt(18, 6, 31)
    IsOnClaimsDetailScreen = ReadAt(28, 6, 26)
    If (IsOnClaimsDetailScreen) Then
        MFScreen.SendKeys "<PF4>"
    ElseIf Not (IsOnClaimsScreen) Then
        MFScreen.SendKeys "<Clear>PUUR " & PolicyNumber & "<Enter>"
        MFScreen.WaitReady 5, 1
    End If
    MFScreen.SendKeys "A<Enter>"
    MFScreen.WaitReady 5, 1
    Dim CurrentClaimNumber
    While True
        CurrentClaimNumber = GetClaimNum()
        If (CurrentClaimNumber = ClaimNumber) Then
            Exit Sub
        ElseIf (CurrentClaimNumber = "") Then
            Exit Sub
        Else
            MFScreen.SendKeys "<Enter>"
            MFScreen.WaitReady 5, 1
        End If
    Wend
End Sub

Function GetClaimNum()
    GetClaimNum = Trim(ReadAt(13, 7, 9))
End Function

Private Function ReadAt(length, row, col)
    Dim buf
    MFScreen.ReadScreen buf, length, row, col
    ReadAt = buf
End Function`;
}

function handleGoToPUURClaim(btn) {
  const { headerPolicyNumber, claimNumber } = getPortalContext();

  if (!headerPolicyNumber || !claimNumber) {
    alert(
      `Couldn't find policy/claim on this page.\n` +
        `Policy: "${headerPolicyNumber}"\nClaim: "${claimNumber}"`
    );
    return;
  }

  const content = createBbsGoToPUURClaim(headerPolicyNumber, claimNumber);
  const downloadName = `GoToPUUR_${claimNumber}.bbs`;
  downloadTextFile({ content, downloadName });
}

/* ---------------------------
 * Button rendering
 * ------------------------- */
const ACTIONS = {
  downloadFromPath: handleDownloadFromPath,
  downloadPaHomeBbs: handleDownloadPaHomeBbs,
  goToPUURClaim: handleGoToPUURClaim,
};

function handleButtonClick(btn) {
  const handler = ACTIONS[btn.action];
  if (!handler) {
    alert(
      `Unknown action "${btn.action}" for button "${btn.label}".\n` +
        `Valid actions: ${Object.keys(ACTIONS).join(", ")}`
    );
    return;
  }
  handler(btn);
}

function ensureCustomSection(mainframeRoot) {
  let section = mainframeRoot.querySelector("#tm-custom-mainframe-section");
  if (section) return section;

  section = document.createElement("div");
  section.id = "tm-custom-mainframe-section";
  section.className = "row top-buffer col-xs-12";
  section.style.marginTop = "10px";

  const label = document.createElement("label");
  label.className = "row paddingleftVI";
  label.textContent = "Custom Scripts";

  const innerRow = document.createElement("div");
  innerRow.className = "row paddingleftVI";

  const col = document.createElement("div");
  col.className = "col-xs-12 top-buffer";
  col.id = "tm-custom-mainframe-buttons";

  innerRow.appendChild(col);
  section.appendChild(label);
  section.appendChild(innerRow);

  const otherSystemsLabel = mainframeRoot.querySelector(
    "label.row.col-xs-12.paddingleftVI"
  );

  if (otherSystemsLabel) {
    otherSystemsLabel.parentElement.insertBefore(section, otherSystemsLabel);
  } else {
    mainframeRoot.appendChild(section);
  }

  return section;
}

function renderButtons(container, buttons) {
  container.innerHTML = "";

  buttons.forEach((btn) => {
    const form = document.createElement("form");
    form.action = "javascript:void(0)";
    form.method = "post";
    form.style.display = "inline-block";
    form.style.marginRight = "6px";
    form.style.marginBottom = "6px";

    const button = document.createElement("button");
    button.type = "button";
    button.id = btn.id;
    button.textContent = btn.label;
    button.className = "btn btn-primary-variant btn-mainframe";

    button.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        handleButtonClick(btn);
      },
      true
    );

    form.addEventListener(
      "submit",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      },
      true
    );

    form.appendChild(button);
    container.appendChild(form);
  });
}

function filterButtonsForLob(buttons, lob) {
  if (lob === "APV") return buttons.filter((b) => APV_ONLY_BUTTON_IDS.has(b.id));
  if (lob === "HP") return buttons.filter((b) => HP_ONLY_BUTTON_IDS.has(b.id));
  if (lob === "ACV" || lob === "AGV" || lob === "AFV") {
    return buttons.filter((b) => COM_ONLY_BUTTON_IDS.has(b.id));
  }
  return buttons;
}

function init() {
  const mainframeRoot = document.querySelector("#Mainframe");
  if (!mainframeRoot) return;

  const section = ensureCustomSection(mainframeRoot);
  const container = section.querySelector("#tm-custom-mainframe-buttons");

  const { lob } = getPortalContext();
  const buttonsToShow = filterButtonsForLob(CUSTOM_MAINFRAME_BUTTONS, lob);

  renderButtons(container, buttonsToShow);
}

init();
