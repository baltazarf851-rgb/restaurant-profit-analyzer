// ===== State =====

// Demo products shown on the first visit and restored by "Reset Demo Data".
// Frozen so they can never be changed by accident; the app always works on a copy.
const DEMO_PRODUCTS = Object.freeze([
  Object.freeze({ id: 1, name: "Classic Burger", sellingPrice: 12, unitCost: 4.5, unitsSold: 120 }),
  Object.freeze({ id: 2, name: "Chicken Pasta", sellingPrice: 15, unitCost: 6, unitsSold: 80 }),
  Object.freeze({ id: 3, name: "Caesar Salad", sellingPrice: 10, unitCost: 3, unitsSold: 65 }),
  Object.freeze({ id: 4, name: "Iced Coffee", sellingPrice: 5, unitCost: 1.2, unitsSold: 150 })
]);

// The single source of truth. It is filled from localStorage (or the demo data) at startup.
let products = [];

let nextProductId = 1;

// Holds the id of the product being edited, or null when adding a new one.
let editingProductId = null;

// Width the matrix was last drawn at (used to skip unnecessary redraws on resize).
let lastMatrixWidth = 0;

// ===== DOM references =====

const productForm = document.getElementById("product-form");
const formTitle = document.getElementById("form-title");
const nameInput = document.getElementById("product-name");
const sellingPriceInput = document.getElementById("selling-price");
const unitCostInput = document.getElementById("unit-cost");
const unitsSoldInput = document.getElementById("units-sold");
const formError = document.getElementById("form-error");
const submitButton = document.getElementById("submit-button");
const cancelEditButton = document.getElementById("cancel-edit-button");
const tableBody = document.getElementById("products-table-body");
const emptyMessage = document.getElementById("empty-message");
const averageContributionElement = document.getElementById("average-contribution-margin");
const popularityThresholdElement = document.getElementById("popularity-threshold");
const engineeringNotice = document.getElementById("engineering-notice");
const categoryGrid = document.getElementById("category-grid");
const matrixBlock = document.getElementById("matrix-block");
const matrixChart = document.getElementById("matrix-chart");
const saveStatus = document.getElementById("save-status");
const resetDemoButton = document.getElementById("reset-demo-button");
const storageNotice = document.getElementById("storage-notice");
const storageNoticeText = document.getElementById("storage-notice-text");
const dismissNoticeButton = document.getElementById("dismiss-notice-button");

// ===== Formatting =====

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD"
});

const integerFormatter = new Intl.NumberFormat("en-US");

function formatCurrency(amount) {
  return currencyFormatter.format(amount);
}

// margin is null when it can't be calculated (revenue is 0).
function formatMargin(margin) {
  if (margin === null) {
    return "—";
  }
  return margin.toFixed(1) + "%";
}

// ===== Calculations =====

// Returns null instead of dividing by zero.
function calculateMargin(grossProfit, revenue) {
  if (revenue === 0) {
    return null;
  }
  return (grossProfit / revenue) * 100;
}

function calculateProductMetrics(product) {
  const revenue = product.sellingPrice * product.unitsSold;
  const totalCost = product.unitCost * product.unitsSold;
  const grossProfit = revenue - totalCost;
  const margin = calculateMargin(grossProfit, revenue);

  return { revenue, totalCost, grossProfit, margin };
}

// The overall margin uses the global totals, not an average of individual margins.
function calculateTotals(productList) {
  let totalRevenue = 0;
  let totalCost = 0;

  productList.forEach(function (product) {
    const metrics = calculateProductMetrics(product);
    totalRevenue += metrics.revenue;
    totalCost += metrics.totalCost;
  });

  const totalProfit = totalRevenue - totalCost;
  const overallMargin = calculateMargin(totalProfit, totalRevenue);

  return { totalRevenue, totalCost, totalProfit, overallMargin };
}

// ===== Menu Engineering =====

const CATEGORY_KEYS = ["star", "plowhorse", "puzzle", "dog"];

// Products below Expected Popularity × 0.70 are considered low popularity.
const POPULARITY_THRESHOLD_FACTOR = 0.7;

// Tiny tolerance so floating-point noise (e.g. 0.1 + 0.2) never flips a classification
// when a value is exactly equal to its threshold.
const COMPARISON_TOLERANCE = 1e-9;

function isAtLeast(value, threshold) {
  return value >= threshold - COMPARISON_TOLERANCE;
}

function calculateContributionMargin(product) {
  return product.sellingPrice - product.unitCost;
}

function classifyProduct(isHighPopularity, isHighContribution) {
  if (isHighPopularity && isHighContribution) return "star";
  if (isHighPopularity) return "plowhorse";
  if (isHighContribution) return "puzzle";
  return "dog";
}

// Returns the thresholds plus each product with its category.
// classifiedProducts stays empty when there are no products or no sales yet.
function calculateMenuEngineering(productList) {
  const productCount = productList.length;

  if (productCount === 0) {
    return { averageContributionMargin: null, popularityThreshold: null, hasSales: false, classifiedProducts: [] };
  }

  let totalContributionMargin = 0;
  let totalUnitsSold = 0;

  productList.forEach(function (product) {
    totalContributionMargin += calculateContributionMargin(product);
    totalUnitsSold += product.unitsSold;
  });

  const averageContributionMargin = totalContributionMargin / productCount;
  const expectedPopularity = 100 / productCount;
  const popularityThreshold = expectedPopularity * POPULARITY_THRESHOLD_FACTOR;
  const hasSales = totalUnitsSold > 0;

  let classifiedProducts = [];

  if (hasSales) {
    classifiedProducts = productList.map(function (product) {
      const contributionMargin = calculateContributionMargin(product);
      const popularityPercentage = (product.unitsSold / totalUnitsSold) * 100;
      const isHighContribution = isAtLeast(contributionMargin, averageContributionMargin);
      const isHighPopularity = isAtLeast(popularityPercentage, popularityThreshold);

      return {
        name: product.name,
        sellingPrice: product.sellingPrice,
        unitCost: product.unitCost,
        unitsSold: product.unitsSold,
        contributionMargin,
        popularityPercentage,
        category: classifyProduct(isHighPopularity, isHighContribution)
      };
    });
  }

  return { averageContributionMargin, popularityThreshold, hasSales, classifiedProducts };
}

// ===== Validation =====

// Reads the form and returns { product } when valid, or { error, input } pointing at the invalid field.
function readFormValues() {
  const name = nameInput.value.trim();
  const sellingPrice = parseNonNegativeNumber(sellingPriceInput.value);
  const unitCost = parseNonNegativeNumber(unitCostInput.value);
  const unitsSold = parseNonNegativeNumber(unitsSoldInput.value);

  if (name === "") {
    return { error: "Please enter a product name.", input: nameInput };
  }
  if (sellingPrice === null) {
    return { error: "Selling Price must be a number of 0 or more.", input: sellingPriceInput };
  }
  if (unitCost === null) {
    return { error: "Unit Cost must be a number of 0 or more.", input: unitCostInput };
  }
  // Same rule as the saved-data validation (storage.js), so a saved list is never rejected on reload.
  if (unitsSold === null || !Number.isSafeInteger(unitsSold)) {
    return { error: "Units Sold must be a whole number of 0 or more.", input: unitsSoldInput };
  }

  return { product: { name, sellingPrice, unitCost, unitsSold } };
}

// Returns a valid number, or null if the text is empty, not a number, or negative.
function parseNonNegativeNumber(text) {
  if (text.trim() === "") {
    return null;
  }
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

// ===== Rendering =====

function render() {
  renderDashboard();
  renderTable();
  renderMenuEngineering();
}

function renderDashboard() {
  const totals = calculateTotals(products);

  document.getElementById("total-revenue").textContent = formatCurrency(totals.totalRevenue);
  document.getElementById("total-cost").textContent = formatCurrency(totals.totalCost);

  const profitElement = document.getElementById("total-profit");
  profitElement.textContent = formatCurrency(totals.totalProfit);
  setSignClass(profitElement, totals.totalProfit);

  const marginElement = document.getElementById("overall-margin");
  marginElement.textContent = formatMargin(totals.overallMargin);
  setSignClass(marginElement, totals.overallMargin);
}

function renderTable() {
  tableBody.innerHTML = "";

  products.forEach(function (product) {
    tableBody.appendChild(createProductRow(product));
  });

  emptyMessage.hidden = products.length > 0;
}

function createProductRow(product) {
  const metrics = calculateProductMetrics(product);
  const row = document.createElement("tr");

  if (product.id === editingProductId) {
    row.classList.add("is-editing");
  }

  // textContent is used so product names are never interpreted as HTML.
  row.appendChild(createCell(product.name, "product-name"));
  row.appendChild(createCell(formatCurrency(product.sellingPrice), "numeric"));
  row.appendChild(createCell(formatCurrency(product.unitCost), "numeric"));
  row.appendChild(createCell(integerFormatter.format(product.unitsSold), "numeric"));
  row.appendChild(createCell(formatCurrency(metrics.revenue), "numeric"));

  const profitCell = createCell(formatCurrency(metrics.grossProfit), "numeric");
  setSignClass(profitCell, metrics.grossProfit);
  row.appendChild(profitCell);

  const marginCell = createCell(formatMargin(metrics.margin), "numeric");
  setSignClass(marginCell, metrics.margin);
  row.appendChild(marginCell);

  row.appendChild(createActionsCell(product.id));

  return row;
}

function createCell(text, className) {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) {
    cell.className = className;
  }
  return cell;
}

function createActionsCell(productId) {
  const cell = document.createElement("td");
  const wrapper = document.createElement("div");
  wrapper.className = "row-actions";

  const editButton = createButton("Edit", "btn btn-secondary btn-small", function () {
    startEditing(productId);
  });
  const deleteButton = createButton("Delete", "btn btn-danger btn-small", function () {
    deleteProduct(productId);
  });

  wrapper.appendChild(editButton);
  wrapper.appendChild(deleteButton);
  cell.appendChild(wrapper);
  return cell;
}

function createButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function renderMenuEngineering() {
  const analysis = calculateMenuEngineering(products);

  averageContributionElement.textContent =
    analysis.averageContributionMargin === null ? "—" : formatCurrency(analysis.averageContributionMargin);
  setSignClass(averageContributionElement, analysis.averageContributionMargin);

  popularityThresholdElement.textContent =
    analysis.popularityThreshold === null ? "—" : analysis.popularityThreshold.toFixed(1) + "%";

  // Only show the category groups when the products can actually be classified.
  if (products.length === 0) {
    showEngineeringNotice("Add products to see the Menu Engineering analysis.");
    return;
  }
  if (!analysis.hasSales) {
    showEngineeringNotice("Classification will appear once at least one product has units sold.");
    return;
  }

  engineeringNotice.hidden = true;
  categoryGrid.hidden = false;
  matrixBlock.hidden = false;

  // The matrix only draws the results; it never recalculates them.
  renderMenuEngineeringMatrix(matrixChart, analysis);
  lastMatrixWidth = matrixChart.clientWidth;

  CATEGORY_KEYS.forEach(function (categoryKey) {
    const productsInCategory = analysis.classifiedProducts.filter(function (item) {
      return item.category === categoryKey;
    });
    renderCategoryList(categoryKey, productsInCategory);
  });
}

function showEngineeringNotice(message) {
  engineeringNotice.textContent = message;
  engineeringNotice.hidden = false;
  categoryGrid.hidden = true;
  matrixBlock.hidden = true;
}

function renderCategoryList(categoryKey, productsInCategory) {
  const list = document.getElementById("list-" + categoryKey);
  const countElement = document.getElementById("count-" + categoryKey);
  countElement.textContent = productsInCategory.length;
  // Screen-reader-only suffix next to the count ("1 item" / "2 items").
  countElement.nextElementSibling.textContent = productsInCategory.length === 1 ? " item" : " items";
  list.innerHTML = "";

  if (productsInCategory.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "category-empty";
    emptyItem.textContent = "No products in this category.";
    list.appendChild(emptyItem);
    return;
  }

  productsInCategory.forEach(function (item) {
    list.appendChild(createCategoryItem(item));
  });
}

function createCategoryItem(item) {
  const listItem = document.createElement("li");
  listItem.className = "category-item";

  const name = document.createElement("span");
  name.className = "category-item-name";
  name.textContent = item.name;

  const stats = document.createElement("span");
  stats.className = "category-item-stats";

  const contribution = document.createElement("span");
  contribution.textContent = formatCurrency(item.contributionMargin) + " / unit";
  setSignClass(contribution, item.contributionMargin);

  const popularity = document.createElement("span");
  popularity.textContent = item.popularityPercentage.toFixed(1) + "% popularity";

  stats.appendChild(contribution);
  stats.appendChild(popularity);
  listItem.appendChild(name);
  listItem.appendChild(stats);
  return listItem;
}

// Colors negative values red; leaves zero and positive values neutral.
function setSignClass(element, value) {
  element.classList.toggle("value-negative", value !== null && value < 0);
}

// ===== Persistence =====

function createDemoProducts() {
  return DEMO_PRODUCTS.map(function (product) {
    return { ...product };
  });
}

// New ids always start after the highest existing id, so they never collide with loaded products.
function calculateNextProductId(productList) {
  const highestId = productList.reduce(function (highest, product) {
    return Math.max(highest, product.id);
  }, 0);
  return highestId + 1;
}

// Runs once at startup: localStorage is read here and nowhere else.
function initializeProducts() {
  const result = loadSavedProducts();

  if (result.status === LOAD_STATUS.FOUND) {
    // Includes an intentionally saved empty list: demo data is not added back.
    products = result.products;
  } else {
    products = createDemoProducts();
  }

  if (result.status === LOAD_STATUS.CORRUPTED) {
    showStorageNotice("Your saved products could not be recovered, so the demo data was restored.");
    persistProducts(); // replaces the unreadable data
  }

  if (result.status === LOAD_STATUS.UNAVAILABLE) {
    showSaveStatus(false);
  }

  nextProductId = calculateNextProductId(products);
}

function persistProducts() {
  showSaveStatus(saveProducts(products));
}

function showSaveStatus(wasSaved) {
  saveStatus.textContent = wasSaved
    ? "Saved automatically in this browser only"
    : "Changes can't be saved in this browser";
  saveStatus.classList.toggle("is-error", !wasSaved);
}

function showStorageNotice(message) {
  storageNoticeText.textContent = message;
  storageNotice.hidden = false;
}

function hideStorageNotice() {
  storageNotice.hidden = true;
}

// ===== Actions =====

function addProduct(productData) {
  products.push({ id: nextProductId, ...productData });
  nextProductId++;
}

function updateProduct(productId, productData) {
  products = products.map(function (product) {
    return product.id === productId ? { id: productId, ...productData } : product;
  });
}

function deleteProduct(productId) {
  products = products.filter(function (product) {
    return product.id !== productId;
  });

  // If the deleted product was being edited, leave edit mode.
  if (productId === editingProductId) {
    stopEditing();
  }

  persistProducts();
  render();
}

// Replaces every product (used by Reset Demo Data and CSV import).
// Ids are generated again from 1, so they are always unique.
function replaceAllProducts(productDataList) {
  if (editingProductId !== null) {
    stopEditing();
  }
  products = productDataList.map(function (data, index) {
    return {
      id: index + 1,
      name: data.name,
      sellingPrice: data.sellingPrice,
      unitCost: data.unitCost,
      unitsSold: data.unitsSold
    };
  });
  nextProductId = calculateNextProductId(products);
  hideStorageNotice();
  persistProducts();
  render();
}

function resetToDemoData() {
  replaceAllProducts(createDemoProducts());
}

function startEditing(productId) {
  const product = products.find(function (item) {
    return item.id === productId;
  });
  if (!product) {
    return;
  }

  editingProductId = productId;

  nameInput.value = product.name;
  sellingPriceInput.value = product.sellingPrice;
  unitCostInput.value = product.unitCost;
  unitsSoldInput.value = product.unitsSold;

  formTitle.textContent = "Edit Product";
  submitButton.textContent = "Save Changes";
  cancelEditButton.hidden = false;
  formError.textContent = "";
  clearInvalidFields();

  render();
  productForm.scrollIntoView({ behavior: "smooth", block: "start" });
  nameInput.focus({ preventScroll: true });
}

function stopEditing() {
  editingProductId = null;
  resetForm();
  formTitle.textContent = "Add Product";
  submitButton.textContent = "Add Product";
  cancelEditButton.hidden = true;
}

function resetForm() {
  productForm.reset();
  formError.textContent = "";
  clearInvalidFields();
}

function clearInvalidFields() {
  [nameInput, sellingPriceInput, unitCostInput, unitsSoldInput].forEach(function (input) {
    input.removeAttribute("aria-invalid");
  });
}

// ===== Event handlers =====

function handleFormSubmit(event) {
  event.preventDefault();

  const result = readFormValues();
  clearInvalidFields();
  if (result.error) {
    formError.textContent = result.error;
    result.input.setAttribute("aria-invalid", "true");
    result.input.focus();
    return;
  }

  if (editingProductId === null) {
    addProduct(result.product);
    resetForm();
  } else {
    updateProduct(editingProductId, result.product);
    stopEditing();
  }

  persistProducts();
  render();
  nameInput.focus();
}

function handleCancelEdit() {
  stopEditing();
  render();
}

// Nothing changes unless the user confirms.
function handleResetDemoData() {
  const confirmed = window.confirm(
    "Reset to demo data?\n\n" +
    "All current products will be replaced by the 4 demo products. This cannot be undone."
  );
  if (confirmed) {
    resetToDemoData();
  }
}

// The matrix is drawn at the container's real pixel width, so redraw it only when that width changes.
function handleWindowResize() {
  const currentWidth = matrixChart.clientWidth;
  if (currentWidth !== lastMatrixWidth) {
    lastMatrixWidth = currentWidth;
    renderMenuEngineering();
  }
}

productForm.addEventListener("submit", handleFormSubmit);
cancelEditButton.addEventListener("click", handleCancelEdit);
resetDemoButton.addEventListener("click", handleResetDemoData);
dismissNoticeButton.addEventListener("click", hideStorageNotice);
window.addEventListener("resize", handleWindowResize);

// Startup: load products (saved data or demo), then draw everything from them.
initializeProducts();
render();
