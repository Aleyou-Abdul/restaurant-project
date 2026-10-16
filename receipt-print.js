(function () {
    const params = new URLSearchParams(window.location.search);
    const key = params.get("key");
    const returnUrl = params.get("return") || "";
    const isEmbeddedPrint = params.get("embedded") === "1";
    const storageKey = key ? `printDocument:${key}` : "";
    const root = document.getElementById("print-root");
    let printFinished = false;

    function showError(message) {
        root.className = "print-error";
        root.innerHTML = `<h1>Print document unavailable</h1><p>${message}</p>`;
    }

    if (!storageKey) {
        showError("No print document key was provided.");
        return;
    }

    const documentMarkup = localStorage.getItem(storageKey);

    if (!documentMarkup) {
        showError("The print document was not found. Please go back and click Print again.");
        return;
    }

    const parsedDocument = new DOMParser().parseFromString(documentMarkup, "text/html");
    const title = parsedDocument.querySelector("title");

    if (title && title.textContent) {
        document.title = title.textContent;
    }

    parsedDocument.querySelectorAll("link[rel='stylesheet']").forEach((link) => {
        const stylesheet = document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = link.getAttribute("href");
        document.head.appendChild(stylesheet);
    });

    parsedDocument.querySelectorAll("style").forEach((style) => {
        const printStyle = document.createElement("style");
        printStyle.textContent = style.textContent;
        document.head.appendChild(printStyle);
    });

    const receiptShell = parsedDocument.querySelector(".print-shell");
    const isReceipt = Boolean(receiptShell);
    const paperWidth = Number(receiptShell && receiptShell.dataset.paperWidth) === 58 ? 58 : 80;
    const defaultContentWidth = paperWidth === 58 ? 50 : 72;
    const configuredContentWidth = Math.min(
        Math.max(Number(receiptShell && receiptShell.dataset.contentWidth) || defaultContentWidth, 30),
        paperWidth === 58 ? 54 : 76
    );
    const printScale = Math.min(Math.max(Number(receiptShell && receiptShell.dataset.printScale) || 0.9, 0.6), 1);
    // Thermal printers cannot use the entire roll width. Keep a safe edge so the price column never prints off the right.
    const contentWidth = Math.min(configuredContentWidth, paperWidth === 58 ? 48 : 68);
    const horizontalPadding = paperWidth === 58 ? 3 : 4;
    const pageStyle = document.createElement("style");

    function getReceiptPageStyle(heightMm) {
        return `
            @page { size: ${paperWidth}mm ${heightMm}mm; margin: 0; }
            html, body { box-sizing: border-box; width: ${paperWidth}mm; min-width: ${paperWidth}mm; max-width: ${paperWidth}mm; margin: 0; padding: 0; background: #fff; overflow: visible; }
            #print-root { box-sizing: border-box; width: ${paperWidth}mm; margin: 0; padding: 1mm ${horizontalPadding}mm 2mm; overflow: visible; }
            #print-root .print-shell {
                box-sizing: border-box;
                width: ${contentWidth}mm !important;
                max-width: ${contentWidth}mm !important;
                margin: 0 auto !important;
                transform: none !important;
                zoom: ${printScale} !important;
            }
            @media print {
                html, body { width: ${paperWidth}mm !important; min-width: ${paperWidth}mm !important; max-width: ${paperWidth}mm !important; }
                #print-root { width: ${paperWidth}mm !important; max-width: ${paperWidth}mm !important; margin: 0 !important; padding: 1mm ${horizontalPadding}mm 2mm !important; overflow: visible !important; }
            }
        `;
    }

    pageStyle.textContent = isReceipt
        ? getReceiptPageStyle(170)
        : `
            @page { size: A4; margin: 14mm; }
            html, body { margin: 0; background: #fff; }
            #print-root { width: 100%; }
        `;
    document.head.appendChild(pageStyle);
    document.body.className = isReceipt ? "receipt-print-body" : "report-print-body";
    root.className = "";
    root.innerHTML = parsedDocument.body.innerHTML;

    function updateReceiptPaperHeight() {
        if (!isReceipt) {
            return;
        }

        const receipt = root.querySelector(".print-shell") || root;
        const receiptHeightPx = receipt.getBoundingClientRect().height || receipt.scrollHeight;
        const receiptHeightMm = Math.ceil((receiptHeightPx * 25.4) / 96);
        const paperHeightMm = Math.min(Math.max(receiptHeightMm + 8, 95), 297);
        pageStyle.textContent = getReceiptPageStyle(paperHeightMm);
    }

    function waitForImages() {
        const images = [...document.images];

        if (!images.length) {
            return Promise.resolve();
        }

        return Promise.allSettled(images.map((image) => {
            if (image.complete) {
                return Promise.resolve();
            }

            return new Promise((resolve) => {
                image.addEventListener("load", resolve, { once: true });
                image.addEventListener("error", resolve, { once: true });
            });
        }));
    }

    function printSoon() {
        updateReceiptPaperHeight();
        window.print();
    }

    function completePrint() {
        if (printFinished) {
            return;
        }

        printFinished = true;
        localStorage.removeItem(storageKey);

        // The dashboard uses an invisible frame so printing never replaces the active work screen.
        if (isEmbeddedPrint) {
            window.parent.postMessage({
                type: "plateroute-receipt-print-complete",
                key
            }, window.location.origin);
            return;
        }

        if (returnUrl) {
            window.setTimeout(() => {
                window.location.href = returnUrl;
            }, 250);
        }
    }

    window.addEventListener("afterprint", completePrint);

    const waitForFonts = document.fonts && document.fonts.ready
        ? document.fonts.ready.catch(() => undefined)
        : Promise.resolve();

    Promise.race([
        Promise.all([waitForImages(), waitForFonts]),
        new Promise((resolve) => window.setTimeout(resolve, 1000))
    ]).then(() => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(printSoon));
    });
})();
