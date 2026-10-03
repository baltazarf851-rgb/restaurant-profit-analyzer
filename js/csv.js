// ===== CSV: parsing, validation and export =====
// Pure functions only: no DOM access and no app state.
// Official format: Product Name,Selling Price,Unit Cost,Units Sold

const CSV_COLUMNS = [
  { key: "name", header: "Product Name" },
  { key: "sellingPrice", header: "Selling Price" },
  { key: "unitCost", header: "Unit Cost" },
  { key: "unitsSold", header: "Units Sold" }
];

const MAX_PRODUCT_NAME_LENGTH = 60; // same limit as the Product Name form field

// Spreadsheet apps treat cells starting with these characters as formulas.
const FORMULA_START_CHARACTERS = ["=", "+", "-", "@"];

// ===== Parsing =====

// Splits CSV text into rows of fields, following the usual CSV rules:
// commas separate fields, values may be wrapped in double quotes,
// and a quote inside a quoted value is written twice ("").
// Returns { rows: [{ line, fields }], error: null } or { rows: [], error: { line, message } }.
function parseCsv(text) {
  // Remove the UTF-8 BOM that some editors (like Excel) add at the start.
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const rows = [];
  let fields = [];
  let field = "";
  let inQuotes = false;
  let afterClosingQuote = false;
  let line = 1;
  let rowStartLine = 1;
  let quoteStartLine = 1;

  function failure(errorLine, message) {
    return { rows: [], error: { line: errorLine, message: message } };
  }

  function endRow() {
    fields.push(field);
    rows.push({ line: rowStartLine, fields: fields });
    fields = [];
    field = "";
    afterClosingQuote = false;
  }

  for (let index = 0; index < text.length; index++) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"'; // escaped quote
        index++;
      } else if (character === '"') {
        inQuotes = false;
        afterClosingQuote = true;
      } else {
        if (character === "\n") {
          line++;
        }
        field += character;
      }
      continue;
    }

    if (character === ",") {
      fields.push(field);
      field = "";
      afterClosingQuote = false;
    } else if (character === "\r" || character === "\n") {
      endRow();
      if (character === "\r" && text[index + 1] === "\n") {
        index++; // CRLF counts as a single line break
      }
      line++;
      rowStartLine = line;
    } else if (character === '"') {
      // A quote may only open a value (spaces before it are ignored).
      if (afterClosingQuote || field.trim() !== "") {
        return failure(line, 'Unexpected quote character. A value that contains quotes must be wrapped in double quotes, with each inner quote written twice ("").');
      }
      field = "";
      inQuotes = true;
      quoteStartLine = line;
    } else if (afterClosingQuote) {
      // Only spaces are allowed between a closing quote and the next comma.
      if (character !== " " && character !== "\t") {
        return failure(line, "Unexpected text after a closing quote.");
      }
    } else {
      field += character;
    }
  }

  if (inQuotes) {
    return failure(quoteStartLine, "A quoted value is never closed (missing closing quote).");
  }

  // Last row without a final line break.
  if (field !== "" || fields.length > 0 || afterClosingQuote) {
    endRow();
  }

  return { rows: rows, error: null };
}

// ===== Validation =====

// Turns CSV text into product data ({ name, sellingPrice, unitCost, unitsSold }).
// Returns { products, errors }. products is only filled when there are no errors at all.
function validateProductsCsv(text) {
  if (text.includes("\u0000")) {
    return failedImport([{ line: null, message: "This file doesn't look like a CSV text file." }]);
  }

  const parsed = parseCsv(text);
  if (parsed.error) {
    return failedImport([parsed.error]);
  }

  // Blank lines (or lines with only commas) are ignored anywhere in the file.
  const rows = parsed.rows.filter(function (row) {
    return row.fields.some(function (value) { return value.trim() !== ""; });
  });

  if (rows.length === 0) {
    return failedImport([{ line: null, message: "The file is empty." }]);
  }

  const headerResult = mapHeaders(rows[0]);
  if (headerResult.errors.length > 0) {
    return failedImport(headerResult.errors);
  }

  const dataRows = rows.slice(1);
  if (dataRows.length === 0) {
    return failedImport([{ line: null, message: "The file has the correct headers but no products." }]);
  }

  const products = [];
  const errors = [];

  dataRows.forEach(function (row) {
    const result = validateProductRow(row, headerResult.columnIndexes, rows[0].fields.length);
    if (result.errors.length > 0) {
      errors.push({ line: row.line, message: result.errors.join(" ") });
    } else {
      products.push(result.product);
    }
  });

  return errors.length > 0 ? failedImport(errors) : { products: products, errors: [] };
}

function failedImport(errors) {
  return { products: [], errors: errors };
}

// Header policy: the four required columns, in any order.
// Surrounding spaces and upper/lower case differences are ignored.
// Missing, duplicated or unknown columns are rejected.
function mapHeaders(headerRow) {
  const errors = [];
  const columnIndexes = {};
  const expectedHeaders = CSV_COLUMNS.map(function (column) { return column.header; }).join(", ");

  headerRow.fields.forEach(function (rawHeader, index) {
    const header = rawHeader.trim();
    const column = CSV_COLUMNS.find(function (item) {
      return item.header.toLowerCase() === header.toLowerCase();
    });

    if (!column) {
      errors.push({ line: headerRow.line, message: 'Unknown column "' + shortenForMessage(header) + '". Expected columns: ' + expectedHeaders + "." });
    } else if (column.key in columnIndexes) {
      errors.push({ line: headerRow.line, message: 'The column "' + column.header + '" appears more than once.' });
    } else {
      columnIndexes[column.key] = index;
    }
  });

  // No recognizable header at all: one clear message instead of a long list.
  if (Object.keys(columnIndexes).length === 0) {
    return {
      columnIndexes: columnIndexes,
      errors: [{ line: headerRow.line, message: "The first row must contain the column headers: " + expectedHeaders + "." }]
    };
  }

  CSV_COLUMNS.forEach(function (column) {
    if (!(column.key in columnIndexes)) {
      errors.push({ line: headerRow.line, message: 'Missing required column "' + column.header + '". Expected columns: ' + expectedHeaders + "." });
    }
  });

  return { columnIndexes: columnIndexes, errors: errors };
}

function validateProductRow(row, columnIndexes, expectedFieldCount) {
  if (row.fields.length !== expectedFieldCount) {
    return {
      errors: ["Expected " + expectedFieldCount + " values but found " + row.fields.length +
        ". Product names that contain commas must be wrapped in double quotes."]
    };
  }

  function valueOf(key) {
    return row.fields[columnIndexes[key]];
  }

  const name = parseProductName(valueOf("name"));
  const sellingPrice = parseMoneyValue(valueOf("sellingPrice"), "Selling Price");
  const unitCost = parseMoneyValue(valueOf("unitCost"), "Unit Cost");
  const unitsSold = parseUnitsValue(valueOf("unitsSold"));

  const errors = [name, sellingPrice, unitCost, unitsSold]
    .filter(function (result) { return result.error; })
    .map(function (result) { return result.error; });

  if (errors.length > 0) {
    return { errors: errors };
  }

  return {
    errors: [],
    product: { name: name.value, sellingPrice: sellingPrice.value, unitCost: unitCost.value, unitsSold: unitsSold.value }
  };
}

function parseProductName(rawValue) {
  const name = removeFormulaProtection(rawValue.trim());

  if (name === "") {
    return { error: "Product Name is empty." };
  }
  if (/[\r\n]/.test(name)) {
    return { error: "Product Name can't contain line breaks." };
  }
  if (name.length > MAX_PRODUCT_NAME_LENGTH) {
    return { error: "Product Name is longer than " + MAX_PRODUCT_NAME_LENGTH + " characters." };
  }
  return { value: name };
}

// Accepts only plain numbers like 12, 4.5 or 4.50 (no symbols, spaces, signs or thousands separators).
function parseMoneyValue(rawValue, label) {
  const text = rawValue.trim();

  if (text === "") {
    return { error: label + " is empty." };
  }
  if (/^-\d*\.?\d+$/.test(text)) {
    return { error: label + ' can\'t be negative (found "' + shortenForMessage(text) + '").' };
  }
  if (!/^\d+(\.\d+)?$/.test(text)) {
    return { error: label + ' must be a plain number like 12 or 4.50, without symbols or thousands separators (found "' + shortenForMessage(text) + '").' };
  }

  const value = Number(text);
  if (!Number.isFinite(value)) {
    return { error: label + " is too large." };
  }
  return { value: value };
}

// Accepts only whole numbers like 0 or 120.
function parseUnitsValue(rawValue) {
  const text = rawValue.trim();

  if (text === "") {
    return { error: "Units Sold is empty." };
  }
  if (/^-\d*\.?\d+$/.test(text)) {
    return { error: 'Units Sold can\'t be negative (found "' + shortenForMessage(text) + '").' };
  }
  if (/^\d*\.\d+$/.test(text)) {
    return { error: 'Units Sold must be a whole number (found "' + shortenForMessage(text) + '").' };
  }
  if (!/^\d+$/.test(text)) {
    return { error: 'Units Sold must be a whole number like 120, without symbols or thousands separators (found "' + shortenForMessage(text) + '").' };
  }

  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    return { error: "Units Sold is too large." };
  }
  return { value: value };
}

function shortenForMessage(text) {
  return text.length > 30 ? text.slice(0, 29) + "…" : text;
}

// ===== Export =====

// Builds a CSV with only the source fields (no ids, no calculated values).
// Starts with a UTF-8 BOM so spreadsheet apps read accents correctly; our importer removes it.
function createProductsCsv(productList) {
  const lines = [CSV_COLUMNS.map(function (column) { return column.header; }).join(",")];

  productList.forEach(function (product) {
    lines.push([
      escapeCsvValue(addFormulaProtection(product.name)),
      formatCsvNumber(product.sellingPrice),
      formatCsvNumber(product.unitCost),
      String(product.unitsSold)
    ].join(","));
  });

  return "﻿" + lines.join("\r\n") + "\r\n";
}

// Wraps a value in quotes when needed and doubles any quotes inside it.
function escapeCsvValue(value) {
  if (/[",\r\n]/.test(value) || value !== value.trim()) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

// Avoids scientific notation (e.g. 1e-7), which the importer would reject.
function formatCsvNumber(value) {
  const text = String(value);
  if (!/e/i.test(text)) {
    return text;
  }
  return value.toFixed(20).replace(/\.?0+$/, "");
}

// A name like "=SUM(A1)" could run as a formula when the file is opened in a spreadsheet,
// so it is exported as "'=SUM(A1)". The importer removes that apostrophe again.
function addFormulaProtection(name) {
  return FORMULA_START_CHARACTERS.includes(name[0]) ? "'" + name : name;
}

function removeFormulaProtection(name) {
  return name[0] === "'" && FORMULA_START_CHARACTERS.includes(name[1]) ? name.slice(1) : name;
}
