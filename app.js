const DEFAULT_INPUTS = {
  "future-price": "1025",
  volatility: "40%",
  "risk-free-rate": "0%",
  "strike-max": "1288",
  "strike-min": "1160",
  "strike-step": "8",
};

const DEFAULT_CONTRACTS = [
  { code: "2608", expiry: "20260727" },
  { code: "2610", expiry: "20260923" },
  { code: "2612", expiry: "20261124" },
];

const DEFAULT_OPTION_TYPE = "call";
const DIRECT_GOLD_QUOTE_URL = "https://api.gold-api.com/price/XAU";
const DIRECT_FX_QUOTE_URL = "https://api.frankfurter.dev/v2/rate/USD/CNY";
const TROY_OUNCE_GRAMS = 31.1034768;
const DEFAULT_QUOTE_SETTINGS = {
  enabled: false,
  intervalMs: 60000,
};
const QUOTE_INTERVALS = new Set([1000, 15000, 60000]);
const SETTINGS_STORAGE_KEY = "call-premium-pwa-settings-v2";
const CONTRACTS_STORAGE_KEY = "call-premium-pwa-contracts-v1";
const QUOTE_SETTINGS_STORAGE_KEY = "call-premium-pwa-quote-settings-v1";
const PRECISION = 1;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const inputIds = Object.keys(DEFAULT_INPUTS);
const contractSelectIds = ["contract-1", "contract-2", "contract-3"];

const form = document.querySelector("#calculator-form");
const resultHead = document.querySelector("#result-head");
const resultBody = document.querySelector("#result-body");
const statusMessage = document.querySelector("#status-message");
const resetButton = document.querySelector("#reset-button");
const copyButton = document.querySelector("#copy-button");
const installButton = document.querySelector("#install-button");
const onlineStatus = document.querySelector("#online-status");
const contractList = document.querySelector("#contract-list");
const addContractButton = document.querySelector("#add-contract-button");
const resetContractsButton = document.querySelector("#reset-contracts-button");
const todayLabel = document.querySelector("#today-label");
const quoteEnabledInput = document.querySelector("#quote-enabled");
const quoteIntervalInput = document.querySelector("#quote-interval");
const quoteSummary = document.querySelector("#quote-summary");
const quoteStatus = document.querySelector("#quote-status");
const optionTypeInputs = Array.from(document.querySelectorAll('input[name="option-type"]'));
const contractSelects = contractSelectIds.map((id) => document.getElementById(id));

let contracts = DEFAULT_CONTRACTS.map((contract) => ({ ...contract }));
let quoteSettings = { ...DEFAULT_QUOTE_SETTINGS };
let latestQuote = null;
let quoteTimerId = null;
let quoteFetchInFlight = false;
let lastResult = { columns: [], rows: [] };
let deferredInstallPrompt = null;

function getInput(id) {
  return document.getElementById(id);
}

function parseNumberInput(id, fieldName) {
  const text = getInput(id).value.trim();
  if (!text) {
    throw new Error(`请输入${fieldName}。`);
  }

  const value = Number(text);
  if (!Number.isFinite(value)) {
    throw new Error(`${fieldName}需要是数字。`);
  }
  return value;
}

function positiveNumber(id, fieldName) {
  const value = parseNumberInput(id, fieldName);
  if (value <= 0) {
    throw new Error(`${fieldName}必须大于 0。`);
  }
  return value;
}

function nonNegativeNumber(value, fieldName) {
  if (value < 0) {
    throw new Error(`${fieldName}不能为负数。`);
  }
  return value;
}

function parsePercent(id, fieldName) {
  let text = getInput(id).value.trim();
  if (!text) {
    throw new Error(`请输入${fieldName}。`);
  }

  const hasPercentSign = text.endsWith("%");
  if (hasPercentSign) {
    text = text.slice(0, -1).trim();
  }

  let value = Number(text);
  if (!Number.isFinite(value)) {
    throw new Error(`${fieldName}需要是数字。`);
  }

  if (hasPercentSign || Math.abs(value) > 1) {
    value /= 100;
  }
  return nonNegativeNumber(value, fieldName);
}

function getTodayDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function parseExpiryDate(expiry, fieldName = "到期日") {
  const text = String(expiry ?? "").trim();
  if (!/^\d{8}$/.test(text)) {
    throw new Error(`${fieldName}必须是 8 位数字，例如 20261124。`);
  }

  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  const date = new Date(year, month - 1, day);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error(`${fieldName}不是有效日期。`);
  }
  return date;
}

function daysUntilExpiry(expiry, today = getTodayDate()) {
  const expiryDate = parseExpiryDate(expiry);
  return Math.round((expiryDate.getTime() - today.getTime()) / MS_PER_DAY);
}

function normalizeContract(contract, index) {
  const code = String(contract?.code ?? "").trim();
  const expiry = String(contract?.expiry ?? "").trim();
  if (!code) {
    throw new Error(`第 ${index + 1} 个合约代码不能为空。`);
  }
  parseExpiryDate(expiry, `合约 ${code} 的到期日`);
  return { code, expiry };
}

function getValidatedContracts() {
  return contracts.map((contract, index) => normalizeContract(contract, index));
}

function getSelectableContracts() {
  const today = getTodayDate();
  return contracts
    .map((contract, index) => {
      try {
        const normalizedContract = normalizeContract(contract, index);
        return {
          ...normalizedContract,
          index,
          key: buildContractKey(normalizedContract, index),
          days: daysUntilExpiry(normalizedContract.expiry, today),
        };
      } catch {
        return null;
      }
    })
    .filter((contract) => contract !== null)
    .filter((contract) => contract.days >= 0)
    .sort((a, b) => a.expiry.localeCompare(b.expiry) || a.code.localeCompare(b.code));
}

function buildContractKey(contract, index) {
  return `${index}::${contract.code}::${contract.expiry}`;
}

function collectContractColumns() {
  const selectableContracts = getSelectableContracts();
  const byKey = new Map(selectableContracts.map((contract) => [contract.key, contract]));
  const columns = contractSelects
    .map((select) => byKey.get(select.value))
    .filter((contract) => contract !== undefined);

  if (columns.length === 0) {
    throw new Error("请至少选择一个未过期合约。");
  }
  return columns;
}

function renderContractSelects(preserveSelection = false) {
  const selectableContracts = getSelectableContracts();

  contractSelects.forEach((select, selectIndex) => {
    const previousValue = preserveSelection ? select.value : "";
    select.replaceChildren();

    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = selectableContracts.length ? "不使用" : "无未过期合约";
    select.append(emptyOption);

    selectableContracts.forEach((contract) => {
      const option = document.createElement("option");
      option.value = contract.key;
      option.textContent = `${contract.code} (${contract.expiry}, ${contract.days} 天)`;
      select.append(option);
    });

    const defaultContract = selectableContracts[selectIndex];
    if (previousValue && selectableContracts.some((contract) => contract.key === previousValue)) {
      select.value = previousValue;
    } else {
      select.value = defaultContract?.key ?? "";
    }
    select.disabled = selectableContracts.length === 0;
  });

}

function collectStrikes() {
  const maxStrike = positiveNumber("strike-max", "行权价最大值");
  const minStrike = positiveNumber("strike-min", "行权价最小值");
  const step = positiveNumber("strike-step", "步长");

  if (maxStrike < minStrike) {
    throw new Error("行权价最大值不能小于最小值。");
  }

  const values = [];
  const tolerance = step / 1_000_000;
  for (let strike = maxStrike; strike >= minStrike - tolerance; strike -= step) {
    values.push(displayNumber(strike));
    if (values.length > 5000) {
      throw new Error("行权价数量过多，请调大步长或缩小区间。");
    }
  }

  const lastValue = values[values.length - 1];
  if (lastValue !== minStrike && Math.abs(lastValue - minStrike) > tolerance) {
    values.push(displayNumber(minStrike));
  }
  return values;
}

function normalCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const value = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-value * value);
  return 0.5 * (1 + sign * erf);
}

function calculatePremium(futurePrice, daysToExpiry, volatility, strike, riskFreeRate, optionType) {
  const t = daysToExpiry / 365;
  const intrinsic = optionType === "call" ? Math.max(futurePrice - strike, 0) : Math.max(strike - futurePrice, 0);

  if (t <= 0) {
    return roundTo(intrinsic, PRECISION);
  }
  if (volatility === 0) {
    return roundTo(Math.exp(-riskFreeRate * t) * intrinsic, PRECISION);
  }

  const sqrtT = Math.sqrt(t);
  const volSqrtT = volatility * sqrtT;
  const d1 = (Math.log(futurePrice / strike) + 0.5 * volatility ** 2 * t) / volSqrtT;
  const d2 = d1 - volSqrtT;
  const discount = Math.exp(-riskFreeRate * t);
  const price =
    optionType === "call"
      ? discount * (futurePrice * normalCdf(d1) - strike * normalCdf(d2))
      : discount * (strike * normalCdf(-d2) - futurePrice * normalCdf(-d1));
  return roundTo(price, PRECISION);
}

function roundTo(value, precision) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function displayNumber(value) {
  return Number.isInteger(value) ? value : Number(value.toFixed(10));
}

function formatPremium(value) {
  return value.toFixed(PRECISION);
}

function formatQuotePrice(value) {
  return Number(value).toFixed(PRECISION);
}

function formatFxRate(value) {
  return Number(value).toFixed(4);
}

function formatQuoteTime(value) {
  if (!value) {
    return "时间未知";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "时间未知";
  }

  return date.toLocaleString("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getOptionType() {
  return optionTypeInputs.find((input) => input.checked)?.value ?? DEFAULT_OPTION_TYPE;
}

function setOptionType(optionType) {
  optionTypeInputs.forEach((candidate) => {
    candidate.checked = candidate.value === optionType;
  });
}

function describeOptionType(optionType) {
  if (optionType === "call") {
    return "看涨";
  }
  if (optionType === "put") {
    return "看跌";
  }
  return "看涨/看跌";
}

function buildPremiumColumns(contractColumns, optionType) {
  const selectedTypes = optionType === "both" ? ["call", "put"] : [optionType];
  const hasLivePrice = hasUsableLivePrice();
  return contractColumns.flatMap((contract) =>
    selectedTypes.flatMap((type) => {
      const baseLabel = `${contract.code} ${contract.days} 天${describeOptionType(type)}`;
      const baseCsvLabel = `${contract.code} ${contract.days} Days ${type === "call" ? "Call" : "Put"} Premium`;
      const columns = [
        {
          ...contract,
          type,
          priceSource: "manual",
          label: `${baseLabel} 手动F`,
          csvLabel: `${baseCsvLabel} Manual F`,
        },
      ];

      if (hasLivePrice) {
        columns.push({
          ...contract,
          type,
          priceSource: "live",
          label: `${baseLabel} 实时F`,
          csvLabel: `${baseCsvLabel} Live F`,
        });
      }
      return columns;
    }),
  );
}

function hasUsableLivePrice() {
  return quoteSettings.enabled && Number.isFinite(latestQuote?.price) && latestQuote.price > 0;
}

function getColumnFuturePrice(column, manualFuturePrice) {
  return column.priceSource === "live" && hasUsableLivePrice() ? latestQuote.price : manualFuturePrice;
}

function calculateAll() {
  const futurePrice = positiveNumber("future-price", "期货价格");
  getValidatedContracts();
  const contractColumns = collectContractColumns();
  const optionType = getOptionType();
  const columns = buildPremiumColumns(contractColumns, optionType);
  const volatility = parsePercent("volatility", "隐含波动率");
  const riskFreeRate = parsePercent("risk-free-rate", "无风险利率");
  const strikes = collectStrikes();

  const rows = strikes.map((strike) => ({
    strike: displayNumber(strike),
    premiums: columns.map((column) =>
      calculatePremium(getColumnFuturePrice(column, futurePrice), column.days, volatility, strike, riskFreeRate, column.type),
    ),
  }));

  lastResult = { columns, rows };
  renderTable(lastResult);
  saveSettings();
  saveContracts();
  setMessage(`已计算 ${rows.length} 个行权价，${contractColumns.length} 个合约，类型：${describeOptionType(optionType)}。`);
}

function runCalculation() {
  try {
    calculateAll();
  } catch (error) {
    setMessage(error.message, true);
  }
}

function renderTable(result) {
  resultHead.replaceChildren();
  resultBody.replaceChildren();

  const headerRow = document.createElement("tr");
  headerRow.append(createHeaderCell("行权价"));
  result.columns.forEach((column) => headerRow.append(createHeaderCell(column.label)));
  resultHead.append(headerRow);

  result.rows.forEach((row) => {
    resultBody.append(createResultRow(row));
  });
}

function createResultRow(row) {
  const tableRow = document.createElement("tr");
  tableRow.append(createCell(row.strike));
  row.premiums.forEach((premium) => tableRow.append(createCell(formatPremium(premium))));
  return tableRow;
}

function createHeaderCell(text) {
  const cell = document.createElement("th");
  cell.scope = "col";
  cell.textContent = text;
  return cell;
}

function createCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text;
  return cell;
}

function setMessage(text, isError = false) {
  statusMessage.textContent = text;
  statusMessage.classList.toggle("error", isError);
}

function copyResults() {
  if (lastResult.rows.length === 0) {
    setMessage("没有可复制的结果。", true);
    return;
  }

  const headers = ["Strike", ...lastResult.columns.map((column) => column.csvLabel)];
  const lines = [headers.join(",")];
  lastResult.rows.forEach((row) => {
    lines.push([row.csvStrike ?? row.strike, ...row.premiums.map(formatPremium)].join(","));
  });

  navigator.clipboard
    .writeText(lines.join("\n"))
    .then(() => setMessage("结果已复制到剪贴板。"))
    .catch(() => setMessage("复制失败，请检查浏览器剪贴板权限。", true));
}

function renderContractManager() {
  contractList.replaceChildren();
  contracts.forEach((contract, index) => {
    const row = document.createElement("div");
    row.className = "contract-row";

    const codeInput = document.createElement("input");
    codeInput.value = contract.code;
    codeInput.autocomplete = "off";
    codeInput.placeholder = "合约";
    codeInput.setAttribute("aria-label", `合约 ${index + 1} 代码`);
    codeInput.addEventListener("input", () => {
      contracts[index].code = codeInput.value.trim();
      persistContractEditorChange();
    });

    const expiryInput = document.createElement("input");
    expiryInput.value = contract.expiry;
    expiryInput.autocomplete = "off";
    expiryInput.inputMode = "numeric";
    expiryInput.placeholder = "YYYYMMDD";
    expiryInput.setAttribute("aria-label", `合约 ${index + 1} 到期日`);
    expiryInput.addEventListener("input", () => {
      contracts[index].expiry = expiryInput.value.trim();
      persistContractEditorChange();
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "icon-button";
    deleteButton.type = "button";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", () => {
      contracts.splice(index, 1);
      persistContractEditorChange();
      renderContractManager();
    });

    row.append(codeInput, expiryInput, deleteButton);
    contractList.append(row);
  });
}

function persistContractEditorChange() {
  saveContracts();
  renderContractSelects(true);
}

function saveSettings() {
  const data = {};
  inputIds.forEach((id) => {
    data[id] = getInput(id).value;
  });
  data.optionType = getOptionType();
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(data));
}

function saveContracts() {
  localStorage.setItem(CONTRACTS_STORAGE_KEY, JSON.stringify(contracts));
}

function loadSettings() {
  const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
  const values = saved ? { ...DEFAULT_INPUTS, ...JSON.parse(saved) } : DEFAULT_INPUTS;
  inputIds.forEach((id) => {
    getInput(id).value = values[id] ?? DEFAULT_INPUTS[id];
  });
  setOptionType(values.optionType ?? DEFAULT_OPTION_TYPE);
}

function loadContracts() {
  const saved = localStorage.getItem(CONTRACTS_STORAGE_KEY);
  if (!saved) {
    contracts = DEFAULT_CONTRACTS.map((contract) => ({ ...contract }));
    return;
  }

  const parsed = JSON.parse(saved);
  contracts = Array.isArray(parsed) ? parsed.map((contract) => ({ ...contract })) : DEFAULT_CONTRACTS.map((contract) => ({ ...contract }));
}

function resetInputs() {
  inputIds.forEach((id) => {
    getInput(id).value = DEFAULT_INPUTS[id];
  });
  setOptionType(DEFAULT_OPTION_TYPE);
  renderContractSelects(false);
  runCalculation();
}

function resetContracts() {
  contracts = DEFAULT_CONTRACTS.map((contract) => ({ ...contract }));
  saveContracts();
  renderContractManager();
  renderContractSelects(false);
  runCalculation();
}

function addContract() {
  contracts.push({ code: "", expiry: "" });
  saveContracts();
  renderContractManager();
  renderContractSelects(true);
}

function normalizeQuoteSettings(settings) {
  const intervalMs = Number(settings?.intervalMs);
  return {
    enabled: Boolean(settings?.enabled),
    intervalMs: QUOTE_INTERVALS.has(intervalMs) ? intervalMs : DEFAULT_QUOTE_SETTINGS.intervalMs,
  };
}

function loadQuoteSettings() {
  const saved = localStorage.getItem(QUOTE_SETTINGS_STORAGE_KEY);
  if (!saved) {
    quoteSettings = { ...DEFAULT_QUOTE_SETTINGS };
    return;
  }

  try {
    quoteSettings = normalizeQuoteSettings(JSON.parse(saved));
    saveQuoteSettings();
  } catch {
    quoteSettings = { ...DEFAULT_QUOTE_SETTINGS };
  }
}

function saveQuoteSettings() {
  localStorage.setItem(QUOTE_SETTINGS_STORAGE_KEY, JSON.stringify(quoteSettings));
}

function renderQuoteSettings() {
  quoteEnabledInput.checked = quoteSettings.enabled;
  quoteIntervalInput.value = String(quoteSettings.intervalMs);
  updateQuoteStatus();
}

function readQuoteSettingsFromForm() {
  quoteSettings = normalizeQuoteSettings({
    enabled: quoteEnabledInput.checked,
    intervalMs: quoteIntervalInput.value,
  });
  saveQuoteSettings();
}

function resolveQuoteEndpoint() {
  return DIRECT_GOLD_QUOTE_URL;
}

function updateQuoteStatus(message = "", isError = false) {
  quoteStatus.classList.toggle("error", isError);

  if (message) {
    quoteStatus.textContent = message;
    quoteSummary.textContent = latestQuote ? `最新 ${formatQuotePrice(latestQuote.price)}` : "等待行情";
    return;
  }

  if (!quoteSettings.enabled) {
    quoteSummary.textContent = "已暂停";
    quoteStatus.textContent = "启用后会按所选频率刷新国际金价，并换算成人民币/克。";
    return;
  }

  if (!navigator.onLine) {
    quoteSummary.textContent = "离线";
    quoteStatus.textContent = latestQuote
      ? `离线中，保留上次价格 ${formatQuotePrice(latestQuote.price)}。`
      : "离线中，暂停行情刷新。";
    return;
  }

  if (latestQuote) {
    quoteSummary.textContent = `${formatQuotePrice(latestQuote.price)}`;
    quoteStatus.textContent = `${latestQuote.name || latestQuote.symbol || "国际金价"} · ${formatQuoteTime(latestQuote.quoteTime)} · USD/CNY ${formatFxRate(latestQuote.usdCnyRate)} · ${latestQuote.source || "行情源"}`;
    return;
  }

  quoteSummary.textContent = "等待行情";
  quoteStatus.textContent = "正在等待第一次行情刷新。";
}

function restartQuotePolling(fetchImmediately = true) {
  stopQuotePolling();
  updateQuoteStatus();

  if (!quoteSettings.enabled || !navigator.onLine) {
    return;
  }

  if (fetchImmediately) {
    fetchLatestQuote();
  }
  quoteTimerId = window.setInterval(fetchLatestQuote, quoteSettings.intervalMs);
}

function stopQuotePolling() {
  if (quoteTimerId !== null) {
    window.clearInterval(quoteTimerId);
    quoteTimerId = null;
  }
}

async function fetchLatestQuote() {
  if (quoteFetchInFlight || !quoteSettings.enabled || !navigator.onLine) {
    return;
  }

  const endpoint = resolveQuoteEndpoint();
  quoteFetchInFlight = true;
  updateQuoteStatus("正在刷新国际金价和美元人民币汇率...");

  try {
    const [goldData, fxData] = await Promise.all([
      fetchJson(endpoint, "国际金价接口"),
      fetchJson(DIRECT_FX_QUOTE_URL, "美元人民币汇率接口"),
    ]);
    const goldPriceUsdPerOunce = Number(goldData.price);
    const usdCnyRate = parseUsdCnyRate(fxData);
    if (!Number.isFinite(goldPriceUsdPerOunce) || goldPriceUsdPerOunce <= 0) {
      throw new Error("国际金价无效");
    }
    if (!Number.isFinite(usdCnyRate) || usdCnyRate <= 0) {
      throw new Error("美元人民币汇率无效");
    }
    const priceCnyPerGram = goldPriceUsdPerOunce * usdCnyRate / TROY_OUNCE_GRAMS;

    latestQuote = {
      symbol: "XAU-CNY-G",
      name: "国际金价 人民币/克",
      price: priceCnyPerGram,
      quoteTime: normalizeQuoteTime(goldData.quoteTime ?? goldData.timestamp ?? goldData.updatedAt ?? goldData.updated_at ?? goldData.time),
      source: "Gold API + Frankfurter",
      stale: Boolean(goldData.stale),
      goldPriceUsdPerOunce,
      usdCnyRate,
      fxDate: fxData.date ?? null,
      fetchedAt: new Date().toISOString(),
    };
    updateQuoteStatus();
    runCalculation();
  } catch (error) {
    const fallback = latestQuote
      ? `行情暂不可用，保留上次价格 ${formatQuotePrice(latestQuote.price)}。`
      : `行情暂不可用：${error.message}`;
    updateQuoteStatus(fallback, true);
  } finally {
    quoteFetchInFlight = false;
  }
}

async function fetchJson(url, label) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${label}返回 ${response.status}`);
  }
  return response.json();
}

function parseUsdCnyRate(data) {
  return Number(data.rate ?? data.rates?.CNY);
}

function normalizeQuoteTime(value) {
  if (!value) {
    return new Date().toISOString();
  }

  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const numericValue = Number(value);
    const milliseconds = numericValue < 10_000_000_000 ? numericValue * 1000 : numericValue;
    return new Date(milliseconds).toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function handleQuoteSettingsChange() {
  readQuoteSettingsFromForm();
  restartQuotePolling(true);
  runCalculation();
}

function updateTodayLabel() {
  todayLabel.textContent = `今天: ${formatDateKey(getTodayDate())}`;
}

function updateOnlineStatus() {
  onlineStatus.textContent = navigator.onLine ? "在线" : "离线";
}

function handleOnlineStatusChange() {
  updateOnlineStatus();
  if (navigator.onLine) {
    restartQuotePolling(true);
  } else {
    stopQuotePolling();
    updateQuoteStatus();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runCalculation();
});

resetButton.addEventListener("click", resetInputs);
copyButton.addEventListener("click", copyResults);
addContractButton.addEventListener("click", addContract);
resetContractsButton.addEventListener("click", resetContracts);
optionTypeInputs.forEach((input) => input.addEventListener("change", runCalculation));
contractSelects.forEach((select) => select.addEventListener("change", runCalculation));
quoteEnabledInput.addEventListener("change", handleQuoteSettingsChange);
quoteIntervalInput.addEventListener("change", handleQuoteSettingsChange);

window.addEventListener("online", handleOnlineStatusChange);
window.addEventListener("offline", handleOnlineStatusChange);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && quoteSettings.enabled) {
    restartQuotePolling(true);
  }
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) {
    return;
  }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.hidden = true;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      setMessage("离线缓存注册失败，计算功能仍可正常使用。", true);
    });
  });
}

loadSettings();
loadContracts();
loadQuoteSettings();
updateTodayLabel();
renderContractManager();
renderContractSelects();
renderQuoteSettings();
updateOnlineStatus();
runCalculation();
restartQuotePolling(true);
