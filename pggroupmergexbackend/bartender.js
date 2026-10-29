const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execSync } = require('child_process');

// Ensure fetch is available
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

// Cached printer status to avoid spawning powershell every 2 seconds
let cachedStatus = null;
let lastCheckTime = 0;
const CACHE_TTL_MS = 3500;

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function cmdQuoted(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

// Find BarTender executable on machine
function findBarTenderExe(customPath) {
  if (customPath && fs.existsSync(customPath)) return customPath;
  if (process.env.BARTENDER_EXE_PATH && fs.existsSync(process.env.BARTENDER_EXE_PATH)) {
    return process.env.BARTENDER_EXE_PATH;
  }
  const commonPaths = [
    'C:\\Program Files\\Seagull\\BarTender 2022\\bartend.exe',
    'C:\\Program Files\\Seagull\\BarTender Suite\\bartend.exe',
    'C:\\Program Files\\Seagull\\BarTender 2021\\bartend.exe',
    'C:\\Program Files\\Seagull\\BarTender 2019\\bartend.exe',
    'C:\\Program Files\\Seagull\\BarTender 12.0\\bartend.exe',
    'C:\\Program Files (x86)\\Seagull\\BarTender Suite\\bartend.exe'
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Get all installed Windows printers using WMI
function getWindowsPrinters() {
  try {
    const cmd = `powershell -NoProfile -Command "Get-CimInstance Win32_Printer | Select-Object Name, PrinterStatus, WorkOffline | ConvertTo-Json"`;
    const output = execSync(cmd, { encoding: 'utf8', timeout: 4000 });
    const parsed = JSON.parse(output.trim());
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    console.warn('Failed to query Windows printers:', err.message);
    return [];
  }
}

// Comprehensive real-time status check
async function getRealTimePrinterStatus(targetPrinterName) {
  const now = Date.now();
  if (cachedStatus && (now - lastCheckTime < CACHE_TTL_MS) && (!targetPrinterName || cachedStatus.name === targetPrinterName)) {
    return cachedStatus;
  }

  const defaultName = process.env.BARTENDER_PRINTER_NAME || 'ZDesigner ZT231-300dpi ZPL';
  let printerName = targetPrinterName || defaultName;
  const labelPath = process.env.BARTENDER_LABEL_PATH || 'C:\\Labels\\Template.btw';
  const exePath = findBarTenderExe();

  let isOnline = false;
  let statusText = 'Not Connected';
  let errorMsg = '';
  let detectedPrinterName = printerName;

  // 1. Check if BarTender REST API (Integration Service on port 5159) is alive
  const apiUrl = process.env.BARTENDER_API_URL || 'http://localhost:5159/api';
  let apiResponded = false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(`${apiUrl}/status?printer=${encodeURIComponent(printerName)}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      apiResponded = true;
      const s = (data.status || '').toLowerCase();
      if (!s.includes('offline') && !s.includes('not connected') && s !== 'paused') {
        isOnline = true;
        statusText = 'Online';
        detectedPrinterName = data.name || printerName;
      } else {
        statusText = 'Offline';
        errorMsg = data.lastError || `Printer Status: ${data.status}`;
      }
    }
  } catch {
    // API not running on port 5159 (standard for BarTender CMD / Local printing)
  }

  // 2. If REST API is not available, check Windows Printers and BarTender files directly
  if (!apiResponded) {
    const printers = getWindowsPrinters();

    // Match printer by exact name, partial match, or look for Zebra/ZDesigner
    let matchedPrinter = printers.find(p => p && p.Name && p.Name.toLowerCase() === printerName.toLowerCase());
    if (!matchedPrinter) {
      matchedPrinter = printers.find(p => p && p.Name && p.Name.toLowerCase().includes(printerName.toLowerCase()));
    }
    if (!matchedPrinter) {
      matchedPrinter = printers.find(p => p && p.Name && (p.Name.includes('ZDesigner') || p.Name.includes('Zebra')));
    }

    if (matchedPrinter) {
      detectedPrinterName = matchedPrinter.Name;
      if (matchedPrinter.WorkOffline) {
        statusText = 'Offline';
        errorMsg = `Printer "${matchedPrinter.Name}" is set to Offline in Windows`;
      } else {
        isOnline = true;
        statusText = 'Online';
      }
    } else {
      statusText = 'Not Connected';
      errorMsg = `Printer "${printerName}" not found in Windows. Available: ${printers.map(p => p.Name).slice(0, 3).join(', ')}`;
    }

    // Verify BarTender installation
    if (!exePath) {
      if (isOnline) {
        errorMsg = 'Printer detected in Windows, but BarTender (bartend.exe) is not installed in standard path.';
      }
    }

    // Verify Template file
    if (!fs.existsSync(labelPath)) {
      if (isOnline && !errorMsg) {
        errorMsg = `Template missing: "${labelPath}". Put template in this path or configure it.`;
      }
    }
  }

  cachedStatus = {
    name: detectedPrinterName,
    status: statusText,
    totalPrinted: printStats.totalPrinted,
    successPrinted: printStats.successPrinted,
    failedPrinted: printStats.failedPrinted,
    lastPrintStatus: printStats.lastPrintStatus,
    lastError: errorMsg || printStats.lastError || '',
    bartenderInstalled: !!exePath,
    templateExists: fs.existsSync(labelPath),
    labelPath: labelPath
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
      } catch (err) {
        // Silently handle poller error
      }
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
  res.json({ success: true, printers });
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

  const printerName = bodyPrinterName || (printerConfig && printerConfig.name) || process.env.BARTENDER_PRINTER_NAME || 'ZDesigner ZT231-300dpi ZPL';
  const method = ((printerConfig && printerConfig.method) ? printerConfig.method : (process.env.PRINT_METHOD || 'auto')).toLowerCase();

  printStats.totalPrinted++;

  try {
    const apiUrl = process.env.BARTENDER_API_URL || 'http://localhost:5159/api';
    let apiSuccess = false;
    let apiErrorMsg = '';

    // 1. Try API if configured
    if (method === 'api' || method === 'auto') {
      try {
        const payload = {
          Printer: printerName,
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

        const response = await fetch(`${apiUrl}/print`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          apiSuccess = true;
          const text = await response.text();
          let data = {};
          try { data = JSON.parse(text); } catch { data = { raw: text }; }

          printStats.successPrinted++;
          printStats.lastPrintStatus = 'Success';
          printStats.lastError = '';

          if (req.io) req.io.emit('printer_event', { type: 'success', details: data });
          return res.json({ success: true, message: 'Printed successfully via API', details: data });
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
      const exePath = exeFile ? `"${exeFile}"` : 'bartend.exe';

      const labelPath = (printerConfig && printerConfig.labelPath) ? printerConfig.labelPath : (process.env.BARTENDER_LABEL_PATH || 'C:\\Labels\\Template.btw');
      const labelDir = path.dirname(labelPath);
      const fallbackDir = path.join(os.tmpdir(), 'scanwise-bt-data');
      const dataDir = fs.existsSync(labelDir) ? labelDir : fallbackDir;
      fs.mkdirSync(dataDir, { recursive: true });

      const dataPath = path.join(dataDir, 'scanwise-print.csv');
      const csvHeaders = ['QRCode', 'SAPCode', 'Description', 'Plant', 'Location', 'Line', 'Timestamp'];
      const csvValues = [
        csvCell(qrCode),
        csvCell(sapCode),
        csvCell(description),
        csvCell(req.body.plant || ''),
        csvCell(req.body.location || ''),
        csvCell(req.body.line || ''),
        csvCell(req.body.timestamp || new Date().toLocaleString())
      ];
      const csv = [csvHeaders.join(','), csvValues.join(',')].join('\r\n');
      fs.writeFileSync(dataPath, csv, 'utf8');

      let cmdTemplate = process.env.PRINT_CMD_TEMPLATE;
      if (!cmdTemplate) {
        cmdTemplate = `${exePath} /AF=${cmdQuoted(labelPath)} /D=${cmdQuoted(dataPath)} /PRN=${cmdQuoted(printerName)} /P`;
      }

      const finalCmd = cmdTemplate
        .replace(/\{\{QRCODE\}\}/g, String(qrCode).replace(/"/g, '""'))
        .replace(/\{\{SAPCODE\}\}/g, String(sapCode).replace(/"/g, '""'))
        .replace(/\{\{DESCRIPTION\}\}/g, String(description).replace(/"/g, '""'))
        .replace(/\{\{PRINTER_NAME\}\}/g, printerName)
        .replace(/\{\{LABEL_PATH\}\}/g, labelPath)
        .replace(/\{\{DATA_FILE\}\}/g, dataPath);

      console.log('Executing CMD Print:', finalCmd);

      exec(finalCmd, (error, stdout, stderr) => {
        if (error) {
          printStats.failedPrinted++;
          printStats.lastPrintStatus = 'Failed';
          printStats.lastError = error.message;

          console.error(`CMD Print Error: ${error.message}`);
          if (req.io) req.io.emit('printer_event', { type: 'error', message: `CMD Print Failed: ${error.message}` });
          return res.status(500).json({ success: false, error: 'Printer CMD execution failed', details: error.message });
        }

        printStats.successPrinted++;
        printStats.lastPrintStatus = 'Success';
        printStats.lastError = '';

        if (req.io) req.io.emit('printer_event', { type: 'success', details: { method: 'cmd', output: stdout, dataPath } });
        return res.json({ success: true, message: 'Printed successfully via BarTender', details: { stdout, stderr, dataPath } });
      });
      return;
    }

    if (!apiSuccess && method === 'api') {
      printStats.failedPrinted++;
      printStats.lastPrintStatus = 'Failed';
      printStats.lastError = `BarTender API unreachable: ${apiErrorMsg}`;
      if (req.io) req.io.emit('printer_event', { type: 'error', message: printStats.lastError });
      return res.status(500).json({ success: false, error: printStats.lastError });
    }

  } catch (error) {
    printStats.failedPrinted++;
    printStats.lastPrintStatus = 'Failed';
    printStats.lastError = error.message;

    console.error('BarTender Print Error:', error);
    if (req.io) req.io.emit('printer_event', { type: 'error', message: error.message });
    res.status(500).json({ success: false, error: 'Internal Print Error occurred' });
  }
});

module.exports = router;
