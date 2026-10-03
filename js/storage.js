// ===== Local persistence =====
// Saves and loads the source product data in this browser's localStorage.
// localStorage is only persistence: the app state lives in the `products` array in app.js.
// Nothing here is sent anywhere; it stays on this device.

const STORAGE_KEY = "restaurantProfitAnalyzer.products.v1";

// Possible results of loadSavedProducts().
const LOAD_STATUS = {
  FOUND: "found", // valid saved data (may be an intentionally empty list)
  MISSING: "missing", // nothing saved yet (first visit)
  CORRUPTED: "corrupted", // something is saved but it is not valid
  UNAVAILABLE: "unavailable" // the browser blocks localStorage
};

// Returns { status, products }. products is only set when status is FOUND.
function loadSavedProducts() {
  let rawValue;
  try {
    rawValue = window.localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    return { status: LOAD_STATUS.UNAVAILABLE, products: null };
  }

  // getItem returns null only when the key does not exist; "[]" is a saved empty list.
  if (rawValue === null) {
    return { status: LOAD_STATUS.MISSING, products: null };
  }

  const savedProducts = parseStoredProducts(rawValue);
  if (savedProducts === null) {
    return { status: LOAD_STATUS.CORRUPTED, products: null };
  }
  return { status: LOAD_STATUS.FOUND, products: savedProducts };
}

// Saves only the source fields. Returns false if the browser refuses to save.
function saveProducts(productList) {
  const sourceData = productList.map(function (product) {
    return {
      id: product.id,
      name: product.name,
      sellingPrice: product.sellingPrice,
      unitCost: product.unitCost,
      unitsSold: product.unitsSold
    };
  });

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sourceData));
    return true;
  } catch (error) {
    return false;
  }
}

// ===== Validation =====

// Returns a clean array of products, or null if anything in the saved data is invalid.
function parseStoredProducts(rawValue) {
  let parsedValue;
  try {
    parsedValue = JSON.parse(rawValue);
  } catch (error) {
    return null;
  }

  if (!Array.isArray(parsedValue)) {
    return null;
  }

  const cleanProducts = [];
  const usedIds = new Set();

  for (const storedProduct of parsedValue) {
    const cleanProduct = createValidProduct(storedProduct);

    // One invalid or duplicated product makes the whole saved list untrustworthy.
    if (cleanProduct === null || usedIds.has(cleanProduct.id)) {
      return null;
    }

    usedIds.add(cleanProduct.id);
    cleanProducts.push(cleanProduct);
  }

  return cleanProducts;
}

// Rebuilds a product with only the expected fields, or returns null if it is not valid.
function createValidProduct(storedProduct) {
  if (typeof storedProduct !== "object" || storedProduct === null || Array.isArray(storedProduct)) {
    return null;
  }

  const { id, name, sellingPrice, unitCost, unitsSold } = storedProduct;

  const isValid =
    Number.isSafeInteger(id) && id > 0 &&
    typeof name === "string" && name.trim() !== "" &&
    isNonNegativeFiniteNumber(sellingPrice) &&
    isNonNegativeFiniteNumber(unitCost) &&
    Number.isSafeInteger(unitsSold) && unitsSold >= 0;

  if (!isValid) {
    return null;
  }

  return { id, name: name.trim(), sellingPrice, unitCost, unitsSold };
}

function isNonNegativeFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
