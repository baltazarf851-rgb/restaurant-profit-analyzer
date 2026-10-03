// ===== CSV import / export interface =====
// Connects the CSV buttons to csv.js (parsing and validation) and app.js (products).
// Files are read and created entirely in the browser; nothing is uploaded.

const MAX_CSV_FILE_SIZE = 1024 * 1024; // 1 MB
const MAX_ERRORS_SHOWN = 25;
const EXPORT_FILE_NAME = "restaurant-profit-analyzer.csv";
const TEMPLATE_FILE_NAME = "restaurant-profit-analyzer-template.csv";

const importCsvButton = document.getElementById("import-csv-button");
const csvFileInput = document.getElementById("csv-file-input");
const exportCsvButton = document.getElementById("export-csv-button");
const downloadTemplateButton = document.getElementById("download-template-button");
const csvPreview = document.getElementById("csv-preview");

// Validated products waiting for confirmation. Temporary: `products` in app.js stays the only state.
let pendingImport = null;

// ===== Import =====

function handleImportButtonClick() {
  csvFileInput.value = ""; // allows selecting the same file again after fixing it
  csvFileInput.click();
}

async function handleCsvFileSelected() {
  const file = csvFileInput.files[0];
  if (!file) {
    return;
  }

  if (file.size > MAX_CSV_FILE_SIZE) {
    renderCsvPreview(file.name, { products: [], errors: [{ line: null, message: "The file is larger than 1 MB." }] });
    return;
  }

  let text;
  try {
    text = await file.text();
  } catch (error) {
    renderCsvPreview(file.name, { products: [], errors: [{ line: null, message: "The file could not be read." }] });
    return;
  }

  // The content is always validated, whatever the file extension says.
  renderCsvPreview(file.name, validateProductsCsv(text));
}

function handleConfirmImport() {
  if (!pendingImport) {
    return;
  }

  const importCount = pendingImport.products.length;
  const confirmed = window.confirm(
    "Import " + importCount + " " + pluralizeProducts(importCount) + "?\n\n" +
    "Your current " + products.length + " " + pluralizeProducts(products.length) +
    " will be replaced. This cannot be undone."
  );
  if (!confirmed) {
    return;
  }

  replaceAllProducts(pendingImport.products);
  closeCsvPreview();
  importCsvButton.focus();
}

function closeCsvPreview() {
  pendingImport = null;
  csvPreview.innerHTML = "";
  csvPreview.hidden = true;
}

function pluralizeProducts(count) {
  return count === 1 ? "product" : "products";
}

// ===== Preview =====

function renderCsvPreview(fileName, result) {
  const isValid = result.errors.length === 0;
  pendingImport = isValid ? { products: result.products } : null;

  csvPreview.innerHTML = "";

  const title = document.createElement("h3");
  title.className = "csv-preview-title";
  title.textContent = "Import preview";
  title.tabIndex = -1;
  csvPreview.appendChild(title);

  const fileLabel = document.createElement("p");
  fileLabel.className = "csv-file-name";
  fileLabel.textContent = "File: " + fileName;
  csvPreview.appendChild(fileLabel);

  const status = document.createElement("p");
  status.setAttribute("role", "status");

  if (isValid) {
    const count = result.products.length;
    status.className = "csv-status";
    status.textContent = "✓ " + count + " valid " + pluralizeProducts(count) + " ready to import. " +
      "Importing will replace your current products.";
    csvPreview.appendChild(status);
    csvPreview.appendChild(createPreviewTable(result.products));
  } else {
    status.className = "csv-status csv-status-error";
    status.textContent = "⚠ This file can't be imported. Fix the problems below and select the file again.";
    csvPreview.appendChild(status);
    csvPreview.appendChild(createErrorList(result.errors));
  }

  csvPreview.appendChild(createPreviewActions(isValid));
  csvPreview.hidden = false;

  // Move keyboard and screen reader focus to the preview.
  title.focus();
}

function createErrorList(errors) {
  const list = document.createElement("ul");
  list.className = "csv-error-list";

  errors.slice(0, MAX_ERRORS_SHOWN).forEach(function (error) {
    const item = document.createElement("li");
    item.textContent = (error.line ? "Row " + error.line + ": " : "") + error.message;
    list.appendChild(item);
  });

  if (errors.length > MAX_ERRORS_SHOWN) {
    const moreItem = document.createElement("li");
    moreItem.textContent = "…and " + (errors.length - MAX_ERRORS_SHOWN) + " more problems.";
    list.appendChild(moreItem);
  }
  return list;
}

function createPreviewTable(productList) {
  const wrapper = document.createElement("div");
  wrapper.className = "csv-preview-table-wrapper";

  const table = document.createElement("table");
  table.className = "products-table";

  const headerRow = document.createElement("tr");
  [["Product", ""], ["Selling Price", "numeric"], ["Unit Cost", "numeric"], ["Units Sold", "numeric"]].forEach(function (column) {
    const cell = document.createElement("th");
    cell.textContent = column[0];
    cell.className = column[1];
    headerRow.appendChild(cell);
  });
  const head = document.createElement("thead");
  head.appendChild(headerRow);
  table.appendChild(head);

  // createCell() comes from app.js and uses textContent, so names are never treated as HTML.
  const body = document.createElement("tbody");
  productList.forEach(function (product) {
    const row = document.createElement("tr");
    row.appendChild(createCell(product.name, "product-name"));
    row.appendChild(createCell(formatCurrency(product.sellingPrice), "numeric"));
    row.appendChild(createCell(formatCurrency(product.unitCost), "numeric"));
    row.appendChild(createCell(integerFormatter.format(product.unitsSold), "numeric"));
    body.appendChild(row);
  });
  table.appendChild(body);

  wrapper.appendChild(table);
  return wrapper;
}

function createPreviewActions(isValid) {
  const actions = document.createElement("div");
  actions.className = "csv-preview-actions";

  const importButton = document.createElement("button");
  importButton.type = "button";
  importButton.className = "btn btn-primary";
  importButton.textContent = "Import Products";
  importButton.disabled = !isValid;
  importButton.addEventListener("click", handleConfirmImport);

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "btn btn-secondary";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", function () {
    closeCsvPreview();
    importCsvButton.focus();
  });

  actions.appendChild(importButton);
  actions.appendChild(cancelButton);
  return actions;
}

// ===== Export and template =====

function handleExportCsv() {
  downloadTextFile(EXPORT_FILE_NAME, createProductsCsv(products));
}

function handleDownloadTemplate() {
  downloadTextFile(TEMPLATE_FILE_NAME, createProductsCsv(DEMO_PRODUCTS));
}

// Creates the file in memory and lets the browser download it.
function downloadTextFile(fileName, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(function () {
    URL.revokeObjectURL(url);
  }, 1000);
}

importCsvButton.addEventListener("click", handleImportButtonClick);
csvFileInput.addEventListener("change", handleCsvFileSelected);
exportCsvButton.addEventListener("click", handleExportCsv);
downloadTemplateButton.addEventListener("click", handleDownloadTemplate);
