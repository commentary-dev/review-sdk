(function commentaryReviewSdk() {
  const PROTOCOL = "commentary-review-v1";
  const SDK_VERSION = "0.1.0";
  const TEXT_LIMIT = 200;
  const parentOrigin = window.__COMMENTARY_PARENT_ORIGIN__ || new URL(document.referrer || "http://localhost:3001").origin;
  const generatedPattern = /^(?::r[\da-z]+:|headlessui-[\w-]+|radix-:r[\da-z]+:|ember\d+|[a-f0-9]{12,}|[a-z0-9_-]{24,}|_[a-z]+_[a-z0-9]{4,}_\d+|[a-z][\w-]*__[a-z0-9_-]{5,})$/iu;
  const sensitivePattern = /(?:password|passwd|token|secret|api[-_\s]?key|access[-_\s]?key|credential|credit[-_\s]?card|card[-_\s]?number|ssn|social[-_\s]?security)/iu;
  let reviewId = null;
  let sessionNonce = null;
  let pickerEnabled = false;
  let hoveredElement = null;
  let selectedElement = null;
  let lastRoute = getRoute();
  let routeTimer = null;

  const overlay = document.createElement("div");
  overlay.setAttribute("data-commentary-review-highlight", "true");
  Object.assign(overlay.style, {
    position: "fixed",
    zIndex: "2147483647",
    pointerEvents: "none",
    border: "2px solid #0969da",
    background: "rgba(9, 105, 218, 0.10)",
    boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.85)",
    borderRadius: "4px",
    display: "none",
  });
  document.documentElement.appendChild(overlay);

  function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/gu, " ").trim();
  }

  function truncate(value) {
    const normalized = normalizeWhitespace(value);
    return normalized.length > TEXT_LIMIT ? `${normalized.slice(0, TEXT_LIMIT - 1).trimEnd()}...` : normalized;
  }

  function getAttr(element, name) {
    const value = element.getAttribute(name);
    return value && value.trim() ? value.trim() : null;
  }

  function attrSelector(name, value) {
    return `[${name}='${value.replace(/\\/gu, "\\\\").replace(/'/gu, "\\'")}']`;
  }

  function escapeIdentifier(value) {
    return window.CSS?.escape ? window.CSS.escape(value) : value.replace(/(^-?\d)|[^\w-]/gu, "\\$&");
  }

  function isGenerated(value) {
    const normalized = String(value || "").trim();
    if (!normalized || generatedPattern.test(normalized)) {
      return true;
    }
    const compact = normalized.replace(/[-_:]/gu, "");
    const vowels = compact.match(/[aeiou]/giu)?.length || 0;
    return compact.length >= 10 && /^[a-z0-9]+$/iu.test(compact) && vowels <= Math.max(1, compact.length * 0.15);
  }

  function getRole(element) {
    const explicitRole = getAttr(element, "role");
    if (explicitRole) {
      return explicitRole.split(/\s+/u)[0] || null;
    }
    const tagName = element.tagName.toLowerCase();
    if (tagName === "button") {
      return "button";
    }
    if (tagName === "a" && getAttr(element, "href")) {
      return "link";
    }
    if (tagName === "img") {
      return "img";
    }
    if (tagName === "input") {
      const type = (getAttr(element, "type") || "text").toLowerCase();
      if (type === "checkbox") {
        return "checkbox";
      }
      if (type === "radio") {
        return "radio";
      }
      return type === "submit" || type === "button" ? "button" : "textbox";
    }
    if (tagName === "textarea") {
      return "textbox";
    }
    if (tagName === "select") {
      return "combobox";
    }
    return null;
  }

  function associatedLabelText(element) {
    if (element.id) {
      const label = document.querySelector(`label[for='${element.id.replace(/'/gu, "\\'")}']`);
      if (label?.textContent) {
        return normalizeWhitespace(label.textContent);
      }
    }
    const closest = element.closest("label");
    return closest?.textContent ? normalizeWhitespace(closest.textContent) : null;
  }

  function accessibleName(element) {
    const ariaLabel = getAttr(element, "aria-label");
    if (ariaLabel) {
      return truncate(ariaLabel);
    }
    const labelledBy = getAttr(element, "aria-labelledby");
    if (labelledBy) {
      const labels = labelledBy
        .split(/\s+/u)
        .map((id) => document.getElementById(id)?.textContent || "")
        .map(normalizeWhitespace)
        .filter(Boolean);
      if (labels.length > 0) {
        return truncate(labels.join(" "));
      }
    }
    const tagName = element.tagName.toLowerCase();
    if (tagName === "img") {
      return getAttr(element, "alt");
    }
    if (/^(?:input|textarea|select|option)$/iu.test(tagName)) {
      const label = associatedLabelText(element);
      if (label) {
        return truncate(label);
      }
    }
    if (tagName === "button" || tagName === "a") {
      const text = normalizeWhitespace(element.textContent);
      if (text) {
        return truncate(text);
      }
    }
    return getAttr(element, "title");
  }

  function isSensitive(element) {
    const tagName = element.tagName.toLowerCase();
    if (tagName === "input") {
      const type = (getAttr(element, "type") || "text").toLowerCase();
      if (type === "password" || type === "hidden") {
        return true;
      }
    }
    return [element.id, getAttr(element, "name"), getAttr(element, "aria-label"), getAttr(element, "placeholder"), getAttr(element, "data-commentary-id")]
      .some((field) => field ? sensitivePattern.test(field) : false);
  }

  function textSnippet(element, name) {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || isSensitive(element)) {
      return null;
    }
    if (/^(?:input|textarea|select|option)$/iu.test(element.tagName)) {
      return getAttr(element, "placeholder") ? truncate(getAttr(element, "placeholder")) : name;
    }
    const text = normalizeWhitespace(element.textContent);
    return text ? truncate(text) : name;
  }

  function nthOfType(element) {
    let index = 1;
    let sibling = element.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === element.tagName) {
        index += 1;
      }
      sibling = sibling.previousElementSibling;
    }
    return index;
  }

  function fallbackSelector(element) {
    const segments = [];
    let current = element;
    while (current && current.tagName.toLowerCase() !== "html") {
      const tagName = current.tagName.toLowerCase();
      const stableId = current.id && !isGenerated(current.id) ? `#${escapeIdentifier(current.id)}` : "";
      segments.unshift(stableId ? `${tagName}${stableId}` : `${tagName}:nth-of-type(${nthOfType(current)})`);
      if (stableId || tagName === "body") {
        break;
      }
      current = current.parentElement;
    }
    return segments.join(" > ");
  }

  function semanticSelector(element) {
    const segments = [];
    let current = element;
    let stable = false;
    while (current && current.tagName.toLowerCase() !== "html" && segments.length < 5) {
      const tagName = current.tagName.toLowerCase();
      const stableId = current.id && !isGenerated(current.id) ? `#${escapeIdentifier(current.id)}` : "";
      const classes = Array.from(current.classList || [])
        .filter((className) => !isGenerated(className) && /^[a-z][\w-]*$/iu.test(className))
        .slice(0, 2)
        .map((className) => `.${escapeIdentifier(className)}`)
        .join("");
      const segment = stableId ? `${tagName}${stableId}` : `${tagName}${classes}`;
      stable = stable || Boolean(stableId || classes);
      segments.unshift(segment);
      if (stableId) {
        break;
      }
      current = current.parentElement;
    }
    return stable ? segments.join(" > ") : null;
  }

  function selectors(element, name) {
    const commentaryId = getAttr(element, "data-commentary-id");
    const testId = getAttr(element, "data-testid");
    const stableId = element.id && !isGenerated(element.id) ? `#${escapeIdentifier(element.id)}` : null;
    const role = getRole(element);
    const roleSelector = role && name && getAttr(element, "aria-label")
      ? `${getAttr(element, "role") ? attrSelector("role", role) : element.tagName.toLowerCase()}${attrSelector("aria-label", getAttr(element, "aria-label"))}`
      : null;
    return {
      selector: commentaryId
        ? attrSelector("data-commentary-id", commentaryId)
        : testId
          ? attrSelector("data-testid", testId)
          : stableId || roleSelector || semanticSelector(element) || fallbackSelector(element),
      fallbackSelector: fallbackSelector(element),
    };
  }

  function rect(element) {
    const box = element.getBoundingClientRect();
    return {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
    };
  }

  function component(element) {
    const id = getAttr(element, "data-commentary-id");
    const name = getAttr(element, "data-commentary-component");
    const source = getAttr(element, "data-commentary-source");
    if (!id && !name && !source) {
      return null;
    }
    const match = /^(.*?)(?::(\d+))?(?::(\d+))?$/u.exec(source || "");
    return {
      id,
      name,
      file: match?.[1] || null,
      line: match?.[2] ? Number.parseInt(match[2], 10) : null,
      column: match?.[3] ? Number.parseInt(match[3], 10) : null,
    };
  }

  function getRoute() {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }

  function elementContext(element) {
    const name = accessibleName(element);
    return {
      ...selectors(element, name),
      tagName: element.tagName.toLowerCase(),
      role: getRole(element),
      accessibleName: name,
      textSnippet: textSnippet(element, name),
      boundingRect: rect(element),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        deviceScaleFactor: window.devicePixelRatio,
      },
      component: component(element),
      route: getRoute(),
      url: window.location.href,
      origin: window.location.origin,
      commitSha: window.__COMMENTARY_COMMIT_SHA__ || null,
    };
  }

  function selectedPayload(element) {
    return {
      url: window.location.href,
      origin: window.location.origin,
      route: getRoute(),
      commitSha: window.__COMMENTARY_COMMIT_SHA__ || null,
      buildId: window.__COMMENTARY_BUILD_ID__ || null,
      element: elementContext(element),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        deviceScaleFactor: window.devicePixelRatio,
      },
    };
  }

  function post(type, payload) {
    window.parent.postMessage({
      protocol: PROTOCOL,
      type,
      reviewId: reviewId || undefined,
      sessionNonce: sessionNonce || undefined,
      sdkVersion: SDK_VERSION,
      timestamp: Date.now(),
      payload,
    }, parentOrigin);
  }

  function showOverlay(element) {
    hoveredElement = element;
    if (!element) {
      overlay.style.display = "none";
      return;
    }
    const box = element.getBoundingClientRect();
    Object.assign(overlay.style, {
      display: "block",
      left: `${Math.max(0, box.x)}px`,
      top: `${Math.max(0, box.y)}px`,
      width: `${Math.max(0, box.width)}px`,
      height: `${Math.max(0, box.height)}px`,
    });
  }

  function enablePicker() {
    if (pickerEnabled) {
      return;
    }
    pickerEnabled = true;
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    post("COMMENTARY_PICKER_ENABLED");
  }

  function disablePicker() {
    if (!pickerEnabled) {
      return;
    }
    pickerEnabled = false;
    selectedElement = null;
    hoveredElement = null;
    showOverlay(null);
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    post("COMMENTARY_PICKER_DISABLED");
  }

  function onMouseMove(event) {
    if (!pickerEnabled || !(event.target instanceof Element) || event.target === overlay) {
      return;
    }
    showOverlay(event.target);
    const context = elementContext(event.target);
    post("COMMENTARY_ELEMENT_HOVERED", {
      route: context.route,
      selector: context.selector,
      tagName: context.tagName,
      role: context.role,
      textSnippet: context.textSnippet,
      boundingRect: context.boundingRect,
    });
  }

  function onClick(event) {
    if (!pickerEnabled) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const target = event.target instanceof Element ? event.target : hoveredElement;
    if (!target || target === overlay) {
      return;
    }
    selectedElement = target;
    showOverlay(target);
    post("COMMENTARY_ELEMENT_SELECTED", selectedPayload(target));
  }

  function onKeyDown(event) {
    if (pickerEnabled && event.key === "Escape") {
      event.preventDefault();
      disablePicker();
    }
  }

  function hasActivePickerTarget() {
    return pickerEnabled && Boolean(selectedElement || hoveredElement);
  }

  function anchorUpdate(payload, options = {}) {
    const allowFallback = options.allowFallback === true;
    const reportMissing = options.reportMissing !== false;
    if (payload?.route && payload.route !== getRoute()) {
      post("COMMENTARY_ERROR", { message: "Anchor target belongs to a different preview route." });
      return;
    }
    const selectorsToTry = [payload?.selector, payload?.fallbackSelector].filter((value) => typeof value === "string" && value.trim());
    let target = null;
    for (const selector of selectorsToTry) {
      try {
        target = document.querySelector(selector);
      } catch {
        target = null;
      }
      if (target) {
        break;
      }
    }
    if (!target && allowFallback) {
      target = selectedElement || hoveredElement;
    }
    if (!target) {
      if (reportMissing) {
        post("COMMENTARY_ERROR", { message: "Anchor target could not be found in the current preview DOM." });
      }
      return;
    }
    selectedElement = target;
    showOverlay(target);
    post("COMMENTARY_ANCHOR_UPDATED", selectedPayload(target));
  }

  function routeChanged() {
    const nextRoute = getRoute();
    if (nextRoute === lastRoute) {
      return;
    }
    lastRoute = nextRoute;
    post("COMMENTARY_ROUTE_CHANGED", {
      route: nextRoute,
      url: window.location.href,
      origin: window.location.origin,
    });
    if (hasActivePickerTarget()) {
      anchorUpdate(undefined, { allowFallback: true, reportMissing: false });
    }
  }

  function scheduleRouteChanged() {
    window.clearTimeout(routeTimer);
    routeTimer = window.setTimeout(routeChanged, 0);
  }

  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;
  window.history.pushState = function patchedPushState(...args) {
    const result = originalPushState.apply(this, args);
    scheduleRouteChanged();
    return result;
  };
  window.history.replaceState = function patchedReplaceState(...args) {
    const result = originalReplaceState.apply(this, args);
    scheduleRouteChanged();
    return result;
  };

  window.addEventListener("message", (event) => {
    if (event.origin !== parentOrigin || !event.data || event.data.protocol !== PROTOCOL) {
      return;
    }
    if (sessionNonce && event.data.sessionNonce !== sessionNonce) {
      return;
    }
    if (event.data.type === "COMMENTARY_INIT") {
      reviewId = event.data.reviewId || reviewId;
      sessionNonce = event.data.sessionNonce || sessionNonce;
      post("COMMENTARY_SDK_READY", {
        route: getRoute(),
        origin: window.location.origin,
        buildId: window.__COMMENTARY_BUILD_ID__ || null,
        commitSha: window.__COMMENTARY_COMMIT_SHA__ || null,
      });
      return;
    }
    if (!sessionNonce) {
      post("COMMENTARY_ERROR", { message: "Commentary review SDK received a command before session initialization." });
      return;
    }
    if (event.data.type === "COMMENTARY_ENABLE_PICKER") {
      enablePicker();
    } else if (event.data.type === "COMMENTARY_DISABLE_PICKER") {
      disablePicker();
    } else if (event.data.type === "COMMENTARY_REQUEST_ANCHOR_UPDATE") {
      anchorUpdate(event.data.payload, { allowFallback: true });
    } else if (event.data.type === "COMMENTARY_PING") {
      post("COMMENTARY_PONG", { route: getRoute(), origin: window.location.origin });
    }
  });

  window.addEventListener("popstate", routeChanged);
  window.addEventListener("hashchange", routeChanged);
  window.addEventListener("resize", () => {
    if (hasActivePickerTarget()) {
      anchorUpdate(undefined, { allowFallback: true, reportMissing: false });
    }
  });
  window.addEventListener("scroll", () => {
    if (hasActivePickerTarget()) {
      anchorUpdate(undefined, { allowFallback: true, reportMissing: false });
    }
  }, true);

  post("COMMENTARY_SDK_READY", {
    route: getRoute(),
    origin: window.location.origin,
    buildId: window.__COMMENTARY_BUILD_ID__ || null,
    commitSha: window.__COMMENTARY_COMMIT_SHA__ || null,
  });
})();
