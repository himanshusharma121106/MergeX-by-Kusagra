const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execSync, execFileSync } = require('child_process');

// Ensure fetch is available for Node versions < 18
if (typeof fetch === 'undefined') {
  try {
    const nodeFetch = require('node-fetch');
    global.fetch = nodeFetch;
  } catch {
    console.warn('Global fetch is not available and node-fetch could not be loaded; remote BarTender API calls may fail.');
  }
}

// Global print statistics
const printStats = {
  totalPrinted: 0,
  successPrinted: 0,
  failedPrinted: 0,
  lastPrintStatus: 'Ready', // 'Success' | 'Failed' | 'Ready'
  lastError: ''
};

// Cached printer status to avoid spawning processes every 2 seconds
let cachedStatus = null;
let lastCheckTime = 0;
const CACHE_TTL_MS = 2500;

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function cmdQuoted(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

// Find any .btw files in a given directory
function findBtwInDirectory(dirPath) {
  if (!dirPath) return [];
  try {
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      const files = fs.readdirSync(dirPath);
      return files
        .filter(f => f.toLowerCase().endsWith('.btw'))
        .map(f => path.join(dirPath, f));
    }
  } catch {
    // ignore access errors
  }
  return [];
}

// Intelligent discovery of BarTender label template (.btw)
function findLabelFile(customPath) {
  // 1. Direct explicit file check
  if (customPath) {
    try {
      if (fs.existsSync(customPath)) {
        const stat = fs.statSync(customPath);
        if (stat.isFile() && customPath.toLowerCase().endsWith('.btw')) {
          return customPath;
        }
        if (stat.isDirectory()) {
          const files = findBtwInDirectory(customPath);
          if (files.length > 0) {
            const pref = files.find(f => /template/i.test(path.basename(f))) || files[0];
            return pref;
          }
        }
      }
    } catch {}
  }

  // 2. Check candidate paths in priority order (including user-specified 'C:\Users\idu line\Documents\Labels')
  const envPath = process.env.BARTENDER_LABEL_PATH;
  const candidatePaths = [
    customPath,
    envPath,
    'C:\\Users\\idu line\\Documents\\Labels',
    'C:\\Users\\idu line\\Documents\\Labels\\Template.btw',
    'C:\\Users\\idu line\\Documents\\Labels\\Templatee.btw',
    path.join(os.homedir(), 'Documents', 'Labels'),
    path.join(os.homedir(), 'Documents', 'Labels', 'Template.btw'),
    'C:\\Labels',
    'C:\\Labels\\Template.btw',
    'C:\\Labels\\Templatee.btw',
    path.join(__dirname, 'labels'),
    path.join(__dirname, 'labels', 'Template.btw'),
    path.join(__dirname, 'Template.btw'),
    path.join(__dirname, 'Templatee.btw'),
    'D:\\ESP.btw',
    'D:\\downloads\\it.btw',
    'D:\\downloads\\cfd 2040.btw'
  ];

  for (const p of candidatePaths) {
    if (!p) continue;
    try {
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p);
        if (stat.isFile() && p.toLowerCase().endsWith('.btw')) {
          return p;
        }
        if (stat.isDirectory()) {
          const btws = findBtwInDirectory(p);
          if (btws.length > 0) {
            const pref = btws.find(f => /template/i.test(path.basename(f))) || btws[0];
            return pref;
          }
        }
      }
    } catch {}
  }

  return null;
}

// Find BarTender executable on machine across all known versions
function findBarTenderExe(customPath) {
  if (customPath && fs.existsSync(customPath)) return customPath;
  if (process.env.BARTENDER_EXE_PATH && fs.existsSync(process.env.BARTENDER_EXE_PATH)) {
    return process.env.BARTENDER_EXE_PATH;
  }

  const commonPaths = [
    'C:\\Program Files\\Seagull\\BarTender 2024\\bartend.exe',
    'C:\\Program Files\\Seagull\\BarTender 2023\\bartend.exe',
    'C:\\Program Files\\Seagull\\BarTender 2022\\bartend.exe',
    'C:\\Program Files\\Seagull\\BarTender 2021\\bartend.exe',
    'C:\\Program Files\\Seagull\\BarTender 2019\\bartend.exe',
    'C:\\Program Files\\Seagull\\BarTender 2016\\bartend.exe',
    'C:\\Program Files\\Seagull\\BarTender Suite\\bartend.exe',
    'C:\\Program Files\\Seagull\\BarTender 12.0\\bartend.exe',
    'C:\\Program Files\\Seagull\\BarTender 11.0\\bartend.exe',
    'C:\\Program Files\\Seagull\\BarTender 10.1\\bartend.exe',
    'C:\\Program Files (x86)\\Seagull\\BarTender 2024\\bartend.exe',
    'C:\\Program Files (x86)\\Seagull\\BarTender 2023\\bartend.exe',
    'C:\\Program Files (x86)\\Seagull\\BarTender 2022\\bartend.exe',
    'C:\\Program Files (x86)\\Seagull\\BarTender 2021\\bartend.exe',
    'C:\\Program Files (x86)\\Seagull\\BarTender 2019\\bartend.exe',
    'C:\\Program Files (x86)\\Seagull\\BarTender 2016\\bartend.exe',
    'C:\\Program Files (x86)\\Seagull\\BarTender Suite\\bartend.exe',
    'C:\\Program Files (x86)\\Seagull\\BarTender 10.1\\bartend.exe'
  ];

  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }

  // Dynamic directory scan under Seagull folders
  const baseFolders = ['C:\\Program Files\\Seagull', 'C:\\Program Files (x86)\\Seagull'];
  for (const base of baseFolders) {
    try {
      if (fs.existsSync(base)) {
        const subdirs = fs.readdirSync(base);
        for (const sub of subdirs) {
          const exe = path.join(base, sub, 'bartend.exe');
          if (fs.existsSync(exe)) return exe;
        }
      }
    } catch {}
  }

  return null;
}

// Get all installed Windows printers using fast PowerShell Get-Printer
function getWindowsPrinters() {
  // Method 1: Fast direct PowerShell Get-Printer
  try {
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', 'Get-Printer | Select-Object Name, PrinterStatus, Default | ConvertTo-Json'],
      { encoding: 'utf8', timeout: 4000 }
    );
    const trimmed = (output || '').trim();
    if (trimmed) {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [parsed];
    }
  } catch (err) {
    // fallback to Method 2
  }

  // Method 2: WMIC Printer listing
  try {
    const cmd = `cmd.exe /c "wmic printer get name,default /format:csv"`;
    const output = execSync(cmd, { encoding: 'utf8', timeout: 3000 });
    const lines = output.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
    const printers = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length >= 3) {
        const isDefault = parts[1].trim().toLowerCase() === 'true';
        const name = parts[2].trim();
        if (name) printers.push({ Name: name, Default: isDefault, PrinterStatus: 0 });
      }
    }
    if (printers.length > 0) return printers;
  } catch {}

  return [];
}

function isLabelPrinter(name) {
  if (!name) return false;
  const s = String(name).toLowerCase();
  const keywords = [
    'zdesigner', 'zebra', 'zt', 'zd', 'zm', 'gk', 'gx', 'gt',
    'tsc', 'ttp', 'honeywell', 'pc42', 'datamax', 'sato',
    'citizen', 'tvs', 'lp', 'godex', 'intermec', 'bixolon',
    'xprinter', 'postek', 'thermal', 'barcode', 'label', 'dpi'
  ];
  return keywords.some(k => s.includes(k));
}

// Intelligent printer resolver (matches exact, partial, or detects ANY installed thermal/label printer)
function resolvePrinter(requestedName, printers) {
  const list = printers || [];
  const req = (requestedName || '').trim();
  const isAuto = !req || req.toLowerCase() === 'auto' || req.toLowerCase() === 'default';

  if (list.length === 0) {
    if (!isAuto) return req;
    const env = (process.env.BARTENDER_PRINTER_NAME || '').trim();
    if (env && env.toLowerCase() !== 'auto') return env;
    return null; // Omit /PRN so BarTender uses document default printer
  }

  // 1. If user requested a specific printer and it actually exists in Windows
  if (!isAuto) {
    const exact = list.find(p => p && p.Name && p.Name.toLowerCase() === req.toLowerCase());
    if (exact) return exact.Name;

    const partial = list.find(p => p && p.Name && (
      p.Name.toLowerCase().includes(req.toLowerCase()) ||
      req.toLowerCase().includes(p.Name.toLowerCase())
    ));
    if (partial) return partial.Name;

    console.warn(`[Printer Notice] Requested printer "${req}" is not installed on this PC. Auto-detecting connected printer...`);
  }

  // 2. Check env BARTENDER_PRINTER_NAME if specified and not 'auto'
  const envName = (process.env.BARTENDER_PRINTER_NAME || '').trim();
  if (envName && envName.toLowerCase() !== 'auto') {
    const matchEnv = list.find(p => p && p.Name && (
      p.Name.toLowerCase() === envName.toLowerCase() ||
      p.Name.toLowerCase().includes(envName.toLowerCase()) ||
      envName.toLowerCase().includes(p.Name.toLowerCase())
    ));
    if (matchEnv) return matchEnv.Name;
  }

  // 3. Auto-detect ANY thermal / barcode / label printer installed on THIS PC
  const labelPrinter = list.find(p => p && p.Name && isLabelPrinter(p.Name));
  if (labelPrinter) {
    console.log(`[Auto-Detect Printer] Matched thermal label printer: "${labelPrinter.Name}"`);
    return labelPrinter.Name;
  }

  // 4. Default Windows printer
  const def = list.find(p => p && (p.Default || p.IsDefault));
  if (def) return def.Name;

  // 5. Fallback: null so BarTender uses the printer embedded in the .btw document
  return list[0]?.Name || null;
}

// Comprehensive real-time status check
async function getRealTimePrinterStatus(targetPrinterName) {
  const now = Date.now();
  if (cachedStatus && (now - lastCheckTime < CACHE_TTL_MS) && (!targetPrinterName || cachedStatus.name === targetPrinterName)) {
    return cachedStatus;
  }

  const printers = getWindowsPrinters();
  const defaultName = process.env.BARTENDER_PRINTER_NAME || 'auto';
  const rawTargetName = targetPrinterName || defaultName;
  const resolvedPrinter = resolvePrinter(rawTargetName, printers);

  const foundLabel = findLabelFile(process.env.BARTENDER_LABEL_PATH);
  const exePath = findBarTenderExe();

  let isOnline = false;
  let statusText = 'Not Connected';
  let errorMsg = '';

  // 1. Check if BarTender REST API (Integration Service on port 5159) is alive
  const apiUrl = process.env.BARTENDER_API_URL || 'http://localhost:5159/api';
  let apiResponded = false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const res = await fetch(`${apiUrl}/status?printer=${encodeURIComponent(resolvedPrinter)}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      apiResponded = true;
      const s = (data.status || '').toLowerCase();
      if (!s.includes('offline') && !s.includes('not connected') && s !== 'paused') {
        isOnline = true;
        statusText = 'Online';
      } else {
        statusText = 'Offline';
        errorMsg = data.lastError || `Printer Status: ${data.status}`;
      }
    }
  } catch {
    // REST API on 5159 not running (standard for BarTender CLI / Local printing)
  }

  // 2. If REST API is not available, check Windows Printers and BarTender files directly
  if (!apiResponded) {
    const matched = printers.find(p => p && p.Name && p.Name.toLowerCase() === resolvedPrinter.toLowerCase());
    if (matched) {
      if (matched.WorkOffline) {
        statusText = 'Offline';
        errorMsg = `Printer "${matched.Name}" is set to Offline in Windows`;
      } else {
        isOnline = true;
        statusText = 'Online';
      }
    } else {
      if (printers.length > 0) {
        isOnline = true;
        statusText = 'Online';
      } else {
        statusText = 'Not Connected';
        errorMsg = `No printers detected in Windows.`;
      }
    }

    if (!exePath && isOnline) {
      errorMsg = 'Printer detected in Windows, but BarTender (bartend.exe) is not installed in standard path.';
    }

    if (!foundLabel && isOnline && !errorMsg) {
      errorMsg = `Label template missing. Place your .btw file in "C:\\Users\\idu line\\Documents\\Labels"`;
    }
  }

  cachedStatus = {
    name: resolvedPrinter,
    status: statusText,
    totalPrinted: printStats.totalPrinted,
    successPrinted: printStats.successPrinted,
    failedPrinted: printStats.failedPrinted,
    lastPrintStatus: printStats.lastPrintStatus,
    lastError: errorMsg || printStats.lastError || '',
    bartenderInstalled: !!exePath,
    exePath: exePath || '',
    templateExists: !!foundLabel,
    labelPath: foundLabel || process.env.BARTENDER_LABEL_PATH || 'C:\\Users\\idu line\\Documents\\Labels\\Template.btw',
    availablePrinters: printers.map(p => p.Name)
  };
  lastCheckTime = now;

  return cachedStatus;
}

// Background poller for WebSockets
let lastStatusJson = '';
let pollInterval = null;

router.use((req, res, next) => {
  if (!pollInterval && req.io) {
    pollInterval = setInterval(async () => {
      try {
        const data = await getRealTimePrinterStatus();
        const currentJson = JSON.stringify(data);
        if (currentJson !== lastStatusJson) {
          lastStatusJson = currentJson;
          req.io.emit('printer_status', data);
        }
      } catch {}
    }, 3000);
  }
  next();
});

// REST endpoint: /status
router.get('/status', async (req, res) => {
  const targetPrinter = req.query.printer || process.env.BARTENDER_PRINTER_NAME;
  const statusData = await getRealTimePrinterStatus(targetPrinter);
  res.json(statusData);
});

// REST endpoint: /printers (Returns all installed Windows printers)
router.get('/printers', (req, res) => {
  const printers = getWindowsPrinters();
  const resolved = resolvePrinter(process.env.BARTENDER_PRINTER_NAME, printers);
  res.json({ success: true, printers, recommended: resolved });
});

// REST endpoint: /templates (Lists found BarTender templates)
router.get('/templates', (req, res) => {
  const found = findLabelFile(process.env.BARTENDER_LABEL_PATH);
  const searchDirs = [
    'C:\\Users\\idu line\\Documents\\Labels',
    path.join(os.homedir(), 'Documents', 'Labels'),
    'C:\\Labels',
    path.join(__dirname, 'labels')
  ];
  const allTemplates = [];
  for (const dir of searchDirs) {
    const list = findBtwInDirectory(dir);
    for (const file of list) {
      if (!allTemplates.includes(file)) allTemplates.push(file);
    }
  }
  res.json({ success: true, activeTemplate: found, templates: allTemplates });
});

// REST endpoint: /print
router.post('/print', async (req, res) => {
  const directNamedSources = req.body && (req.body.NamedDataSources || req.body.Variables);
  const qrCode = req.body.qrCode || (directNamedSources && (directNamedSources.QRCode || directNamedSources.qrCode));
  const sapCode = req.body.sapCode || (directNamedSources && (directNamedSources.SAPCode || directNamedSources.sapCode));
  const description = req.body.description || (directNamedSources && (directNamedSources.Description || directNamedSources.description));
  const printerConfig = req.body.printerConfig;
  const bodyPrinterName = req.body.printerName || req.body.Printer;

  if (!qrCode) {
    return res.status(400).json({ success: false, error: 'QR Code is required' });
  }

  const printers = getWindowsPrinters();
  const rawTargetName = bodyPrinterName || (printerConfig && printerConfig.name) || process.env.BARTENDER_PRINTER_NAME || 'auto';
  const printerName = resolvePrinter(rawTargetName, printers);
  const method = ((printerConfig && printerConfig.method) ? printerConfig.method : (process.env.PRINT_METHOD || 'auto')).toLowerCase();

  // Only increment counters when print is actually executed and verified
  const logFile = path.join(os.tmpdir(), `bt_print_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.log`);

  try {
    const apiUrl = process.env.BARTENDER_API_URL || 'http://localhost:5159/api';
    let apiSuccess = false;
    let apiErrorMsg = '';

    // 1. Try BarTender REST API if configured
    if (method === 'api' || method === 'auto') {
      try {
        const payload = {
          Printer: printerName || undefined,
          NamedDataSources: {
            QRCode: qrCode,
            SAPCode: sapCode,
            Description: description
          },
          Variables: {
            QRCode: qrCode,
            SAPCode: sapCode,
            Description: description
          }
        };

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1500);

        const response = await fetch(`${apiUrl}/print`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        clearTimeout(timeout);

        if (response.ok) {
          apiSuccess = true;
          const text = await response.text();
          let data = {};
          try { data = JSON.parse(text); } catch { data = { raw: text }; }

          printStats.totalPrinted++;
          printStats.successPrinted++;
          printStats.lastPrintStatus = 'Success';
          printStats.lastError = '';

          if (req.io) req.io.emit('printer_event', { type: 'success', details: data });
          return res.json({ success: true, message: 'Printed successfully via API', details: data, printer: printerName });
        } else {
          apiErrorMsg = `API Status ${response.status}`;
        }
      } catch (err) {
        apiErrorMsg = err && err.message ? err.message : String(err);
      }
    }

    // 2. Fallback to CMD (BarTender Suite bartend.exe)
    if (!apiSuccess && (method === 'cmd' || method === 'auto')) {
      const exeFile = findBarTenderExe(printerConfig && printerConfig.exePath);
      if (!exeFile) {
        const noExeErr = 'BarTender executable (bartend.exe) is not installed on this PC. Cannot print.';
        printStats.totalPrinted++;
        printStats.failedPrinted++;
        printStats.lastPrintStatus = 'Failed';
        printStats.lastError = noExeErr;
        if (req.io) req.io.emit('printer_event', { type: 'error', message: noExeErr });
        return res.status(500).json({ success: false, error: noExeErr });
      }

      const customLabel = (printerConfig && printerConfig.labelPath) ? printerConfig.labelPath : null;
      const finalLabelPath = findLabelFile(customLabel);

      if (!finalLabelPath) {
        const missingErr = `BarTender label template (.btw) not found. Put your label file in "C:\\Users\\idu line\\Documents\\Labels"`;
        printStats.totalPrinted++;
        printStats.failedPrinted++;
        printStats.lastPrintStatus = 'Failed';
        printStats.lastError = missingErr;
        if (req.io) req.io.emit('printer_event', { type: 'error', message: missingErr });
        return res.status(500).json({ success: false, error: missingErr });
      }

      const labelDir = path.dirname(finalLabelPath);
      const fallbackDir = path.join(os.tmpdir(), 'mergex-bt-data');
      let dataDir = fallbackDir;
      try {
        if (fs.existsSync(labelDir)) {
          const testFile = path.join(labelDir, '.perm_test');
          fs.writeFileSync(testFile, '1');
          fs.unlinkSync(testFile);
          dataDir = labelDir;
        }
      } catch {
        dataDir = fallbackDir;
      }
      fs.mkdirSync(dataDir, { recursive: true });

      const dataPath = path.join(dataDir, 'scanwise-print.csv');
      const csvHeaders = ['QRCode', 'SAPCode', 'Description', 'Plant', 'Location', 'Line', 'Timestamp', 'QR_CODE', 'SAP_CODE'];
      const csvValues = [
        csvCell(qrCode),
        csvCell(sapCode),
        csvCell(description),
        csvCell(req.body.plant || ''),
        csvCell(req.body.location || ''),
        csvCell(req.body.line || ''),
        csvCell(req.body.timestamp || new Date().toLocaleString()),
        csvCell(qrCode),
        csvCell(sapCode)
      ];
      // Include UTF-8 BOM so BarTender parses accurately
      const csv = '\uFEFF' + [csvHeaders.join(','), csvValues.join(',')].join('\r\n');
      fs.writeFileSync(dataPath, csv, 'utf8');

      // Build BarTender Command Line arguments:
      // /F="path"  : Specifies the BarTender document to open
      // /D="path"  : Specifies the database/data file to use
      // /PRN="name": Specifies the printer (omitted if auto/none so BarTender uses document printer)
      // /P         : Prints the document
      // /X         : Closes BarTender after printing
      // /Min=Close : Starts minimized and closes when complete
      // /NoSplash  : Suppresses the BarTender splash screen
      // /C=1       : Print 1 copy
      // /L="path"  : Writes BarTender print status/error log to a text file
      const prnArg = printerName ? `/PRN=${cmdQuoted(printerName)} ` : '';
      let cmdTemplate = process.env.PRINT_CMD_TEMPLATE;
      if (!cmdTemplate) {
        cmdTemplate = `start "" /wait "${exeFile}" /F=${cmdQuoted(finalLabelPath)} /D=${cmdQuoted(dataPath)} ${prnArg}/P /X /Min=Close /NoSplash /C=1 /L=${cmdQuoted(logFile)}`;
      }

      const finalCmd = cmdTemplate
        .replace(/\{\{QRCODE\}\}/g, String(qrCode).replace(/"/g, '""'))
        .replace(/\{\{SAPCODE\}\}/g, String(sapCode).replace(/"/g, '""'))
        .replace(/\{\{DESCRIPTION\}\}/g, String(description).replace(/"/g, '""'))
        .replace(/\{\{PRINTER_NAME\}\}/g, printerName || '')
        .replace(/\{\{LABEL_PATH\}\}/g, finalLabelPath)
        .replace(/\{\{DATA_FILE\}\}/g, dataPath);

      console.log(`[BarTender Print] Executing command: ${finalCmd}`);

      exec(finalCmd, { timeout: 25000, windowsHide: true }, (error, stdout, stderr) => {
        // Always increment totalPrinted count when print was actually attempted
        printStats.totalPrinted++;

        // Read logFile if generated by BarTender
        let logContent = '';
        try {
          if (fs.existsSync(logFile)) {
            logContent = fs.readFileSync(logFile, 'utf8') || '';
            fs.unlinkSync(logFile); // Clean up log
          }
        } catch {}

        const logHasError = logContent && (
          /error/i.test(logContent) ||
          /failed/i.test(logContent) ||
          /cannot open/i.test(logContent) ||
          /printer not found/i.test(logContent) ||
          /unable to/i.test(logContent)
        );

        if (error || logHasError) {
          const detail = error ? error.message : (logContent || 'BarTender returned error log');
          printStats.failedPrinted++;
          printStats.lastPrintStatus = 'Failed';
          printStats.lastError = detail;

          console.error(`CMD Print Error: ${detail}`);
          if (req.io) req.io.emit('printer_event', { type: 'error', message: `CMD Print Failed: ${detail}` });
          return res.status(500).json({ success: false, error: 'Printer execution failed', details: detail });
        }

        printStats.successPrinted++;
        printStats.lastPrintStatus = 'Success';
        printStats.lastError = '';

        if (req.io) req.io.emit('printer_event', { type: 'success', details: { method: 'cmd', output: stdout, dataPath, printer: printerName, labelPath: finalLabelPath } });
        return res.json({
          success: true,
          message: 'Printed successfully via BarTender',
          details: { stdout, stderr, dataPath, printer: printerName, labelPath: finalLabelPath }
        });
      });
      return;
    }

    if (!apiSuccess && method === 'api') {
      printStats.totalPrinted++;
      printStats.failedPrinted++;
      printStats.lastPrintStatus = 'Failed';
      printStats.lastError = `BarTender API unreachable: ${apiErrorMsg}`;
      if (req.io) req.io.emit('printer_event', { type: 'error', message: printStats.lastError });
      return res.status(500).json({ success: false, error: printStats.lastError });
    }

  } catch (error) {
    printStats.totalPrinted++;
    printStats.failedPrinted++;
    printStats.lastPrintStatus = 'Failed';
    printStats.lastError = error.message;

    console.error('BarTender Print Error:', error);
    if (req.io) req.io.emit('printer_event', { type: 'error', message: error.message });
    res.status(500).json({ success: false, error: 'Internal Print Error occurred: ' + error.message });
  }
});

module.exports = router;

