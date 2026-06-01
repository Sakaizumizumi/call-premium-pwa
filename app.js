const DEFAULT_INPUTS = {
  "future-price": "1025",
  "days-1": "55",
  "days-2": "65",
  "days-3": "75",
  volatility: "40%",
  "risk-free-rate": "0%",
  strikes: "1288:1160:-8",
};

const DEFAULT_OPTION_TYPE = "call";
const STORAGE_KEY = "call-premium-pwa-inputs-v1";
const PRECISION = 1;
const inputIds = Object.keys(DEFAULT_INPUTS);

const form = document.querySelector("#calculator-form");
const resultHead = document.querySelector("#result-head");
const resultBody = document.querySelector("#result-body");
const statusMessage = document.querySelector("#status-message");
const resetButton = document.querySelector("#reset-button");
const copyButton = document.querySelector("#copy-button");
const installButton = document.querySelector("#install-button");
const onlineStatus = document.querySelector("#online-status");
const optionTypeInputs = Array.from(document.querySelectorAll('input[name="option-type"]'));

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

function collectDays() {
  const fields = ["days-1", "days-2", "days-3"];
  const values = [];

  fields.forEach((id, index) => {
    const text = getInput(id).value.trim();
    if (!text) {
      return;
    }

    const value = Number(text);
    if (!Number.isFinite(value)) {
      throw new Error(`到期天数 ${index + 1} 需要是数字。`);
    }
    values.push(nonNegativeNumber(value, `到期天数 ${index + 1}`));
  });

  if (values.length === 0) {
    throw new Error("请至少输入一个到期天数。");
  }
  return values;
}

function parseStrikes(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("请输入行权价。");
  }

  const pythonRangeMatch = trimmed.match(/^range\(([^)]*)\)$/i);
  if (pythonRangeMatch) {
    return parsePythonRange(pythonRangeMatch[1]);
  }

  const rangeMatch = trimmed.match(/^\s*(-?\d+(?:\.\d+)?)\s*:\s*(-?\d+(?:\.\d+)?)(?:\s*:\s*(-?\d+(?:\.\d+)?))?\s*$/);
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const stop = Number(rangeMatch[2]);
    const step = rangeMatch[3] === undefined ? (stop >= start ? 1 : -1) : Number(rangeMatch[3]);
    return inclusiveRange(start, stop, step);
  }

  const values = trimmed
    .split(/[\s,;，、]+/)
    .filter(Boolean)
    .map((part) => Number(part));

  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("行权价需要是数字，或使用 1288:1160:-8 这样的区间。");
  }
  validateStrikes(values);
  return values;
}

function parsePythonRange(argsText) {
  const args = argsText
    .split(",")
    .map((arg) => arg.trim())
    .filter(Boolean)
    .map((arg) => Number(arg));

  if (![1, 2, 3].includes(args.length) || args.some((value) => !Number.isFinite(value))) {
    throw new Error("range() 需要 1 到 3 个数字参数。");
  }

  let start = 0;
  let stop = args[0];
  let step = 1;
  if (args.length === 2) {
    [start, stop] = args;
  }
  if (args.length === 3) {
    [start, stop, step] = args;
  }
  if (step === 0) {
    throw new Error("行权价区间步长不能为 0。");
  }

  const values = [];
  if (step > 0) {
    for (let value = start; value < stop; value += step) {
      values.push(displayNumber(value));
      limitRangeSize(values);
    }
  } else {
    for (let value = start; value > stop; value += step) {
      values.push(displayNumber(value));
      limitRangeSize(values);
    }
  }
  validateStrikes(values);
  return values;
}

function inclusiveRange(start, stop, step) {
  if (step === 0) {
    throw new Error("行权价区间步长不能为 0。");
  }
  if (start < stop && step < 0) {
    throw new Error("递增区间需要正步长。");
  }
  if (start > stop && step > 0) {
    throw new Error("递减区间需要负步长。");
  }

  const values = [];
  const tolerance = Math.abs(step) / 1_000_000;
  if (step > 0) {
    for (let value = start; value <= stop + tolerance; value += step) {
      values.push(displayNumber(value));
      limitRangeSize(values);
    }
  } else {
    for (let value = start; value >= stop - tolerance; value += step) {
      values.push(displayNumber(value));
      limitRangeSize(values);
    }
  }
  validateStrikes(values);
  return values;
}

function validateStrikes(values) {
  if (values.length === 0) {
    throw new Error("请输入至少一个行权价。");
  }
  if (values.some((value) => value <= 0)) {
    throw new Error("行权价必须全部大于 0。");
  }
}

function limitRangeSize(values) {
  if (values.length > 5000) {
    throw new Error("行权价数量过多，请缩小区间。");
  }
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

function formatDay(value) {
  return String(displayNumber(value));
}

function formatPremium(value) {
  return value.toFixed(PRECISION);
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

function buildPremiumColumns(days, optionType) {
  const selectedTypes = optionType === "both" ? ["call", "put"] : [optionType];
  return days.flatMap((day) =>
    selectedTypes.map((type) => ({
      day,
      type,
      label: `${formatDay(day)} 天${describeOptionType(type)}`,
      csvLabel: `${formatDay(day)} Days ${type === "call" ? "Call" : "Put"} Premium`,
    })),
  );
}

function calculateAll() {
  const futurePrice = positiveNumber("future-price", "期货价格");
  const days = collectDays();
  const optionType = getOptionType();
  const columns = buildPremiumColumns(days, optionType);
  const volatility = parsePercent("volatility", "隐含波动率");
  const riskFreeRate = parsePercent("risk-free-rate", "无风险利率");
  const strikes = parseStrikes(getInput("strikes").value);

  const rows = strikes.map((strike) => ({
    strike: displayNumber(strike),
    premiums: columns.map((column) =>
      calculatePremium(futurePrice, column.day, volatility, strike, riskFreeRate, column.type),
    ),
  }));

  lastResult = { columns, rows };
  renderTable(lastResult);
  saveInputs();
  setMessage(`已计算 ${rows.length} 个行权价，${days.length} 个到期天数，类型：${describeOptionType(optionType)}。`);
}

function renderTable(result) {
  resultHead.replaceChildren();
  resultBody.replaceChildren();

  const headerRow = document.createElement("tr");
  headerRow.append(createHeaderCell("行权价"));
  result.columns.forEach((column) => headerRow.append(createHeaderCell(column.label)));
  resultHead.append(headerRow);

  result.rows.forEach((row) => {
    const tableRow = document.createElement("tr");
    tableRow.append(createCell(row.strike));
    row.premiums.forEach((premium) => tableRow.append(createCell(formatPremium(premium))));
    resultBody.append(tableRow);
  });
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
    lines.push([row.strike, ...row.premiums.map(formatPremium)].join(","));
  });

  navigator.clipboard
    .writeText(lines.join("\n"))
    .then(() => setMessage("结果已复制到剪贴板。"))
    .catch(() => setMessage("复制失败，请检查浏览器剪贴板权限。", true));
}

function saveInputs() {
  const data = {};
  inputIds.forEach((id) => {
    data[id] = getInput(id).value;
  });
  data.optionType = getOptionType();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadInputs() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const values = saved ? { ...DEFAULT_INPUTS, ...JSON.parse(saved) } : DEFAULT_INPUTS;
  inputIds.forEach((id) => {
    getInput(id).value = values[id] ?? DEFAULT_INPUTS[id];
  });
  setOptionType(values.optionType ?? DEFAULT_OPTION_TYPE);
}

function resetInputs() {
  inputIds.forEach((id) => {
    getInput(id).value = DEFAULT_INPUTS[id];
  });
  setOptionType(DEFAULT_OPTION_TYPE);
  calculateAll();
}

function updateOnlineStatus() {
  onlineStatus.textContent = navigator.onLine ? "在线" : "离线";
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    calculateAll();
  } catch (error) {
    setMessage(error.message, true);
  }
});

resetButton.addEventListener("click", resetInputs);
copyButton.addEventListener("click", copyResults);
optionTypeInputs.forEach((input) => input.addEventListener("change", calculateAll));

window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);

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

loadInputs();
updateOnlineStatus();
calculateAll();
