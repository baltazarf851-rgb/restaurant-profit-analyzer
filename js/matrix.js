// ===== Menu Engineering Matrix =====
// Draws the results of calculateMenuEngineering() (app.js) as a native SVG chart.
// This file only handles drawing and interaction: it never recalculates or classifies.
// It reuses formatCurrency() and integerFormatter from app.js.

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const MATRIX_CATEGORY_NAMES = {
  star: "Star",
  plowhorse: "Plowhorse",
  puzzle: "Puzzle",
  dog: "Dog"
};

const QUADRANT_DETAILS = {
  puzzle: "High contribution · Low popularity",
  star: "High contribution · High popularity",
  dog: "Low contribution · Low popularity",
  plowhorse: "Low contribution · High popularity"
};

const POINT_RADIUS = 6;
const POINT_HIT_RADIUS = 14; // 28px target, easier to hover or tap than the dot itself
const PLOT_INSET = 16; // keeps points at the edges of the range from being cut off
const LABEL_HEIGHT = 14;
const MAX_LABEL_CHARACTERS = 18;

// Off-screen canvas used only to measure text width for label placement.
const measuringContext = document.createElement("canvas").getContext("2d");

// ===== Entry point =====

function renderMenuEngineeringMatrix(container, analysis) {
  container.innerHTML = "";

  const width = container.clientWidth;
  if (width === 0 || analysis.classifiedProducts.length === 0) {
    return;
  }

  const layout = createMatrixLayout(width);
  const points = analysis.classifiedProducts;

  const xDomain = calculateAxisDomain(
    points.map(function (point) { return point.popularityPercentage; }),
    analysis.popularityThreshold,
    layout.isCompact ? 4 : 6
  );
  const yDomain = calculateAxisDomain(
    points.map(function (point) { return point.contributionMargin; }),
    analysis.averageContributionMargin,
    5
  );

  // Higher values go up on the Y axis, so its pixel range is reversed.
  const xScale = createLinearScale(xDomain, layout.plot.left + PLOT_INSET, layout.plot.right - PLOT_INSET);
  const yScale = createLinearScale(yDomain, layout.plot.bottom - PLOT_INSET, layout.plot.top + PLOT_INSET);

  // The dividing lines sit exactly on the values used for classification.
  const thresholdX = xScale(analysis.popularityThreshold);
  const averageY = yScale(analysis.averageContributionMargin);

  const svg = createSvgElement("svg", {
    width: width,
    height: layout.height,
    viewBox: "0 0 " + width + " " + layout.height,
    role: "group",
    "aria-label": "Menu Engineering Matrix: popularity on the horizontal axis, contribution margin on the vertical axis. " +
      "Popularity Threshold " + analysis.popularityThreshold.toFixed(1) + "%, Average Contribution Margin " +
      formatCurrency(analysis.averageContributionMargin) + "."
  });

  drawQuadrants(svg, layout.plot, thresholdX, averageY);
  drawXAxis(svg, layout, xDomain, xScale, thresholdX, analysis.popularityThreshold);
  drawYAxis(svg, layout, yDomain, yScale, averageY, analysis.averageContributionMargin);
  drawThresholdLines(svg, layout.plot, thresholdX, averageY);
  const quadrantLabelBoxes = drawQuadrantLabels(svg, layout.plot, thresholdX, averageY);

  container.appendChild(svg);
  const tooltip = createTooltip(container);

  const groups = groupOverlappingPoints(points, xScale, yScale);
  drawPoints(svg, groups, tooltip, container);
  drawPointLabels(svg, groups, layout.plot, quadrantLabelBoxes);
}

// ===== Layout and scales =====

function createMatrixLayout(width) {
  const isCompact = width < 560;
  const height = Math.round(Math.min(460, Math.max(300, width * 0.6)));
  const margin = { top: 26, right: 12, bottom: 46, left: isCompact ? 48 : 58 };

  return {
    width: width,
    height: height,
    isCompact: isCompact,
    plot: {
      left: margin.left,
      top: margin.top,
      right: width - margin.right,
      bottom: height - margin.bottom
    }
  };
}

// Returns a rounded range that always contains zero, the threshold and every value.
function calculateAxisDomain(values, threshold, targetTickCount) {
  const lowest = Math.min(0, threshold, ...values);
  let highest = Math.max(0, threshold, ...values);

  // Avoids a zero-width range (e.g. every value is 0), which would divide by zero.
  if (highest === lowest) {
    highest = lowest + 1;
  }

  const step = calculateNiceStep(highest - lowest, targetTickCount);

  return {
    min: cleanNumber(Math.floor(lowest / step) * step),
    max: cleanNumber(Math.ceil(highest / step) * step),
    step: step
  };
}

// Picks a "round" tick step (1, 2, 5, 10, 20, 50...) for the given range.
function calculateNiceStep(range, targetTickCount) {
  const roughStep = range / targetTickCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalizedStep = roughStep / magnitude;

  let niceStep = 10;
  if (normalizedStep <= 1) {
    niceStep = 1;
  } else if (normalizedStep <= 2) {
    niceStep = 2;
  } else if (normalizedStep <= 5) {
    niceStep = 5;
  }
  return niceStep * magnitude;
}

function createLinearScale(domain, rangeStart, rangeEnd) {
  return function (value) {
    return rangeStart + ((value - domain.min) / (domain.max - domain.min)) * (rangeEnd - rangeStart);
  };
}

function createTicks(domain) {
  const ticks = [];
  const tickCount = Math.round((domain.max - domain.min) / domain.step);
  for (let index = 0; index <= tickCount; index++) {
    ticks.push(cleanNumber(domain.min + index * domain.step));
  }
  return ticks;
}

// Removes floating-point noise (0.30000000000000004 -> 0.3) and negative zero.
function cleanNumber(value) {
  return Number(value.toFixed(10)) + 0;
}

function decimalsForStep(step) {
  return step >= 1 ? 0 : Math.ceil(-Math.log10(step));
}

// ===== Background, axes and thresholds =====

function drawQuadrants(svg, plot, thresholdX, averageY) {
  const quadrants = [
    { category: "puzzle", x: plot.left, y: plot.top, width: thresholdX - plot.left, height: averageY - plot.top },
    { category: "star", x: thresholdX, y: plot.top, width: plot.right - thresholdX, height: averageY - plot.top },
    { category: "dog", x: plot.left, y: averageY, width: thresholdX - plot.left, height: plot.bottom - averageY },
    { category: "plowhorse", x: thresholdX, y: averageY, width: plot.right - thresholdX, height: plot.bottom - averageY }
  ];

  quadrants.forEach(function (quadrant) {
    svg.appendChild(createSvgElement("rect", {
      class: "matrix-quadrant quadrant-" + quadrant.category,
      x: quadrant.x,
      y: quadrant.y,
      width: Math.max(0, quadrant.width),
      height: Math.max(0, quadrant.height)
    }));
  });
}

function drawXAxis(svg, layout, domain, xScale, thresholdX, popularityThreshold) {
  const plot = layout.plot;
  const decimals = decimalsForStep(domain.step);
  const labelY = plot.bottom + 16;

  const thresholdText = popularityThreshold.toFixed(1) + "%";
  const thresholdHalfWidth = measureTextWidth(thresholdText, 11, 700) / 2;

  createTicks(domain).forEach(function (tick) {
    const x = xScale(tick);
    svg.appendChild(createSvgElement("line", { class: "matrix-gridline", x1: x, y1: plot.top, x2: x, y2: plot.bottom }));

    const tickText = tick.toFixed(decimals) + "%";
    const tickHalfWidth = measureTextWidth(tickText, 11, 400) / 2;
    // Skip tick labels that would collide with the threshold value.
    if (Math.abs(x - thresholdX) > thresholdHalfWidth + tickHalfWidth + 4) {
      svg.appendChild(createSvgText(tickText, { class: "matrix-tick", x: x, y: labelY, "text-anchor": "middle" }));
    }
  });

  svg.appendChild(createSvgElement("line", { class: "matrix-axis", x1: plot.left, y1: plot.bottom, x2: plot.right, y2: plot.bottom }));
  svg.appendChild(createSvgText(thresholdText, { class: "matrix-threshold-value", x: thresholdX, y: labelY, "text-anchor": "middle" }));
  svg.appendChild(createSvgText("Popularity →", { class: "matrix-axis-title", x: plot.right, y: layout.height - 6, "text-anchor": "end" }));
}

function drawYAxis(svg, layout, domain, yScale, averageY, averageContributionMargin) {
  const plot = layout.plot;
  const tickFormatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimalsForStep(domain.step),
    maximumFractionDigits: decimalsForStep(domain.step)
  });
  const labelX = plot.left - 8;

  createTicks(domain).forEach(function (tick) {
    const y = yScale(tick);
    svg.appendChild(createSvgElement("line", { class: "matrix-gridline", x1: plot.left, y1: y, x2: plot.right, y2: y }));

    // Skip tick labels that would collide with the average value.
    if (Math.abs(y - averageY) > LABEL_HEIGHT) {
      svg.appendChild(createSvgText(tickFormatter.format(tick), { class: "matrix-tick", x: labelX, y: y + 4, "text-anchor": "end" }));
    }
  });

  svg.appendChild(createSvgElement("line", { class: "matrix-axis", x1: plot.left, y1: plot.top, x2: plot.left, y2: plot.bottom }));
  svg.appendChild(createSvgText(formatCurrency(averageContributionMargin), {
    class: "matrix-threshold-value", x: labelX, y: averageY + 4, "text-anchor": "end"
  }));
  svg.appendChild(createSvgText("Contribution Margin ↑", { class: "matrix-axis-title", x: 0, y: 12 }));
}

function drawThresholdLines(svg, plot, thresholdX, averageY) {
  svg.appendChild(createSvgElement("line", { class: "matrix-threshold", x1: thresholdX, y1: plot.top, x2: thresholdX, y2: plot.bottom }));
  svg.appendChild(createSvgElement("line", { class: "matrix-threshold", x1: plot.left, y1: averageY, x2: plot.right, y2: averageY }));
}

// Writes each category name in the outer corner of its quadrant, only when it fits.
// Returns the occupied boxes so point labels can avoid them.
function drawQuadrantLabels(svg, plot, thresholdX, averageY) {
  const padding = 8;
  const corners = [
    { category: "puzzle", isTop: true, isLeft: true, width: thresholdX - plot.left, height: averageY - plot.top },
    { category: "star", isTop: true, isLeft: false, width: plot.right - thresholdX, height: averageY - plot.top },
    { category: "dog", isTop: false, isLeft: true, width: thresholdX - plot.left, height: plot.bottom - averageY },
    { category: "plowhorse", isTop: false, isLeft: false, width: plot.right - thresholdX, height: plot.bottom - averageY }
  ];
  const occupiedBoxes = [];

  corners.forEach(function (corner) {
    const name = MATRIX_CATEGORY_NAMES[corner.category].toUpperCase();
    const detail = QUADRANT_DETAILS[corner.category];
    const availableWidth = corner.width - padding * 2;
    const nameWidth = measureTextWidth(name, 12, 700) * 1.05; // includes letter-spacing
    const detailWidth = measureTextWidth(detail, 11, 400);

    if (nameWidth > availableWidth || corner.height < 24) {
      return;
    }
    const showDetail = detailWidth <= availableWidth && corner.height >= 40;
    const blockHeight = showDetail ? 30 : 16;
    const blockWidth = showDetail ? Math.max(nameWidth, detailWidth) : nameWidth;

    const x = corner.isLeft ? plot.left + padding : plot.right - padding;
    const anchor = corner.isLeft ? "start" : "end";
    const blockTop = corner.isTop ? plot.top + 4 : plot.bottom - 4 - blockHeight;

    svg.appendChild(createSvgText(name, { class: "matrix-quadrant-name", x: x, y: blockTop + 13, "text-anchor": anchor }));
    if (showDetail) {
      svg.appendChild(createSvgText(detail, { class: "matrix-quadrant-detail", x: x, y: blockTop + 27, "text-anchor": anchor }));
    }

    occupiedBoxes.push({
      x: corner.isLeft ? x : x - blockWidth,
      y: blockTop,
      width: blockWidth,
      height: blockHeight
    });
  });

  return occupiedBoxes;
}

// ===== Points =====

// Products with the same position (and category) share one point, so none is hidden behind another.
function groupOverlappingPoints(points, xScale, yScale) {
  const groupsByPosition = new Map();

  points.forEach(function (point) {
    const x = xScale(point.popularityPercentage);
    const y = yScale(point.contributionMargin);
    const key = Math.round(x) + "," + Math.round(y) + "," + point.category;

    if (!groupsByPosition.has(key)) {
      groupsByPosition.set(key, { x: x, y: y, category: point.category, products: [] });
    }
    groupsByPosition.get(key).products.push(point);
  });

  // Left-to-right order makes keyboard navigation follow the chart.
  return Array.from(groupsByPosition.values()).sort(function (a, b) {
    return a.x - b.x || a.y - b.y;
  });
}

function drawPoints(svg, groups, tooltip, container) {
  groups.forEach(function (group) {
    const pointElement = createSvgElement("g", {
      class: "matrix-point point-" + group.category,
      tabindex: "0",
      role: "button",
      "aria-label": describeGroup(group)
    });

    pointElement.appendChild(createSvgElement("circle", { class: "matrix-point-hit", cx: group.x, cy: group.y, r: POINT_HIT_RADIUS }));
    pointElement.appendChild(createSvgElement("circle", { class: "matrix-point-ring", cx: group.x, cy: group.y, r: POINT_RADIUS + 4 }));
    pointElement.appendChild(createSvgElement("circle", { class: "matrix-point-dot", cx: group.x, cy: group.y, r: POINT_RADIUS }));

    attachPointInteraction(pointElement, group, tooltip, container);
    svg.appendChild(pointElement);
  });
}

// Places each label to the right, left, above or below its point.
// If none of those spots is free, the label is skipped (the details stay in the tooltip and the cards).
function drawPointLabels(svg, groups, plot, quadrantLabelBoxes) {
  const occupiedBoxes = quadrantLabelBoxes.slice();

  groups.forEach(function (group) {
    occupiedBoxes.push({
      x: group.x - POINT_RADIUS - 2,
      y: group.y - POINT_RADIUS - 2,
      width: (POINT_RADIUS + 2) * 2,
      height: (POINT_RADIUS + 2) * 2
    });
  });

  groups.forEach(function (group) {
    const text = createPointLabelText(group);
    const width = measureTextWidth(text, 12, 600);
    const gap = POINT_RADIUS + 5;

    const candidates = [
      { x: group.x + gap, y: group.y - LABEL_HEIGHT / 2 },
      { x: group.x - gap - width, y: group.y - LABEL_HEIGHT / 2 },
      { x: group.x - width / 2, y: group.y - gap - LABEL_HEIGHT },
      { x: group.x - width / 2, y: group.y + gap }
    ];

    const freeSpot = candidates
      .map(function (candidate) {
        return { x: candidate.x, y: candidate.y, width: width, height: LABEL_HEIGHT };
      })
      .find(function (box) {
        return isBoxInsidePlot(box, plot) && !overlapsAnyBox(box, occupiedBoxes);
      });

    if (!freeSpot) {
      return;
    }

    occupiedBoxes.push(freeSpot);
    svg.appendChild(createSvgText(text, {
      class: "matrix-point-label",
      x: freeSpot.x,
      y: freeSpot.y + 11,
      "aria-hidden": "true"
    }));
  });
}

function createPointLabelText(group) {
  const firstName = group.products[0].name;
  const shortName = firstName.length > MAX_LABEL_CHARACTERS
    ? firstName.slice(0, MAX_LABEL_CHARACTERS - 1) + "…"
    : firstName;
  const extraCount = group.products.length - 1;
  return extraCount > 0 ? shortName + " +" + extraCount : shortName;
}

function isBoxInsidePlot(box, plot) {
  return box.x >= plot.left + 2 && box.x + box.width <= plot.right - 2 &&
    box.y >= plot.top + 2 && box.y + box.height <= plot.bottom - 2;
}

function overlapsAnyBox(box, otherBoxes) {
  return otherBoxes.some(function (other) {
    return box.x < other.x + other.width && box.x + box.width > other.x &&
      box.y < other.y + other.height && box.y + box.height > other.y;
  });
}

// Full text description for screen readers.
function describeGroup(group) {
  return group.products.map(function (product) {
    return product.name + ": " + MATRIX_CATEGORY_NAMES[product.category] +
      ", " + product.popularityPercentage.toFixed(1) + "% popularity" +
      ", " + formatCurrency(product.contributionMargin) + " contribution margin per unit" +
      ", selling price " + formatCurrency(product.sellingPrice) +
      ", unit cost " + formatCurrency(product.unitCost) +
      ", " + integerFormatter.format(product.unitsSold) + " units sold";
  }).join(". ");
}

// ===== Tooltip and interaction =====

function createTooltip(container) {
  const tooltip = document.createElement("div");
  tooltip.className = "matrix-tooltip";
  tooltip.hidden = true;
  tooltip.setAttribute("aria-hidden", "true"); // the same details are in each point's aria-label
  container.appendChild(tooltip);
  return tooltip;
}

// Mouse: hover. Touch: tap (the point receives focus). Keyboard: Tab to focus, Escape to close.
function attachPointInteraction(pointElement, group, tooltip, container) {
  function show() {
    showMatrixTooltip(tooltip, container, group, pointElement);
  }
  function hide() {
    hideMatrixTooltip(tooltip, container);
  }

  pointElement.addEventListener("pointerenter", function (event) {
    if (event.pointerType === "mouse") {
      show();
    }
  });
  pointElement.addEventListener("pointerleave", function (event) {
    if (event.pointerType === "mouse" && document.activeElement !== pointElement) {
      hide();
    }
  });
  pointElement.addEventListener("focus", show);
  pointElement.addEventListener("blur", hide);
  pointElement.addEventListener("click", function () {
    pointElement.focus();
    show();
  });
  pointElement.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      hide();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      show();
    }
  });
}

function showMatrixTooltip(tooltip, container, group, pointElement) {
  setActivePoint(container, pointElement);
  fillTooltip(tooltip, group);
  tooltip.hidden = false;

  // Center above the point; flip below if there is no room; keep inside the chart width.
  const tooltipWidth = tooltip.offsetWidth;
  const tooltipHeight = tooltip.offsetHeight;
  const offset = POINT_RADIUS + 10;

  const left = Math.min(Math.max(group.x - tooltipWidth / 2, 0), container.clientWidth - tooltipWidth);
  let top = group.y - offset - tooltipHeight;
  if (top < 0) {
    top = group.y + offset;
  }

  tooltip.style.left = Math.max(0, left) + "px";
  tooltip.style.top = top + "px";
}

function hideMatrixTooltip(tooltip, container) {
  tooltip.hidden = true;
  setActivePoint(container, null);
}

function setActivePoint(container, activeElement) {
  container.querySelectorAll(".matrix-point").forEach(function (element) {
    element.classList.toggle("is-active", element === activeElement);
  });
}

function fillTooltip(tooltip, group) {
  tooltip.innerHTML = "";

  group.products.forEach(function (product) {
    const block = document.createElement("div");
    block.className = "tooltip-product";

    const name = document.createElement("div");
    name.className = "tooltip-name";
    name.textContent = product.name;
    block.appendChild(name);

    const details = document.createElement("dl");
    details.style.margin = "0";
    [
      ["Category", MATRIX_CATEGORY_NAMES[product.category]],
      ["Popularity", product.popularityPercentage.toFixed(1) + "%"],
      ["Contribution Margin", formatCurrency(product.contributionMargin) + " / unit"],
      ["Selling Price", formatCurrency(product.sellingPrice)],
      ["Unit Cost", formatCurrency(product.unitCost)],
      ["Units Sold", integerFormatter.format(product.unitsSold)]
    ].forEach(function (row) {
      details.appendChild(createTooltipRow(row[0], row[1]));
    });

    block.appendChild(details);
    tooltip.appendChild(block);
  });
}

function createTooltipRow(label, value) {
  const row = document.createElement("div");
  row.className = "tooltip-row";

  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value;

  row.appendChild(term);
  row.appendChild(description);
  return row;
}

// On touch devices, tapping outside a point closes its tooltip.
document.addEventListener("pointerdown", function (event) {
  const activeElement = document.activeElement;
  if (activeElement && activeElement.classList && activeElement.classList.contains("matrix-point") &&
      !activeElement.contains(event.target)) {
    activeElement.blur();
  }
});

// ===== SVG helpers =====

function createSvgElement(tagName, attributes) {
  const element = document.createElementNS(SVG_NAMESPACE, tagName);
  Object.keys(attributes).forEach(function (name) {
    element.setAttribute(name, attributes[name]);
  });
  return element;
}

// textContent keeps product names from being interpreted as markup.
// Chart text is visual only: screen readers get the same details from each point's aria-label.
function createSvgText(text, attributes) {
  const element = createSvgElement("text", attributes);
  element.setAttribute("aria-hidden", "true");
  element.textContent = text;
  return element;
}

function measureTextWidth(text, fontSize, fontWeight) {
  measuringContext.font = fontWeight + " " + fontSize + "px " + getComputedStyle(document.body).fontFamily;
  return measuringContext.measureText(text).width;
}
