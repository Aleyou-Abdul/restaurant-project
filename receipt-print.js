(function () {
    const params = new URLSearchParams(window.location.search);
    const key = params.get("key");
    const returnUrl = params.get("return") || "";
    const storageKey = key ? `printDocument:${key}` : "";
    const root = document.getElementById("print-root");

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
    const contentWidth = Math.min(
        Math.max(Number(receiptShell && receiptShell.dataset.contentWidth) || defaultContentWidth, 30),
        paperWidth === 58 ? 54 : 76
    );
    const printScale = Math.min(Math.max(Number(receiptShell && receiptShell.dataset.printScale) || 0.9, 0.6), 1);
    const scaledLayoutWidth = Math.ceil((contentWidth / printScale) * 100) / 100;
    const pageStyle = document.createElement("style");

    function getReceiptPageStyle(heightMm) {
        return `
            @page { size: ${paperWidth}mm ${heightMm}mm; margin: 1mm; }
            html, body { width: ${paperWidth}mm; min-width: ${paperWidth}mm; max-width: ${paperWidth}mm; margin: 0; background: #fff; overflow: visible; }
            #print-root { width: ${paperWidth}mm; margin: 0; padding: 0; overflow: visible; }
            #print-root .print-shell {
                width: ${scaledLayoutWidth}mm !important;
                max-width: ${scaledLayoutWidth}mm !important;
                margin: 0 !important;
                transform: scale(${printScale}) !important;
                transform-origin: top left !important;
            }
            @media print {
                html, body { width: ${paperWidth}mm !important; min-width: ${paperWidth}mm !important; max-width: ${paperWidth}mm !important; }
                #print-root { width: ${paperWidth}mm !important; max-width: ${paperWidth}mm !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; }
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
        window.setTimeout(() => {
            localStorage.removeItem(storageKey);
        }, 1000);
    }

    window.addEventListener("afterprint", () => {
        localStorage.removeItem(storageKey);

        if (returnUrl) {
            window.setTimeout(() => {
                window.location.href = returnUrl;
            }, 250);
        }
    });

    Promise.race([
        waitForImages(),
        new Promise((resolve) => window.setTimeout(resolve, 350))
    ]).then(() => {
        window.requestAnimationFrame(() => window.setTimeout(printSoon, 50));
    });
})();
